// Gateway: Email webhook routes -- Hono sub-app for inbound email processing
// Resolves tenant by recipient email address, processes messages via provider-adapter runtime orchestrator, replies via EmailTransport

import { Hono } from "hono";
import type { ContentPart } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import type { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { EventBus, MemoryRepository } from "@kilnai/core";
import { checkBudget } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import { requireWebhookSignature } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";
import { projectAdmittedTurnContext } from "./message-pipeline/index.js";
import { shouldRejectEmail } from "./email-loop-guard.js";
import type { EmailThreadStore, EmailThread } from "./email-thread-store.js";
import { InMemoryEmailThreadStore } from "./email-thread-store.js";
import { renderEmailHtml, renderEmailPlainText } from "../channels/email-template.js";
import type { EmailTransport } from "../channels/email-api.js";
import {
  createTenantConversationMemoryRepository,
  TenantConversationMemory,
} from "./tenant-conversation-memory.js";
import type { GatewayAuthorityAdmissionCommit, GatewayAuthorityAdmissionPort } from "./gateway-authority-admission.js";
import { dispatchChannelEgress } from "../channels/channel-egress-action-claim.js";

export interface EmailWebhookConfig {
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly webhookSecret?: string;
  readonly billing?: BillingConfig;
  readonly memoryBasePath?: string;
  readonly threadStore?: EmailThreadStore;
  readonly emailTransport?: EmailTransport;
  readonly defaultFromAddress?: string;
  readonly defaultFromName?: string;
  readonly eventBus?: EventBus;
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
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
    if (!messageId?.trim()) return c.text("OK", 200);

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

async function dispatchEmailEgress<T>(input: {
  readonly config: EmailWebhookConfig;
  readonly admitted: GatewayAuthorityAdmissionCommit;
  readonly messageId: string;
  readonly recipient: string;
  readonly slot: string;
  readonly payload: unknown;
  readonly send: () => Promise<T>;
}): Promise<T> {
  return dispatchChannelEgress({
    context: input.config.gatewayAdmission.channelEgressActionClaims,
    authorityAdmission: input.admitted.bundle,
    attemptId: input.admitted.runtimeModelRoundDispatch.attemptId,
    callerId: `email:webhook:${input.messageId}`,
    idempotencyKey: input.messageId,
    logicalSendSlot: input.slot,
    channel: "email",
    destination: `email:${input.recipient}`,
    adapterIdentity: "email-transport:configured",
    payload: input.payload,
    send: input.send,
  });
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
  admitted?: GatewayAuthorityAdmissionCommit,
): Promise<void> {
  const trace = new TraceContext();
  trace.log("email", "Processing message", { tenantId, from: senderEmail, subject });

  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  // Extract text content (prefer plain text over HTML)
  const messageText = (payload.textBody ?? "").trim();
  if (!messageText) return;

  const messageParts: readonly ContentPart[] = [{ type: "text", text: messageText }];

  // Keep thread/memory/agent/provider/outbound/session effects in
  // one admission callback. The session is the identity anchor required by
  // the Runtime admission port; no productive work occurs before the fence.
  if (!admitted) {
    const session = await config.sessionRegistry.getOrCreate({
      appName: config.appName,
      tenantId,
      userId: `email:${senderEmail}`,
      systemPrompt: "",
      idleTimeoutMs: tenant.idleTimeoutMs,
    });
    await config.gatewayAdmission.execute({
      ingressId: `email:${messageId}`,
      appName: config.appName,
      tenantId,
      userId: `email:${senderEmail}`,
      sessionId: session.id,
      channel: "email",
      userParts: messageParts,
    }, (commit) => processEmailMessage(config, threadStore, tenantId, senderEmail, _recipientEmail, subject, messageId, payload, commit));
    return;
  }

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

  // --- Memory: recall past context about this user ---
  let recalledMemory: ReturnType<TenantConversationMemory["recall"]>;
  if (config.memoryBasePath) {
    try {
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      const query = `${senderEmail} ${messageText}`;
      recalledMemory = memory.recall({
        tenantId,
        participantId: senderEmail,
        query,
      });
    } catch (err) {
      trace.warn("email", "Memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const session = admitted.session;

  // Resolve agent context (multi-agent routing with ping-pong guard)
  const agentCtx = await resolveAgentContextAsync(
    tenant, messageParts, session,
    { eventBus: config.eventBus },
    "email",
  );

  // Update session with resolved prompt and agent
  session.setSystemPrompt(agentCtx.systemPrompt);
  if (agentCtx.activeAgentId) {
    session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
  }

  const projectedTurnContext = projectAdmittedTurnContext({
    userContext: session.userContext,
    cachedRuntimeSummary: undefined,
    recalledMemoryCandidates: recalledMemory?.candidates,
  });

  const tenantToolCtx = agentCtx.tenantToolContext;

  // Register webhook tool definitions on the orchestrator
  if (tenantToolCtx.toolDefinitions.length > 0) {
    config.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
  }

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


  let replyText: string;
  try {
    const result = await config.orchestrator.bindProvider(
        admitted.provider,
        admitted.bundle.turn.execution.status === "routed" ? admitted.bundle.turn.execution.route.providerModelId : undefined,
      ).processMessage(
      admitted.session,
      messageParts,
      projectedTurnContext,
      tenantToolCtx.callBuiltinTools.size > 0 ? tenantToolCtx.callBuiltinTools : undefined,
      {
        ...admitted.perCallConfig,
        runtimeModelRoundDispatch: admitted.runtimeModelRoundDispatch,
      },
    );

    // Persist mutated session while the account fence is still held.
    await config.sessionRegistry.save(admitted.session);




    // Emit AGENT_ROUTED when multi-agent routing is active

    // Emit AGENT_HANDOFF when an agent switch occurred (or was blocked)

    replyText = extractText(result.parts);

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

        const emailPayload = {
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
        };
        const sendResult = await dispatchEmailEgress({
          config,
          admitted,
          messageId,
          recipient: senderEmail,
          slot: "assistant-reply",
          payload: emailPayload,
          send: () => config.emailTransport!.send(emailPayload),
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
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      memory.saveExchange({
        appName: config.appName,
        channel: "email",
        tenantId,
        participantId: senderEmail,
        userMessage: messageText,
        assistantMessage: replyText,
      });
    } catch (err) {
      trace.warn("email", "Memory save failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
