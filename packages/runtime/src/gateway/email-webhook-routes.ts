// Gateway: Email webhook routes -- Hono sub-app for inbound email processing
// Resolves tenant by recipient email address, processes messages via Mode B orchestrator, replies via EmailTransport

import { Hono } from "hono";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ContentPart, ToolDefinition } from "@kilnai/core";
import { extractText, SqliteMemoryStore } from "@kilnai/core";
import type { ModeBOrchestrator, PerCallToolConfig } from "../session/mode-b-orchestrator.js";
import { buildTenantToolContext } from "./tenant-tool-factory.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { requireWebhookSignature } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";
import type { RetrievalPipeline, ContactMemoryService } from "@kilnai/core";
import { formatKnowledgeContext, formatContactContext, mergeContextSources } from "./context-formatter.js";
import { shouldRejectEmail } from "./email-loop-guard.js";
import type { EmailThreadStore, EmailThread } from "./email-thread-store.js";
import { InMemoryEmailThreadStore } from "./email-thread-store.js";
import { renderEmailHtml, renderEmailPlainText } from "../channels/email-template.js";
import type { EmailTransport } from "../channels/email-api.js";

export interface EmailWebhookConfig {
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly webhookSecret?: string;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly memoryBasePath?: string;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactMemoryService?: ContactMemoryService;
  readonly threadStore?: EmailThreadStore;
  readonly emailTransport?: EmailTransport;
  readonly defaultFromAddress?: string;
  readonly defaultFromName?: string;
}

