// Gateway: Messenger webhook routes -- Hono sub-app for Facebook Messenger Platform
// Resolves tenant by Messenger Page ID, processes messages via provider-adapter runtime orchestrator, replies via Messenger Send API

import { Hono } from "hono";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ContentPart, ToolDefinition } from "@kilnai/core";
import { extractText, SqliteMemoryStore } from "@kilnai/core";
import { toMessengerFormat } from "../channels/message-formatter.js";
import type { RuntimeSessionOrchestrator, PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";
import type { EventBus } from "@kilnai/core";
import { sendMessengerMessage } from "../channels/messenger-api.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { requireWebhookSignature } from "./auth-middleware.js";
import { verifyMetaWebhook } from "./meta-webhook-foundation.js";
import { TraceContext } from "./trace-context.js";
import type { WebhookDedup } from "./webhook-dedup.js";
import type { SttAdapter, RetrievalPipeline, ContactMemoryService } from "@kilnai/core";
import { preprocessAudio, createGenericMediaDownloader } from "./audio-preprocessor.js";
import { formatKnowledgeContext, formatContactContext, mergeContextSources, appendGroundingDirective } from "./context-formatter.js";

export interface MessengerWebhookConfig {
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly verifyToken: string;
  readonly appSecret?: string;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly memoryBasePath?: string;
  readonly sttAdapter?: SttAdapter;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactMemoryService?: ContactMemoryService;
  readonly dedup?: WebhookDedup;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
}

/** Messenger webhook messaging entry (same structure as Instagram) */
interface MessengerMessagingEntry {
  sender: { id: string };
  recipient: { id: string };
  timestamp: number;
  message?: {
    mid: string;
    text?: string;
    is_echo?: boolean;
    attachments?: Array<{
      type: string;
      payload: { url?: string };
    }>;
  };
}

interface MessengerWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    time: number;
    messaging: MessengerMessagingEntry[];
  }>;
}

/** Lazily-opened per-tenant memory stores. Keyed by tenantId. */
const memoryStores = new Map<string, SqliteMemoryStore>();

function getMemoryStore(memoryBasePath: string, tenantId: string): SqliteMemoryStore {
  let store = memoryStores.get(tenantId);
  if (store) return store;

  const dir = join(memoryBasePath, "memory");
  mkdirSync(dir, { recursive: true });

  store = new SqliteMemoryStore({
    dbPath: join(dir, `${tenantId}.db`),
    layer: "user",
    tenantId,
  });
  memoryStores.set(tenantId, store);
  return store;
}

/** Tool definition for knowledge_search -- injected when knowledge mode is "tool" */
const KNOWLEDGE_SEARCH_TOOL: ToolDefinition = {
  name: "knowledge_search",
  description: "Search the knowledge base for relevant information. Use this when the user asks a question that may be answered by stored documents or knowledge.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query to find relevant knowledge.",
      },
    },
    required: ["query"],
  },
  tags: new Set(["builtin"]),
};

/** Parse a Messenger messaging entry into ContentPart[] */
function parseMessengerMessageParts(entry: MessengerMessagingEntry): readonly ContentPart[] | null {
  const msg = entry.message;
  if (!msg) return null;

  const parts: ContentPart[] = [];

  if (msg.text) {
    parts.push({ type: "text", text: msg.text });
  }

  if (msg.attachments) {
    for (const att of msg.attachments) {
      if (att.type === "image" && att.payload.url) {
        parts.push({ type: "image", mimeType: "image/jpeg", url: att.payload.url });
      } else if (att.type === "audio" && att.payload.url) {
        parts.push({ type: "audio", mimeType: "audio/mp4", url: att.payload.url });
      }
    }
  }

  return parts.length > 0 ? parts : null;
}

