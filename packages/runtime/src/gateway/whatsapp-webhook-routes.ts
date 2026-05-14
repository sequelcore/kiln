// Gateway: WhatsApp webhook routes -- Hono sub-app for Meta webhook verification and incoming messages
// Resolves tenant by phone number, processes messages via provider-adapter runtime orchestrator, replies via Cloud API

import { Hono } from "hono";
import type { ContentPart, ToolDefinition } from "@kilnai/core";
import { textParts, extractText } from "@kilnai/core";
import { toWhatsAppFormat } from "../channels/message-formatter.js";
import type { RuntimeSessionOrchestrator, PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";
import type { ArtifactResourceStore, EventBus, MemoryRepository } from "@kilnai/core";
import { stripSuggestionTags } from "../tenant/suggestion-parser.js";
import { sendWhatsAppMessage, whatsappMediaUrl } from "../channels/whatsapp-api.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { requireWebhookSignature } from "./auth-middleware.js";
import { verifyMetaWebhook } from "./meta-webhook-foundation.js";
import { TraceContext } from "./trace-context.js";
import type { WebhookDedup } from "./webhook-dedup.js";
import type { SttAdapter, RetrievalPipeline, ContactMemoryService } from "@kilnai/core";
import {
  AudioTransformError,
  createGatewayAudioTransformSessionId,
  createWhatsAppMediaDownloader,
  emitAudioTransformRoutingEvents,
  transformAudioParts,
} from "./audio-preprocessor.js";
import { formatKnowledgeContext, formatContactContext } from "./context-formatter.js";
import { projectAdmittedTurnContext } from "./message-pipeline.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";
import {
  createTenantConversationMemoryRepository,
  TenantConversationMemory,
} from "./tenant-conversation-memory.js";

export interface WhatsAppWebhookConfig {
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly verifyToken: string;
  readonly appSecret?: string;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  /** Base path for per-tenant data (e.g. ~/.kiln/gateway/bonitas). Memory DBs stored under <basePath>/memory/ */
  readonly memoryBasePath?: string;
  readonly sttAdapter?: SttAdapter;
  readonly artifactStore?: ArtifactResourceStore;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactMemoryService?: ContactMemoryService;
  readonly dedup?: WebhookDedup;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
}

interface MetaWebhookMessage {
  id: string;
  from: string;
  /** Recipient phone -- present in smb_message_echoes (coexistence) payloads */
  to?: string;
  type: string;
  text?: { body: string };
  image?: { id: string; mime_type: string; caption?: string };
  audio?: { id: string; mime_type: string };
  document?: { id: string; mime_type: string; filename?: string; caption?: string };
}

interface MetaWebhookStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
  errors?: Array<{ code: number; title: string }>;
}

interface MetaWebhookPayload {
  object: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      /** Webhook field type -- "messages" for normal, "smb_message_echoes" for coexistence */
      field?: string;
      value: {
        messaging_product: string;
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string }; wa_id: string }>;
        messages?: MetaWebhookMessage[];
        statuses?: MetaWebhookStatus[];
      };
    }>;
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

/** Tool definition for notify_owner -- injected when tenant has escalationContact */
const NOTIFY_OWNER_TOOL: ToolDefinition = {
  name: "notify_owner",
  description: "Send a WhatsApp notification to the business owner. Use this when a customer wants to schedule an appointment, needs escalation, or when the owner needs to be informed about something. Include a clear summary of what the customer needs.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The message to send to the owner. Include customer name (if known), requested service, date/time, and phone number.",
      },
    },
    required: ["message"],
  },
  tags: new Set(["builtin"]),
};

/** Parse a WhatsApp message into ContentPart[] */
function parseWhatsAppMessageParts(msg: MetaWebhookMessage): readonly ContentPart[] | null {
  switch (msg.type) {
    case "text":
      return msg.text?.body ? textParts(msg.text.body) : null;
    case "image": {
      if (!msg.image) return null;
      const parts: ContentPart[] = [
        { type: "image", mimeType: msg.image.mime_type, url: whatsappMediaUrl(msg.image.id) },
      ];
      if (msg.image.caption) parts.push({ type: "text", text: msg.image.caption });
      return parts;
    }
    case "audio":
      if (!msg.audio) return null;
      return [{ type: "audio", mimeType: msg.audio.mime_type, url: whatsappMediaUrl(msg.audio.id) }];
    case "document": {
      if (!msg.document) return null;
      const parts: ContentPart[] = [
        { type: "file", mimeType: msg.document.mime_type, url: whatsappMediaUrl(msg.document.id), filename: msg.document.filename },
      ];
      if (msg.document.caption) parts.push({ type: "text", text: msg.document.caption });
      return parts;
    }
    default:
      return null;
  }
}