/** Inbound email payload (provider-agnostic) */
interface InboundEmailPayload {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  inReplyTo?: string;
  references?: string;
  textBody: string;
  htmlBody?: string;
  headers: Record<string, string>;
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

/** Add Re: prefix to subject if not already present */
function replySubject(subject: string): string {
  const trimmed = subject.trim();
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function createEmailWebhookRoutes(config: EmailWebhookConfig): Hono {
  const app = new Hono();
  const threadStore = config.threadStore ?? new InMemoryEmailThreadStore();

  // HMAC-SHA256 signature validation if webhook secret is configured
  if (config.webhookSecret) {
    app.use("/webhook", requireWebhookSignature(config.webhookSecret, "x-webhook-signature"));
  }

  // POST /webhook -- Incoming email from webhook provider
  app.post("/webhook", async (c) => {
    let payload: InboundEmailPayload;
    try {
      payload = await c.req.json<InboundEmailPayload>();
    } catch {
      return c.text("OK", 200);
    }

    const { from, to, subject, messageId, headers } = payload;

    // Loop guard: reject auto-replies and system senders
    const rejection = shouldRejectEmail(from, headers ?? {});
    if (rejection.reject) {
      const trace = new TraceContext();
      trace.log("email", "Rejected inbound email", { from, reason: rejection.reason });
      return c.text("OK", 200);
    }

    // Self-send detection: prevent loops from email forwarding
    if (from.toLowerCase() === to.toLowerCase()) {
      const trace = new TraceContext();
      trace.log("email", "Rejected self-send", { from, to });
      return c.text("OK", 200);
    }

    // Resolve tenant by recipient email address
    const tenant = (config.tenantRegistry as TenantRegistry & { resolveByEmailAddress(email: string, appName: string): ReturnType<TenantRegistry["get"]> })
      .resolveByEmailAddress(to, config.appName);
    if (!tenant) {
      const trace = new TraceContext();
      trace.warn("email", "No tenant found", { to, appName: config.appName });
      return c.text("OK", 200);
    }

    // Fire and forget -- process in background
    const promise = processEmailMessage(
      config,
      threadStore,
      tenant.tenantId,
      from,
      to,
      subject ?? "(no subject)",
      messageId,
      payload,
    );

    promise.catch((err) => {
      const failTrace = new TraceContext();
      failTrace.warn("email", "Message processing failed", { error: String(err) });
    });

    return c.text("OK", 200);
  });

  return app;
}

async function processEmailMessage(
  config: EmailWebhookConfig,
  threadStore: EmailThreadStore,
  tenantId: string,
  senderEmail: string,
  _recipientEmail: string,
  subject: string,
  messageId: string,
  payload: InboundEmailPayload,
): Promise<void> {
  const trace = new TraceContext();
  trace.log("email", "Processing message", { tenantId, from: senderEmail, subject });

  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  const systemPrompt = buildTenantSystemPrompt(tenant, "email");

  // Extract text content (prefer plain text over HTML)
  const messageText = (payload.textBody ?? "").trim();
  if (!messageText) return;

  const messageParts: readonly ContentPart[] = [{ type: "text", text: messageText }];

  // --- Thread tracking ---
  const references = payload.references
    ? payload.references.split(/\s+/).filter(Boolean)
    : [];
  const lookupRefs = payload.inReplyTo
    ? [payload.inReplyTo, ...references]
    : references;

  let thread: EmailThread | undefined;
  if (lookupRefs.length > 0) {
    thread = threadStore.getByMessageId(payload.inReplyTo ?? "") ?? threadStore.getByReference(references);
  }

  if (thread) {
    // Add this message to existing thread
    thread.messageIds.push(messageId);
    (thread as { lastActivityAt: Date }).lastActivityAt = new Date();
    threadStore.save(thread);
  } else {
    // Create new thread
    thread = {
      threadId: messageId,
      tenantId,
      senderEmail,
      subject,
      messageIds: [messageId],
      createdAt: new Date(),
      lastActivityAt: new Date(),
    };
    threadStore.save(thread);
  }

  const userId = `email:${senderEmail}`;

  const session = await config.sessionRegistry.getOrCreate({
    appName: config.appName,
    tenantId,
    userId,
    systemPrompt,
    idleTimeoutMs: tenant.idleTimeoutMs,
  });

  // --- Memory: recall past context about this user ---
  let recalledMemory: string | undefined;
  if (config.memoryBasePath) {
    try {
      const store = getMemoryStore(config.memoryBasePath, tenantId);
      const query = `${senderEmail} ${messageText}`;
      recalledMemory = await store.recall(query, 500) || undefined;
    } catch (err) {
      trace.warn("email", "Memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
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
        trace.warn("email", "Knowledge retrieval failed", { error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // --- Contact memory: recall persistent facts about this user ---
  let contactContext: string | undefined;
  if (config.contactMemoryService) {
    try {
      const facts = await config.contactMemoryService.recall(senderEmail, tenantId);
      contactContext = formatContactContext(facts);
    } catch (err) {
      trace.warn("email", "Contact memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const combinedMemory = mergeContextSources(recalledMemory, knowledgeContext, contactContext);

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

  // Build tenant tool context (webhook tools, allowlist, rate limiter)
  const tenantToolCtx = buildTenantToolContext(tenant, callTools);

  // Register webhook tool definitions on the orchestrator
  if (tenantToolCtx.toolDefinitions.length > 0) {
    config.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
  }

  const perCallConfig: PerCallToolConfig = {
    toolAllowlist: tenantToolCtx.toolAllowlist,
    rateLimiter: tenantToolCtx.rateLimiter,
    tenantId: tenant.tenantId,
    additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
  };

  // --- Budget check ---
  const activeBilling = tenant.billing?.budgetEndpoint
    ? (tenant.billing as unknown as BillingConfig)
    : config.billing;
  if (activeBilling) {
    const budgetResult = await checkBudget(activeBilling, tenantId);
    if (!budgetResult.allowed) {
      trace.log("email", "Budget exhausted", { tenantId, sender: senderEmail });
      // Do not reply -- silently drop when budget exhausted for email
      return;
    }
  }

  // Emit MESSAGE_RECEIVED event (fire-and-forget)
  if (config.eventEmitter) {
    config.eventEmitter.emit({
      eventType: "MESSAGE_RECEIVED",
      tenantId,
      channel: "email",
      externalUserId: senderEmail,
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
      messageParts,
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
        channel: "email",
        externalUserId: senderEmail,
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
        channel: "email",
        externalUserId: senderEmail,
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
          channel: "email",
          externalUserId: senderEmail,
          toolName: exec.toolName,
          durationMs: exec.durationMs,
          success: exec.success,
          resultSummary: exec.resultSummary,
          traceId: trace.traceId,
          timestamp: new Date().toISOString(),
        });
      }
    }

    replyText = extractText(result.parts);

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
        channel: "email",
        externalUserId: senderEmail,
        messageContent: replyText,
        messageRole: "ASSISTANT",
        traceId: trace.traceId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    trace.error("email", "Orchestrator error", { tenantId, error: err instanceof Error ? err.message : String(err) });
    replyText = "Something went wrong. Please try again.";
  }

  // --- Send reply email ---
  if (config.emailTransport) {
    try {
      const fromAddress = tenant.emailFromAddress ?? tenant.emailAddress ?? config.defaultFromAddress;
      if (!fromAddress) {
        trace.warn("email", "No from address configured", { tenantId });
      } else {
        const branding = {
          businessName: tenant.businessName ?? tenant.name,
        };
        const replySubj = replySubject(subject);
        const threadRefs = thread.messageIds.join(" ");

        const sendResult = await config.emailTransport.send({
          from: fromAddress,
          fromName: tenant.emailFromName ?? tenant.businessName ?? tenant.name ?? config.defaultFromName,
          to: senderEmail,
          subject: replySubj,
          htmlBody: renderEmailHtml(replyText, branding),
          textBody: renderEmailPlainText(replyText),
          inReplyTo: messageId,
          references: threadRefs,
          headers: {
            "Auto-Submitted": "auto-replied",
            "X-Auto-Response-Suppress": "All",
          },
        });

        // Update thread with outbound messageId
        if (sendResult.messageId) {
          thread.messageIds.push(sendResult.messageId);
          (thread as { lastActivityAt: Date }).lastActivityAt = new Date();
          threadStore.save(thread);
        }
      }
    } catch (err) {
      trace.warn("email", "Failed to send reply", { tenantId, recipient: senderEmail, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // --- Memory: save what was learned from this exchange ---
  if (config.memoryBasePath && messageText.length > 5) {
    try {
      const store = getMemoryStore(config.memoryBasePath, tenantId);
      await store.save({
        layer: "user",
        content: `[${senderEmail}] User: ${messageText}\nAssistant: ${replyText}`,
        tags: [senderEmail],
      });
    } catch (err) {
      trace.warn("email", "Memory save failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