export function createMessengerWebhookRoutes(config: MessengerWebhookConfig): Hono {
  const app = new Hono();

  // GET /webhook -- Meta verification handshake
  app.get("/webhook", (c) => verifyMetaWebhook(c, config.verifyToken));

  // HMAC-SHA256 signature validation for POST webhooks
  if (config.appSecret) {
    app.use("/webhook", requireWebhookSignature(config.appSecret, "x-hub-signature-256"));
  }

  // POST /webhook -- Incoming messages from Messenger
  app.post("/webhook", async (c) => {
    let payload: MessengerWebhookPayload;
    try {
      payload = await c.req.json<MessengerWebhookPayload>();
    } catch {
      return c.text("OK", 200);
    }

    if (payload.object !== "page" || !payload.entry) {
      return c.text("OK", 200);
    }

    const processPromises: Promise<void>[] = [];

    for (const entry of payload.entry) {
      for (const messaging of entry.messaging) {
        // Filter echo messages (business-sent messages echoed back)
        if (messaging.message?.is_echo) continue;

        // Deduplicate -- Meta uses at-least-once delivery
        if (messaging.message?.mid && config.dedup?.isDuplicate(messaging.message.mid)) {
          console.debug(`[messenger] Skipping duplicate message ${messaging.message.mid}`);
          continue;
        }

        const senderId = messaging.sender.id;
        const recipientPageId = messaging.recipient.id;

        // Resolve tenant by Messenger Page ID
        const tenant = config.tenantRegistry.resolveByMessengerPageId(recipientPageId, config.appName);
        if (!tenant) {
          const trace = new TraceContext();
          trace.warn("messenger", "No tenant found", { recipientPageId, appName: config.appName });
          continue;
        }

        const msgParts = parseMessengerMessageParts(messaging);
        if (!msgParts) continue;

        const promise = processMessengerMessage(
          config,
          tenant.tenantId,
          senderId,
          msgParts,
          tenant.messengerAccessToken,
        );
        processPromises.push(promise);
      }
    }

    // Fire and forget -- log any failures from settled promises
    Promise.allSettled(processPromises).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const failTrace = new TraceContext();
          failTrace.warn("messenger", "Message processing failed", { error: String(result.reason) });
        }
      }
    });

    return c.text("OK", 200);
  });

  return app;
}