export function createWhatsAppWebhookRoutes(config: WhatsAppWebhookConfig): Hono {
  const app = new Hono();

  // GET /webhook -- Meta verification handshake
  app.get("/webhook", (c) => verifyMetaWebhook(c, config.verifyToken));

  // HMAC-SHA256 signature validation for POST webhooks
  if (config.appSecret) {
    app.use("/webhook", requireWebhookSignature(config.appSecret, "x-hub-signature-256"));
  }

  // POST /webhook -- Incoming messages from Meta
  app.post("/webhook", async (c) => {
    let payload: MetaWebhookPayload;
    try {
      payload = await c.req.json<MetaWebhookPayload>();
    } catch {
      return c.text("OK", 200);
    }

    if (!payload.entry) {
      return c.text("OK", 200);
    }

    // Process each entry in the background
    const processPromises: Promise<void>[] = [];

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        const phoneNumberId = change.value.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        // Resolve tenant by phone number
        const tenant = config.tenantRegistry.resolveByPhone(phoneNumberId, config.appName);
        if (!tenant) {
          const entryTrace = new TraceContext();
          entryTrace.warn("whatsapp", "No tenant found", { phoneNumberId, appName: config.appName });
          continue;
        }

        // Handle coexistence echoes (business sent message from WhatsApp Business App)
        if (change.field === "smb_message_echoes") {
          const echoMessages = change.value.messages;
          if (echoMessages) {
            for (const msg of echoMessages) {
              if (!msg.to) continue;
              if (config.dedup?.isDuplicate(msg.id)) continue;
              const promise = processCoexistenceEcho(config, tenant, msg);
              processPromises.push(promise);
            }
          }
          continue;
        }

        // Forward delivery statuses to product backend (fire-and-forget)
        const statuses = change.value.statuses;
        if (statuses && config.eventEmitter) {
          for (const status of statuses) {
            config.eventEmitter.emit({
              eventType: "DELIVERY_STATUS",
              tenantId: tenant.tenantId,
              channel: "whatsapp",
              externalUserId: status.recipient_id,
              whatsappMessageId: status.id,
              deliveryStatus: status.status,
              errorCode: status.errors?.[0]?.code,
              timestamp: new Date(Number(status.timestamp) * 1000).toISOString(),
            });
          }
        }

        // Process incoming messages (if any -- status-only payloads have no messages)
        const messages = change.value.messages;
        if (!messages) continue;

        const contacts = change.value.contacts ?? [];

        for (const msg of messages) {
          // Deduplicate -- Meta uses at-least-once delivery
          if (config.dedup?.isDuplicate(msg.id)) {
            console.debug(`[whatsapp] Skipping duplicate message ${msg.id}`);
            continue;
          }

          const msgParts = parseWhatsAppMessageParts(msg);
          if (!msgParts) {
            const msgTrace = new TraceContext();
            msgTrace.warn("whatsapp", "Unsupported message type", { type: msg.type, from: msg.from });
            continue;
          }

          // Resolve canonical reply address from contacts; fall back to msg.from
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const replyTo = contact?.wa_id ?? msg.from;

          const promise = processWhatsAppMessage(
            config,
            tenant.tenantId,
            replyTo,
            msgParts,
            phoneNumberId,
            tenant.whatsappAccessToken,
          );
          processPromises.push(promise);
        }
      }
    }

    // Fire and forget -- log any failures from settled promises
    Promise.allSettled(processPromises).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          const failTrace = new TraceContext();
          failTrace.warn("whatsapp", "Message processing failed", { error: String(result.reason) });
        }
      }
    });

    return c.text("OK", 200);
  });

  return app;
}

