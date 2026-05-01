// Gateway: Instagram DM webhook routes -- Hono sub-app for Instagram messaging
// Resolves tenant by Instagram Page ID, processes messages via provider-adapter runtime orchestrator, replies via Instagram API

import { Hono } from "hono";
import type { ContentPart, ToolDefinition } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import { toInstagramFormat } from "../channels/message-formatter.js";
import type { RuntimeSessionOrchestrator, PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";
import type { EventBus, MemoryRepository } from "@kilnai/core";
import { sendInstagramMessage } from "../channels/instagram-api.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { requireWebhookSignature } from "./auth-middleware.js";
import { verifyMetaWebhook } from "./meta-webhook-foundation.js";
import { TraceContext } from "./trace-context.js";
import type { WebhookDedup } from "./webhook-dedup.js";
import type { SttAdapter, RetrievalPipeline, ContactMemoryService } from "@kilnai/core";
import { preprocessAudio, createGenericMediaDownloader } from "./audio-preprocessor.js";
import { formatKnowledgeContext, formatContactContext } from "./context-formatter.js";
import { projectAdmittedTurnContext } from "./message-pipeline.js";
import {
  createTenantConversationMemoryRepository,
  TenantConversationMemory,
} from "./tenant-conversation-memory.js";

export interface InstagramWebhookConfig {
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

/** Instagram webhook messaging entry */
interface InstagramMessagingEntry {
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

interface InstagramWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    time: number;
    messaging: InstagramMessagingEntry[];
  }>;
}

/** Lazily-opened app memory repositories. Keyed by resolved app memory base path. */
const conversationMemoryRepositories = new Map<string, MemoryRepository>();

function getConversationMemory(memoryBasePath: string, eventBus?: EventBus): TenantConversationMemory {
  let repository = conversationMemoryRepositories.get(memoryBasePath);
  if (!repository) {
    repository = createTenantConversationMemoryRepository(memoryBasePath);
    conversationMemoryRepositories.set(memoryBasePath, repository);
  }

  return new TenantConversationMemory({
    repository,
    ...(eventBus ? { eventBus } : {}),
  });
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

/** Parse an Instagram messaging entry into ContentPart[] */
function parseInstagramMessageParts(entry: InstagramMessagingEntry): readonly ContentPart[] | null {
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

export function createInstagramWebhookRoutes(config: InstagramWebhookConfig): Hono {
  const app = new Hono();

  // GET /webhook -- Meta verification handshake
  app.get("/webhook", (c) => verifyMetaWebhook(c, config.verifyToken));

  // HMAC-SHA256 signature validation for POST webhooks
  if (config.appSecret) {
    app.use("/webhook", requireWebhookSignature(config.appSecret, "x-hub-signature-256"));
  }

  // POST /webhook -- Incoming messages from Instagram
  app.post("/webhook", async (c) => {
    let payload: InstagramWebhookPayload;
    try {
      payload = await c.req.json<InstagramWebhookPayload>();
    } catch {
      return c.text("OK", 200);
    }

    if (payload.object !== "instagram" || !payload.entry) {
      return c.text("OK", 200);
    }

    const processPromises: Promise<void>[] = [];

    for (const entry of payload.entry) {
      for (const messaging of entry.messaging) {
        // Filter echo messages (business-sent messages echoed back)
        if (messaging.message?.is_echo) continue;

        // Deduplicate -- Meta uses at-least-once delivery
        if (messaging.message?.mid && config.dedup?.isDuplicate(messaging.message.mid)) {
          console.debug(`[instagram] Skipping duplicate message ${messaging.message.mid}`);
          continue;
        }

        const senderId = messaging.sender.id;
        const recipientPageId = messaging.recipient.id;

        // Resolve tenant by Instagram Page ID
        const tenant = config.tenantRegistry.resolveByInstagramPageId(recipientPageId, config.appName);
        if (!tenant) {
          const trace = new TraceContext();
          trace.warn("instagram", "No tenant found", { recipientPageId, appName: config.appName });
          continue;
        }

        const msgParts = parseInstagramMessageParts(messaging);
        if (!msgParts) continue;

        const promise = processInstagramMessage(
          config,
          tenant.tenantId,
          senderId,
          msgParts,
          recipientPageId,
          tenant.instagramAccessToken,
        );
        processPromises.push(promise);
      }
    }

    // Fire and forget -- log any failures from settled promises
    Promise.allSettled(processPromises).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const failTrace = new TraceContext();
          failTrace.warn("instagram", "Message processing failed", { error: String(result.reason) });
        }
      }
    });

    return c.text("OK", 200);
  });

  return app;
}

