// Gateway: Instagram DM webhook routes -- Hono sub-app for Instagram messaging
// Resolves tenant by Instagram Page ID, processes messages via provider-adapter runtime orchestrator, replies via Instagram API

import { Hono } from "hono";
import type { ContentPart } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import { toInstagramFormat } from "../channels/message-formatter.js";
import type { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { ArtifactResourceStore, EventBus, MemoryRepository } from "@kilnai/core";
import { sendInstagramMediaMessage, sendInstagramMessage, INSTAGRAM_GRAPH_API_VERSION } from "../channels/instagram-api.js";
import { dispatchChannelEgress } from "../channels/channel-egress-action-claim.js";
import { checkBudget } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import { requireWebhookSignature } from "./auth-middleware.js";
import type { GatewayAuthorityAdmissionCommit, GatewayAuthorityAdmissionPort } from "./gateway-authority-admission.js";
import { verifyMetaWebhook } from "./meta-webhook-foundation.js";
import { TraceContext } from "./trace-context.js";
import type { WebhookDedup } from "./webhook-dedup.js";
import type { SttAdapter, TtsAdapter, VoiceConfig } from "@kilnai/core";
import {
  AudioTransformError,
  createGatewayAudioTransformSessionId,
  createGenericMediaDownloader,
  emitAudioTransformRoutingEvents,
  transformAudioParts,
} from "./audio-preprocessor.js";
import { projectAdmittedTurnContext } from "./message-pipeline/index.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";
import { resolveOutboundAudioMedia } from "./public-media-delivery.js";
import type { SignedArtifactMediaOptions } from "./public-media-delivery.js";
import {
  createTenantConversationMemoryRepository,
  TenantConversationMemory,
} from "./tenant-conversation-memory.js";
import { synthesizeVoiceOutput } from "./voice-output-synthesizer.js";

export interface InstagramWebhookConfig {
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly verifyToken: string;
  readonly appSecret?: string;
  readonly billing?: BillingConfig;
  readonly memoryBasePath?: string;
  readonly sttAdapter?: SttAdapter;
  readonly artifactStore?: ArtifactResourceStore;
  readonly voiceConfig?: VoiceConfig;
  readonly ttsAdapter?: TtsAdapter;
  readonly publicMedia?: SignedArtifactMediaOptions;
  readonly dedup?: WebhookDedup;
  readonly eventBus?: EventBus;
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
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
        if (!messaging.message?.mid) continue;

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
          messaging.message.mid,
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

async function dispatchInstagramEgress<T>(input: {
  readonly config: InstagramWebhookConfig;
  readonly admitted: GatewayAuthorityAdmissionCommit;
  readonly messageId: string;
  readonly pageId: string;
  readonly recipient: string;
  readonly slot: string;
  readonly payload: unknown;
  readonly send: () => Promise<T>;
}): Promise<T> {
  return dispatchChannelEgress({
    context: input.config.gatewayAdmission.channelEgressActionClaims,
    authorityAdmission: input.admitted.bundle,
    attemptId: input.admitted.runtimeModelRoundDispatch.attemptId,
    callerId: `instagram:webhook:${input.messageId}`,
    idempotencyKey: input.messageId,
    logicalSendSlot: input.slot,
    channel: "instagram",
    destination: `instagram:${input.pageId}:${input.recipient}`,
    adapterIdentity: `instagram-graph:${INSTAGRAM_GRAPH_API_VERSION}:${input.pageId}`,
    payload: input.payload,
    send: input.send,
  });
}

async function processInstagramMessage(
  config: InstagramWebhookConfig,
  tenantId: string,
  senderId: string,
  messageParts: readonly ContentPart[],
  messageId: string,
  pageId: string,
  accessToken?: string,
  admitted?: GatewayAuthorityAdmissionCommit,
): Promise<void> {
  const trace = new TraceContext();
  trace.log("instagram", "Processing message", { tenantId, from: senderId });

  const tenant = config.tenantRegistry.get(tenantId);
  if (!tenant) return;

  // Keep the entire consequential webhook lifecycle under one admission
  // callback. The session is the identity anchor; preprocessing, provider,
  // TTS/media, outbound API calls, and durable writes run under the fence.
  if (!admitted) {
    const session = await config.sessionRegistry.getOrCreate({
      appName: config.appName,
      tenantId,
      userId: senderId,
      systemPrompt: "",
      idleTimeoutMs: tenant.idleTimeoutMs,
    });
    await config.gatewayAdmission.execute({
      ingressId: `instagram:${messageId}`,
      appName: config.appName,
      tenantId,
      userId: senderId,
      sessionId: session.id,
      channel: "instagram",
      userParts: messageParts,
    }, (commit) => processInstagramMessage(config, tenantId, senderId, messageParts, messageId, pageId, accessToken, commit));
    return;
  }

  const resolvedAccessToken = accessToken
    ? (process.env[accessToken] ?? accessToken)
    : "";

  const mediaDownloader = createGenericMediaDownloader();
  let processedParts = messageParts;
  if (config.artifactStore) {
    processedParts = await captureMultimodalArtifacts(processedParts, {
      artifactStore: config.artifactStore,
      downloader: mediaDownloader,
      sourceKind: "webhook-attachment",
      sourceIdPrefix: `${config.appName}:${tenantId}:${senderId}:instagram`,
      producerName: "gateway-instagram-ingress",
    });
  }

  // Governed audio transform route via STT -- Instagram CDN URLs don't need auth.
  if (config.sttAdapter) {
    try {
      if (!config.artifactStore) {
        throw new AudioTransformError("Audio transform artifact store is not configured.", []);
      }
      const transformed = await transformAudioParts(processedParts, config.sttAdapter, mediaDownloader, {
        artifactStore: config.artifactStore,
        sourceIdPrefix: `${config.appName}:${tenantId}:${senderId}`,
        mediaActionClaims: admitted.runtimeMediaActionClaims,
        authorityAdmission: admitted.bundle,
        attemptId: admitted.runtimeModelRoundDispatch.attemptId,
        callerId: `instagram:webhook:${messageId}:voice-input`,
        idempotencyKey: messageId,
        logicalSendSlotPrefix: "inbound-stt",
      });
      processedParts = transformed.parts;
      emitAudioTransformRoutingEvents({
        eventBus: config.eventBus,
        sessionId: createGatewayAudioTransformSessionId(config.appName, tenantId, senderId),
        tenantId,
        model: config.sttAdapter.name,
      }, transformed.transforms);
    } catch (err) {
      if (err instanceof AudioTransformError) {
        emitAudioTransformRoutingEvents({
          eventBus: config.eventBus,
          sessionId: createGatewayAudioTransformSessionId(config.appName, tenantId, senderId),
          tenantId,
          model: config.sttAdapter.name,
        }, err.transforms);
        trace.warn("instagram", "Audio transform failed", { error: err.message });
        try {
          await dispatchInstagramEgress({
            config,
            admitted,
            messageId,
            pageId,
            recipient: senderId,
            slot: "audio-transform-failure",
            payload: { recipient: { id: senderId }, message: { text: "I could not process that voice note. Please try again or send text." } },
            send: () => sendInstagramMessage(pageId, resolvedAccessToken, senderId, "I could not process that voice note. Please try again or send text."),
          });
        } catch (sendErr) {
          trace.warn("instagram", "Failed to send audio transform failure reply", {
            error: sendErr instanceof Error ? sendErr.message : String(sendErr),
          });
        }
        return;
      }
      trace.warn("instagram", "Audio transform failed", { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  const messageText = extractText(processedParts);

  // --- Memory: recall past context about this user ---
  let recalledMemory: ReturnType<TenantConversationMemory["recall"]>;
  if (config.memoryBasePath) {
    try {
      const memory = getConversationMemory(config.memoryBasePath, config.eventBus);
      const query = `${senderId} ${messageText}`;
      recalledMemory = memory.recall({
        tenantId,
        participantId: senderId,
        query,
      });
    } catch (err) {
      trace.warn("instagram", "Memory recall failed", { tenantId, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const session = admitted.session;

  // Resolve agent context (multi-agent routing with ping-pong guard)
  const agentCtx = await resolveAgentContextAsync(
    tenant, processedParts, session,
    { eventBus: config.eventBus },
    "instagram",
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
      const overBudgetMsg = tenant.billing?.overBudgetMessage
        ?? activeBilling.overBudgetMessage ?? "Budget exhausted.";
      trace.log("instagram", "Budget exhausted", { tenantId, sender: senderId });
      try {
        await dispatchInstagramEgress({
          config,
          admitted,
          messageId,
          pageId,
          recipient: senderId,
          slot: "budget-exhausted",
          payload: { recipient: { id: senderId }, message: { text: overBudgetMsg } },
          send: () => sendInstagramMessage(pageId, resolvedAccessToken, senderId, overBudgetMsg),
        });
      } catch (err) {
        trace.warn("instagram", "Failed to send over-budget reply", { error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
  }


  let replyText: string;
  let replyAudioUrls: string[] = [];
  try {
    const result = await config.orchestrator.bindProvider(
        admitted.provider,
        admitted.bundle.turn.execution.status === "routed" ? admitted.bundle.turn.execution.route.providerModelId : undefined,
      ).processMessage(
      admitted.session,
      processedParts,
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

    const voiceSynthesis = await synthesizeVoiceOutput(
      result.parts,
      config.voiceConfig,
      config.ttsAdapter,
      {
        artifactStore: config.artifactStore,
        appName: config.appName,
        tenantId,
        userId: senderId,
        channel: "instagram",
        sessionId: session.id,
        model: config.orchestrator.model ?? "gateway-transform",
        retentionMaxArtifacts: config.voiceConfig?.policy?.artifacts?.retentionMaxArtifacts,
        mediaActionClaims: admitted.runtimeMediaActionClaims,
        authorityAdmission: admitted.bundle,
        attemptId: admitted.runtimeModelRoundDispatch.attemptId,
        callerId: `instagram:webhook:${messageId}:voice-output`,
        idempotencyKey: messageId,
        logicalSendSlot: "assistant-tts",
      },
    );
    const responseParts = voiceSynthesis.parts;
    const audioMedia = await resolveOutboundAudioMedia(responseParts, {
      publicMedia: config.publicMedia,
    });
    for (const failure of audioMedia.failures) {
      trace.warn("instagram", "Audio media delivery skipped", {
        index: failure.index,
        reason: failure.reason,
        ...(failure.artifactUri ? { artifactUri: failure.artifactUri } : {}),
      });
    }
    replyAudioUrls = audioMedia.deliveries.map((delivery) => delivery.url);
    replyText = toInstagramFormat(extractText(responseParts));

  } catch (err) {
    trace.error("instagram", "Orchestrator error", { tenantId, error: err instanceof Error ? err.message : String(err) });
    replyText = "Something went wrong. Please try again.";
  }

  // Reply via Instagram API
  try {
    await dispatchInstagramEgress({
      config,
      admitted,
      messageId,
      pageId,
      recipient: senderId,
      slot: "assistant-text",
      payload: { recipient: { id: senderId }, message: { text: replyText } },
      send: () => sendInstagramMessage(pageId, resolvedAccessToken, senderId, replyText),
    });
  } catch (err) {
    trace.warn("instagram", "Failed to send reply", { pageId, recipient: senderId, error: err instanceof Error ? err.message : String(err) });
  }
  for (const [index, audioUrl] of replyAudioUrls.entries()) {
    try {
      await dispatchInstagramEgress({
        config,
        admitted,
        messageId,
        pageId,
        recipient: senderId,
        slot: `assistant-audio:${index}`,
        payload: { recipient: { id: senderId }, message: { attachment: { type: "audio", payload: { url: audioUrl } } } },
        send: () => sendInstagramMediaMessage(pageId, resolvedAccessToken, senderId, audioUrl, "audio"),
      });
    } catch (err) {
      trace.warn("instagram", "Failed to send audio reply", { pageId, recipient: senderId, error: err instanceof Error ? err.message : String(err) });
    }
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