async function processWhatsAppMessage(
  config: WhatsAppWebhookConfig,
  tenantId: string,
  senderPhone: string,
  messageParts: readonly ContentPart[],
  phoneNumberId: string,
  accessToken?: string,
): Promise<void> {
  const trace = new TraceContext();
  trace.log("whatsapp", "Processing message", { tenantId, from: senderPhone });

  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  const resolvedAccessToken = accessToken
    ? (process.env[accessToken] ?? accessToken)
    : "";

  const mediaDownloader = createWhatsAppMediaDownloader(resolvedAccessToken);
  let processedParts = messageParts;
  if (config.artifactStore) {
    processedParts = await captureMultimodalArtifacts(processedParts, {
      artifactStore: config.artifactStore,
      downloader: mediaDownloader,
      sourceKind: "webhook-attachment",
      sourceIdPrefix: `${config.appName}:${tenantId}:${senderPhone}:whatsapp`,
      producerName: "gateway-whatsapp-ingress",
    });
  }

  // Governed audio transform route via STT.
  if (config.sttAdapter) {
    try {
      if (!config.artifactStore) {
        throw new AudioTransformError("Audio transform artifact store is not configured.", []);
      }
      const transformed = await transformAudioParts(processedParts, config.sttAdapter, mediaDownloader, {
        artifactStore: config.artifactStore,
        sourceIdPrefix: `${config.appName}:${tenantId}:${senderPhone}`,
      });
      processedParts = transformed.parts;
      emitAudioTransformRoutingEvents({
        eventBus: config.eventBus,
        sessionId: createGatewayAudioTransformSessionId(config.appName, tenantId, senderPhone),
        tenantId,
        model: config.sttAdapter.name,
      }, transformed.transforms);
    } catch (err) {
      if (err instanceof AudioTransformError) {
        emitAudioTransformRoutingEvents({
          eventBus: config.eventBus,
          sessionId: createGatewayAudioTransformSessionId(config.appName, tenantId, senderPhone),
          tenantId,
          model: config.sttAdapter.name,
        }, err.transforms);
        trace.warn("whatsapp", "Audio transform failed", { error: err.message });
        try {
          await sendWhatsAppMessage(phoneNumberId, resolvedAccessToken, senderPhone, {
            type: "text",
            text: { body: "I could not process that voice note. Please try again or send text." },
          });
        } catch (sendErr) {
          trace.warn("whatsapp", "Failed to send audio transform failure reply", {
            error: sendErr instanceof Error ? sendErr.message : String(sendErr),
          });
        }
        return;
      }
      trace.warn("whatsapp", "Audio transform failed", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  const messageText = extractText(processedParts);

  // --- Memory: recall past context about this user ---
  let recalledMemory: string | undefined;
  if (config.memoryBasePath) {
    try {
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      const query = `${senderPhone} ${messageText}`;
      recalledMemory = memory.recall({
        tenantId,
        participantId: senderPhone,
        query,
        tokenBudget: 500,
      });
    } catch (err) {
      trace.warn("whatsapp", "Memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
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
        trace.warn("whatsapp", "Knowledge retrieval failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // --- Contact memory: recall persistent facts about this user ---
  let contactContext: string | undefined;
  if (config.contactMemoryService) {
    try {
      const facts = await config.contactMemoryService.recall(senderPhone, tenantId);
      contactContext = formatContactContext(facts);
    } catch (err) {
      trace.warn("whatsapp", "Contact memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Merge recalled memory + knowledge context + contact context
  // --- Tools: build per-call builtin tools ---
  const callTools = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();

  if (tenant.escalationContact?.phone) {
    const ownerPhone = tenant.escalationContact.phone.replace(/\+/g, "");
    callTools.set("notify_owner", async (input: Record<string, unknown>) => {
      const msg = String(input.message ?? "");
      const fullMessage = `[${tenant.businessName ?? tenant.name} - Notificación automática]\n\nCliente: ${senderPhone}\n${msg}`;

      await sendWhatsAppMessage(phoneNumberId, resolvedAccessToken, ownerPhone, {
        type: "text",
        text: { body: fullMessage },
      });
      trace.log("whatsapp", "Owner notified", { tenantId, ownerPhone });
      return { success: true, message: "Owner has been notified." };
    });
  }

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

  // Register notify_owner tool definition on the orchestrator if not already present
  if (callTools.has("notify_owner") && config.orchestrator.tools) {
    const hasNotifyTool = config.orchestrator.tools.some((t) => t.name === "notify_owner");
    if (!hasNotifyTool) {
      config.orchestrator.registerTools([NOTIFY_OWNER_TOOL]);
    }
  }

  // Get or create session first (needed for ping-pong guard)
  const session = await config.sessionRegistry.getOrCreate({
    appName: config.appName,
    tenantId,
    userId: senderPhone,
    systemPrompt: "",
    idleTimeoutMs: tenant.idleTimeoutMs,
  });

  // Coexistence auto-release: if human has been idle past the timeout, transition back to AI
  if (session.sessionMode === "human_active" && tenant.whatsappCoexistence?.autoReleaseMs) {
    const lastHuman = session.lastHumanMessageAt;
    if (lastHuman && Date.now() - lastHuman >= tenant.whatsappCoexistence.autoReleaseMs) {
      session.setSessionMode("ai_active");
      trace.log("whatsapp", "Coexistence: auto-released to AI", { tenantId, sender: senderPhone });
      if (config.eventEmitter) {
        config.eventEmitter.emit({
          eventType: "HANDOFF_RELEASED",
          tenantId,
          channel: "whatsapp",
          externalUserId: senderPhone,
          sessionId: session.id,
          sessionMode: "ai_active",
          handoffSource: "whatsapp_coexistence",
          schemaVersion: "1",
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // Resolve agent context (multi-agent routing with ping-pong guard)
  const agentCtx = await resolveAgentContextAsync(
    tenant, processedParts, session,
    { handoffSummarizer: config.handoffSummarizer, eventBus: config.eventBus },
    "whatsapp", callTools,
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
      trace.log("whatsapp", "Budget exhausted", { tenantId, sender: senderPhone });
      try {
        await sendWhatsAppMessage(phoneNumberId, resolvedAccessToken, senderPhone, {
          type: "text",
          text: { body: overBudgetMsg },
        });
      } catch (err) {
        trace.warn("whatsapp", "Failed to send over-budget reply", { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }

  // Emit MESSAGE_RECEIVED event (fire-and-forget)
  if (config.eventEmitter) {
    config.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId,
      channel: "whatsapp",
      externalUserId: senderPhone,
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

    // Persist mutated session (required for non-reference stores like Redis)
    await config.sessionRegistry.save(session);

    // Emit handoff events when message was queued
    if (result.queued && config.eventEmitter) {
      config.eventEmitter.emit({
        eventType: "HANDOFF_MESSAGE_QUEUED",
        tenantId,
        channel: "whatsapp",
        externalUserId: senderPhone,
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
        channel: "whatsapp",
        externalUserId: senderPhone,
        escalationReason: result.escalation.reason,
        escalationDetail: result.escalation.detail,
        summary: result.contextSummary,
        sessionMode: session.sessionMode,
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }

    // Emit TOOL_EXECUTED events for product backend visibility
    if (result.toolExecutions && config.eventEmitter) {
      for (const exec of result.toolExecutions) {
        config.eventEmitter.emit({
          eventType: "TOOL_EXECUTED",
          tenantId,
          channel: "whatsapp",
          externalUserId: senderPhone,
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
        channel: "whatsapp",
        externalUserId: senderPhone,
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
        channel: "whatsapp",
        externalUserId: senderPhone,
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

    replyText = toWhatsAppFormat(stripSuggestionTags(extractText(result.parts)));

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
        channel: "whatsapp",
        externalUserId: senderPhone,
        messageContent: replyText,
        messageRole: "ASSISTANT",
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    trace.error("whatsapp", "Orchestrator error", { tenantId, error: err instanceof Error ? err.message : String(err) });
    replyText = "Something went wrong. Please try again.";
  }

  // Reply via WhatsApp Cloud API
  try {
    await sendWhatsAppMessage(phoneNumberId, resolvedAccessToken, senderPhone, {
      type: "text",
      text: { body: replyText },
    });
  } catch (err) {
    trace.warn("whatsapp", "Failed to send reply", { phoneNumberId, recipient: senderPhone, error: err instanceof Error ? err.message : String(err) });
  }

  // --- Memory: save what was learned from this exchange ---
  if (config.memoryBasePath && messageText.length > 5) {
    try {
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      memory.saveExchange({
        appName: config.appName,
        channel: "whatsapp",
        tenantId,
        participantId: senderPhone,
        userMessage: messageText,
        assistantMessage: replyText,
      });
    } catch (err) {
      trace.warn("whatsapp", "Memory save failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}

/** Handle smb_message_echoes webhook -- business sent a message from the WhatsApp Business App */
async function processCoexistenceEcho(
  config: WhatsAppWebhookConfig,
  tenant: import("@kilnai/core").TenantConfig,
  msg: MetaWebhookMessage,
): Promise<void> {
  const trace = new TraceContext();
  const customerPhone = msg.to!;
  const tenantId = tenant.tenantId;

  if (!tenant.whatsappCoexistence?.enabled) return;

  const session = await config.sessionRegistry.get(config.appName, customerPhone, tenantId);
  if (!session) {
    trace.log("whatsapp", "Coexistence echo: no session for customer", { tenantId, customerPhone });
    return;
  }

  // If already human_active or resolved, just update the timestamp
  if (session.sessionMode !== "ai_active" && session.sessionMode !== "queued") {
    session.recordHumanMessage();
    await config.sessionRegistry.save(session);
    return;
  }

  // Transition to human_active -- human is already actively responding
  session.setSessionMode("human_active");
  session.recordHumanMessage();

  // Inject the business message into session history so AI has context when it resumes
  const echoText = msg.text?.body;
  if (echoText) {
    session.injectOperatorMessage(textParts(echoText));
  }

  await config.sessionRegistry.save(session);

  if (config.eventEmitter) {
    config.eventEmitter.emit({
      eventType: "HUMAN_TAKEOVER",
      tenantId,
      channel: "whatsapp",
      externalUserId: customerPhone,
      sessionId: session.id,
      sessionMode: "human_active",
      handoffSource: "whatsapp_coexistence",
      messageContent: echoText,
      schemaVersion: "1",
      traceId: trace.traceId,
      timestamp: new Date().toISOString(),
    });
  }

  trace.log("whatsapp", "Coexistence: human takeover", { tenantId, customerPhone, sessionId: session.id });
}