async function processMessengerMessage(
  config: MessengerWebhookConfig,
  tenantId: string,
  senderId: string,
  messageParts: readonly ContentPart[],
  accessToken?: string,
): Promise<void> {
  const trace = new TraceContext();
  trace.log("messenger", "Processing message", { tenantId, from: senderId });

  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  const resolvedAccessToken = accessToken
    ? (process.env[accessToken] ?? accessToken)
    : "";

  // Preprocess audio parts via STT (fail-open) -- Messenger CDN URLs don't need auth
  let processedParts = messageParts;
  if (config.sttAdapter) {
    try {
      const downloader = createGenericMediaDownloader();
      processedParts = await preprocessAudio(messageParts, config.sttAdapter, downloader);
    } catch (err) {
      trace.warn("messenger", "Audio preprocessing failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const messageText = extractText(processedParts);

  // --- Memory: recall past context about this user ---
  let recalledMemory: string | undefined;
  if (config.memoryBasePath) {
    try {
      const store = getMemoryStore(config.memoryBasePath, tenantId);
      const query = `${senderId} ${messageText}`;
      recalledMemory = await store.recall(query, 500) || undefined;
    } catch (err) {
      trace.warn("messenger", "Memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // --- Knowledge: retrieve relevant context ---
  let knowledgeContext: string | undefined;
  if (config.knowledgePipeline && messageText.length > 0) {
    const knowledgeMode = config.knowledgeMode ?? "auto";
    if (knowledgeMode === "auto") {
      try {
        const results = await config.knowledgePipeline.retrieve(messageText, { topK: 5 });
        knowledgeContext = formatKnowledgeContext(results);
      } catch (err) {
        trace.warn("messenger", "Knowledge retrieval failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // --- Contact memory: recall persistent facts about this user ---
  let contactContext: string | undefined;
  if (config.contactMemoryService) {
    try {
      const facts = await config.contactMemoryService.recall(senderId, tenantId);
      contactContext = formatContactContext(facts);
    } catch (err) {
      trace.warn("messenger", "Contact memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const combinedMemory = appendGroundingDirective(
    mergeContextSources(recalledMemory, knowledgeContext, contactContext),
    tenant.groundingMode,
  );

  // --- Tools: build per-call builtin tools ---
  const callTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();

  // Register knowledge_search tool for "tool" mode
  if (config.knowledgePipeline && (config.knowledgeMode ?? "auto") === "tool") {
    callTools.set("knowledge_search", async (input: Record<string, unknown>) => {
      const query = String(input.query ?? "");
      const results = await config.knowledgePipeline!.retrieve(query, { topK: 5 });
      return results.map((r) => ({ content: r.content, score: r.score }));
    });

    const hasKnowledgeTool = config.orchestrator.tools?.some((t) => t.name === "knowledge_search");
    if (!hasKnowledgeTool) {
      config.orchestrator.registerTools([KNOWLEDGE_SEARCH_TOOL]);
    }
  }

  // Get or create session first (needed for ping-pong guard)
  const session = await config.sessionRegistry.getOrCreate({
    appName: config.appName,
    tenantId,
    userId: senderId,
    systemPrompt: "",
    idleTimeoutMs: tenant.idleTimeoutMs,
  });

  // Resolve agent context (multi-agent routing with ping-pong guard)
  const agentCtx = await resolveAgentContextAsync(
    tenant, processedParts, session,
    { handoffSummarizer: config.handoffSummarizer, eventBus: config.eventBus },
    "messenger", callTools,
  );

  // Update session with resolved prompt and agent
  session.setSystemPrompt(agentCtx.systemPrompt);
  if (agentCtx.activeAgentId) {
    session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
  }

  const tenantToolCtx = agentCtx.tenantToolContext;

  // Register webhook tool definitions on the orchestrator
  if (tenantToolCtx.toolDefinitions.length > 0) {
    config.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
  }

  const perCallConfig: PerCallToolConfig = {
    toolAllowlist: tenantToolCtx.toolAllowlist,
    rateLimiter: tenantToolCtx.rateLimiter,
    tenantId: tenant.tenantId,
    toolAuthority: tenantToolCtx.toolAuthority,
    additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
    perCallCapabilities: tenantToolCtx.capabilities.size > 0 ? tenantToolCtx.capabilities : undefined,
  };

  // --- Budget check ---
  const activeBilling = tenant.billing?.budgetEndpoint
    ? (tenant.billing as unknown as BillingConfig)
    : config.billing;
  if (activeBilling) {
    const budgetResult = await checkBudget(activeBilling, tenantId);
    if (!budgetResult.allowed) {
      const overBudgetMsg = tenant.billing?.overBudgetMessage
        ?? activeBilling.overBudgetMessage ?? "Budget exhausted.";
      trace.log("messenger", "Budget exhausted", { tenantId, sender: senderId });
      try {
        await sendMessengerMessage(resolvedAccessToken, senderId, overBudgetMsg);
      } catch (err) {
        trace.warn("messenger", "Failed to send over-budget reply", { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  // Emit MESSAGE_RECEIVED event (fire-and-forget)
  if (config.eventEmitter) {
    config.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId,
      channel: "messenger",
      externalUserId: senderId,
      messageContent: messageText,
      messageRole: "USER",
      traceId: trace.traceId,
      timestamp: new Date().toISOString(),
    });
  }

  let replyText: string;
  try {
    const result = await config.orchestrator.processMessage(
      session,
      processedParts,
      combinedMemory,
      tenantToolCtx.callBuiltinTools.size > 0 ? tenantToolCtx.callBuiltinTools : undefined,
      perCallConfig,
    );

    // Persist mutated session
    await config.sessionRegistry.save(session);

    // Emit handoff events when message was queued
    if (result.queued && config.eventEmitter) {
      config.eventEmitter.emit({
        eventType: "HANDOFF_MESSAGE_QUEUED",
        tenantId,
        channel: "messenger",
        externalUserId: senderId,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit escalation event when detected
    if (result.escalation && config.eventEmitter) {
      config.eventEmitter.emit({
        eventType: "ESCALATION_DETECTED",
        tenantId,
        channel: "messenger",
        externalUserId: senderId,
        escalationReason: result.escalation.reason,
        escalationDetail: result.escalation.detail,
        summary: result.contextSummary,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit TOOL_EXECUTED events
    if (result.toolExecutions && config.eventEmitter) {
      for (const exec of result.toolExecutions) {
        config.eventEmitter.emit({
          eventType: "TOOL_EXECUTED",
          tenantId,
          channel: "messenger",
          externalUserId: senderId,
          toolName: exec.toolName,
          durationMs: exec.durationMs,
          success: exec.success,
          resultSummary: exec.resultSummary,
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Emit AGENT_ROUTED when multi-agent routing is active
    if (agentCtx.activeAgentId && config.eventEmitter) {
      config.eventEmitter.emit({
        eventType: "AGENT_ROUTED",
        tenantId,
        channel: "messenger",
        externalUserId: senderId,
        activeAgentId: agentCtx.activeAgentId,
        activeAgentName: agentCtx.activeAgentName,
        routingTier: agentCtx.routingResult?.tier,
        routingConfidence: agentCtx.routingResult?.confidence,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit AGENT_HANDOFF when an agent switch occurred (or was blocked)
    if ((agentCtx.isHandoff || agentCtx.pingPongBlocked) && config.eventEmitter) {
      const fromAgent = tenant.agents?.find((a) => a.id === agentCtx.previousAgentId);
      const toAgent = tenant.agents?.find((a) => a.id === agentCtx.activeAgentId);
      config.eventEmitter.emit({
        eventType: "AGENT_HANDOFF",
        tenantId,
        channel: "messenger",
        externalUserId: senderId,
        fromAgentId: agentCtx.previousAgentId,
        fromAgentName: fromAgent?.name,
        toAgentId: agentCtx.activeAgentId,
        toAgentName: toAgent?.name,
        handoffBrief: agentCtx.handoffBrief,
        handoffBlocked: agentCtx.pingPongBlocked,
        handoffBlockReason: agentCtx.pingPongReason,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    replyText = toMessengerFormat(extractText(result.parts));

    // Report usage (fire-and-forget)
    if (activeBilling) {
      reportUsage(activeBilling, {
        tenantId,
        messages: 1,
        tokens: result.inputTokens + result.outputTokens,
        model: config.orchestrator.model ?? "unknown",
      });
    }

    // Emit MESSAGE_SENT event (fire-and-forget)
    if (config.eventEmitter) {
      config.eventEmitter.emit({
        eventType: "MESSAGE_SENT",
        tenantId,
        channel: "messenger",
        externalUserId: senderId,
        messageContent: replyText,
        messageRole: "ASSISTANT",
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    trace.error("messenger", "Orchestrator error", { tenantId, error: err instanceof Error ? err.message : String(err) });
    replyText = "Something went wrong. Please try again.";
  }

  // Reply via Messenger Send API
  try {
    await sendMessengerMessage(resolvedAccessToken, senderId, replyText);
  } catch (err) {
    trace.warn("messenger", "Failed to send reply", { recipient: senderId, error: err instanceof Error ? err.message : String(err) });
  }

  // --- Memory: save what was learned from this exchange ---
  if (config.memoryBasePath && messageText.length > 5) {
    try {
      const store = getMemoryStore(config.memoryBasePath, tenantId);
      await store.save({
        layer: "user",
        content: `[${senderId}] User: ${messageText}\nAssistant: ${replyText}`,
        tags: [senderId],
      });
    } catch (err) {
      trace.warn("messenger", "Memory save failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