async function processInstagramMessage(
  config: InstagramWebhookConfig,
  tenantId: string,
  senderId: string,
  messageParts: readonly ContentPart[],
  pageId: string,
  accessToken?: string,
): Promise<void> {
  const trace = new TraceContext();
  trace.log("instagram", "Processing message", { tenantId, from: senderId });

  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  const resolvedAccessToken = accessToken
    ? (process.env[accessToken] ?? accessToken)
    : "";

  // Preprocess audio parts via STT (fail-open) -- Instagram CDN URLs don't need auth
  let processedParts = messageParts;
  if (config.sttAdapter) {
    try {
      const downloader = createGenericMediaDownloader();
      processedParts = await preprocessAudio(messageParts, config.sttAdapter, downloader);
    } catch (err) {
      trace.warn("instagram", "Audio preprocessing failed", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const messageText = extractText(processedParts);

  // --- Memory: recall past context about this user ---
  let recalledMemory: string | undefined;
  if (config.memoryBasePath) {
    try {
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      const query = `${senderId} ${messageText}`;
      recalledMemory = memory.recall({
        tenantId,
        participantId: senderId,
        query,
        tokenBudget: 500,
      });
    } catch (err) {
      trace.warn("instagram", "Memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
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
        trace.warn("instagram", "Knowledge retrieval failed", { error: err instanceof Error ? err.message : String(err) });
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
      trace.warn("instagram", "Contact memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

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
    "instagram", callTools,
  );

  // Update session with resolved prompt and agent
  session.setSystemPrompt(agentCtx.systemPrompt);
  if (agentCtx.activeAgentId) {
    session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
  }

  const projectedTurnContext = projectAdmittedTurnContext({
    userContext: session.userContext,
    cachedRuntimeSummary: undefined,
    recalledMemory,
    knowledgeContext,
    contactContext,
    groundingMode: tenant.groundingMode,
  });

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
      trace.log("instagram", "Budget exhausted", { tenantId, sender: senderId });
      try {
        await sendInstagramMessage(pageId, resolvedAccessToken, senderId, overBudgetMsg);
      } catch (err) {
        trace.warn("instagram", "Failed to send over-budget reply", { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  // Emit MESSAGE_RECEIVED event (fire-and-forget)
  if (config.eventEmitter) {
    config.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId,
      channel: "instagram",
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
      projectedTurnContext,
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
        channel: "instagram",
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
        channel: "instagram",
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
          channel: "instagram",
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
        channel: "instagram",
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
        channel: "instagram",
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

    replyText = toInstagramFormat(extractText(result.parts));

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
        channel: "instagram",
        externalUserId: senderId,
        messageContent: replyText,
        messageRole: "ASSISTANT",
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    trace.error("instagram", "Orchestrator error", { tenantId, error: err instanceof Error ? err.message : String(err) });
    replyText = "Something went wrong. Please try again.";
  }

  // Reply via Instagram API
  try {
    await sendInstagramMessage(pageId, resolvedAccessToken, senderId, replyText);
  } catch (err) {
    trace.warn("instagram", "Failed to send reply", { pageId, recipient: senderId, error: err instanceof Error ? err.message : String(err) });
  }

  // --- Memory: save what was learned from this exchange ---
  if (config.memoryBasePath && messageText.length > 5) {
    try {
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      memory.saveExchange({
        appName: config.appName,
        channel: "instagram",
        tenantId,
        participantId: senderId,
        userMessage: messageText,
        assistantMessage: replyText,
      });
    } catch (err) {
      trace.warn("instagram", "Memory save failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
