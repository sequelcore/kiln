// Gateway: WS Tenant Routes -- multi-tenant WebSocket endpoint
// Resolves tenant by widgetId, creates per-user sessions, processes chat frames

import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type {
  ArtifactResourceStore,
  ContentPart,
  SttAdapter,
} from "@kilnai/core";
import {
  projectFinalEffectivePromptObservation,
  resolveCommunicationIntent,
  textParts,
  extractText,
  hasModality,
} from "@kilnai/core";
import type { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { EventBus } from "@kilnai/core";
import { CommunicationIntentSchema, type OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { extractSuggestions } from "../tenant/suggestion-parser.js";
import { checkBudget } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import { isOriginAllowed } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";
import {
  AudioTransformError,
  createGatewayAudioTransformSessionId,
  createGenericMediaDownloader,
  emitAudioTransformRoutingEvents,
  transformAudioParts,
} from "./audio-preprocessor.js";
import {
  appendCoordinationProviderFailureAudit,
  projectAdmittedTurnContext,
  resolveCoordinationContextCandidates,
} from "./message-pipeline/index.js";
import type { AdmittedTurnContext } from "./message-pipeline/index.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";
import { sanitizeVisitorInfo, formatVisitorContext } from "./visitor-sanitizer.js";
import type { SanitizedVisitorInfo } from "./visitor-sanitizer.js";
import {
  type GatewayAuthorityAdmissionCommit,
  type GatewayAuthorityAdmissionPort,
} from "./gateway-authority-admission.js";
import { dispatchChannelEgress } from "../channels/channel-egress-action-claim.js";

export interface WsTenantRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly billing?: BillingConfig;
  readonly allowedOrigins?: readonly string[];
  readonly sttAdapter?: SttAdapter;
  readonly artifactStore?: ArtifactResourceStore;
  readonly eventBus?: EventBus;
  readonly coordinationContextProvider?: AdmittedTurnContext["coordinationContextProvider"];
  /** Required Runtime owner for durable authority admission before WS dispatch. */
  readonly gatewayAdmission: GatewayAuthorityAdmissionPort;
}

/** Heartbeat state tracked per WebSocket connection */
interface HeartbeatEntry {
  readonly interval: ReturnType<typeof setInterval>;
  lastPong: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 90_000;

export function createWsTenantRoutes(config: WsTenantRoutesConfig): Hono {
  const app = new Hono();
  const heartbeats = new Map<WSContext, HeartbeatEntry>();
  const visitors = new Map<WSContext, SanitizedVisitorInfo>();

  app.get(
    "/ws",
    async (c, next) => {
      const widgetId = c.req.query("widgetId");
      if (!widgetId) return c.text("widgetId is required", 400);

      const tenant = config.tenantRegistry.resolveByWidgetId(widgetId, config.appName);
      if (!tenant) return c.text("Widget not found", 404);

      const origin = c.req.header("origin") ?? null;
      const origins = tenant.allowedOrigins ?? config.allowedOrigins;
      if (!isOriginAllowed(origin, origins)) {
        return c.text("Origin not allowed", 403);
      }

      await next();
    },
    config.upgradeWebSocket((c) => {
      const widgetId = c.req.query("widgetId")!;
      const tenant = config.tenantRegistry.resolveByWidgetId(widgetId, config.appName)!;

      const userId = c.req.query("userId") ?? crypto.randomUUID();

      return {
        onOpen(_event: Event, ws: WSContext) {
          config.webChannel.addClient(ws, userId);

          // Start heartbeat for stale connection detection
          const entry: HeartbeatEntry = {
            interval: setInterval(() => {
              if (Date.now() - entry.lastPong > HEARTBEAT_TIMEOUT_MS) {
                clearInterval(entry.interval);
                heartbeats.delete(ws);
                try { ws.close(1001, "heartbeat timeout"); } catch { /* already closing */ }
                config.webChannel.removeClient(ws);
                return;
              }
              try { ws.send(JSON.stringify({ type: "ping" })); } catch { /* connection closing */ }
            }, HEARTBEAT_INTERVAL_MS),
            lastPong: Date.now(),
          };
          heartbeats.set(ws, entry);

          const suggestions = tenant.faqEntries?.map((f) => f.q) ?? [];
          const hasWelcomeData = tenant.greeting || suggestions.length > 0 || tenant.preChatForm?.enabled;
          if (hasWelcomeData) {
            ws.send(JSON.stringify({
              type: "welcome",
              ...(tenant.greeting && { greeting: tenant.greeting }),
              ...(suggestions.length > 0 && { suggestions }),
              ...(tenant.preChatForm?.enabled && { preChatForm: tenant.preChatForm }),
            }));
          }
        },
        onClose(_event: CloseEvent, ws: WSContext) {
          const hb = heartbeats.get(ws);
          if (hb) {
            clearInterval(hb.interval);
            heartbeats.delete(ws);
          }
          visitors.delete(ws);
          config.webChannel.removeClient(ws);
        },
        async onMessage(event: MessageEvent, ws: WSContext) {
          // Any client message counts as proof of liveness
          const hb = heartbeats.get(ws);
          if (hb) hb.lastPong = Date.now();

          try {
            const raw = event.data;
            const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            const parsed = JSON.parse(text) as Record<string, unknown>;

            // Pong is a heartbeat reply -- no further processing needed
            if (parsed.type === "pong") return;

            // Identify frame: store sanitized visitor info for this connection
            if (parsed.type === "identify" && parsed.visitor && typeof parsed.visitor === "object") {
              visitors.set(ws, sanitizeVisitorInfo(parsed.visitor as Record<string, unknown>));
              return;
            }

            if (parsed.type === "message") {
              const requestedAuthorityValid = isRequestedAuthority(parsed.requestedAuthority);
              const parsedCommunication = parsed.communicationIntent === undefined
                ? undefined
                : CommunicationIntentSchema.safeParse(parsed.communicationIntent);
              const communicationIntentValid = parsedCommunication === undefined || parsedCommunication.success;
              const communicationIntent = parsedCommunication?.success
                ? resolveCommunicationIntent([{ source: "user", intent: parsedCommunication.data }])
                : undefined;
              const trace = new TraceContext();
              trace.log("ws", "Message received", { tenantId: tenant.tenantId, userId });
              const clientMessageId = typeof parsed.messageId === "string"
                ? parsed.messageId
                : typeof parsed.requestId === "string"
                  ? parsed.requestId
                  : typeof parsed.id === "string" ? parsed.id : undefined;
              const ingressId = clientMessageId
                ? `ws:${tenant.tenantId}:${userId}:${clientMessageId}`
                : crypto.randomUUID();

              const visitor = visitors.get(ws);

              let userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

              // A consequential inbound STT action needs a stable caller and
              // idempotency identity. Do not manufacture a random replay key
              // for an audio frame that the client cannot identify.
              if (config.sttAdapter && hasModality(userParts, "audio") && !clientMessageId) {
                return;
              }

              // The session is the identity anchor required by admission;
              // all consequential processing below remains inside one
              // callback, including media/STT, provider, session writes and
              // the outbound WebSocket frames.
              const sessionAnchor = await config.sessionRegistry.getOrCreate({
                appName: config.appName,
                tenantId: tenant.tenantId,
                userId,
                systemPrompt: "",
                idleTimeoutMs: tenant.idleTimeoutMs,
              });
              try {
                await config.gatewayAdmission.execute({
                  ingressId,
                  appName: config.appName,
                  tenantId: tenant.tenantId,
                   userId,
                   sessionId: sessionAnchor.id,
                   channel: "web",
                   userParts,
                   ...(requestedAuthorityValid ? { requestedAuthority: parsed.requestedAuthority as OperatorTurnRequestedAuthority | undefined } : {}),
                 }, async (admitted: GatewayAuthorityAdmissionCommit) => {
                   const session = admitted.session;

               if (!requestedAuthorityValid) {
                 await dispatchWsTenantEgress(config, admitted, ws, {
                   tenantId: tenant.tenantId,
                   userId,
                   ingressId,
                   slot: "error",
                   frame: {
                     type: "error",
                     message: "requestedAuthority must be auto, read_only, audited, or destructive",
                   },
                 });
                 return;
               }
               if (!communicationIntentValid) {
                 await dispatchWsTenantEgress(config, admitted, ws, {
                   tenantId: tenant.tenantId,
                   userId,
                   ingressId,
                   slot: "error",
                   frame: { type: "error", message: "communicationIntent is invalid" },
                 });
                 return;
               }

               if (config.artifactStore) {
                try {
                  userParts = await captureMultimodalArtifacts(userParts, {
                    artifactStore: config.artifactStore,
                    downloader: createGenericMediaDownloader(),
                    sourceKind: "uploaded-file",
                    sourceIdPrefix: `${config.appName}:${tenant.tenantId}:${userId}:web`,
                    producerName: "gateway-web-ingress",
                  });
                 } catch (err) {
                   await dispatchWsTenantEgress(config, admitted, ws, {
                     tenantId: tenant.tenantId,
                     userId,
                     ingressId,
                     slot: "error",
                     frame: {
                       type: "error",
                       message: err instanceof Error ? err.message : String(err),
                     },
                   });
                   return;
                 }
              }

              // Governed audio transform route via STT.
              if (config.sttAdapter && hasModality(userParts, "audio")) {
                try {
                  if (!config.artifactStore) {
                    throw new AudioTransformError("Audio transform artifact store is not configured.", []);
                  }
                  const transformed = await transformAudioParts(userParts, config.sttAdapter, createGenericMediaDownloader(), {
                    artifactStore: config.artifactStore,
                    sourceIdPrefix: `${config.appName}:${tenant.tenantId}:${userId}`,
                    mediaActionClaims: admitted.runtimeMediaActionClaims,
                    authorityAdmission: admitted.bundle,
                    attemptId: admitted.runtimeModelRoundDispatch.attemptId,
                    callerId: `ws:${tenant.tenantId}:${userId}:voice-input`,
                    idempotencyKey: ingressId,
                    logicalSendSlotPrefix: "inbound-stt",
                  });
                  userParts = transformed.parts;
                  emitAudioTransformRoutingEvents({
                    eventBus: config.eventBus,
                    sessionId: createGatewayAudioTransformSessionId(config.appName, tenant.tenantId, userId),
                    tenantId: tenant.tenantId,
                    model: config.sttAdapter.name,
                  }, transformed.transforms);
                } catch (err) {
                  if (err instanceof AudioTransformError) {
                    emitAudioTransformRoutingEvents({
                      eventBus: config.eventBus,
                      sessionId: createGatewayAudioTransformSessionId(config.appName, tenant.tenantId, userId),
                      tenantId: tenant.tenantId,
                      model: config.sttAdapter.name,
                    }, err.transforms);
                     await dispatchWsTenantEgress(config, admitted, ws, {
                       tenantId: tenant.tenantId,
                       userId,
                       ingressId,
                       slot: "error",
                       frame: {
                         type: "error",
                         message: "I could not process that voice note. Please try again or send text.",
                       },
                     });
                     return;
                  }
                  throw err;
                }
              }

              // Resolve billing config once: tenant-level takes precedence
              const activeBilling = tenant.billing?.budgetEndpoint
                ? (tenant.billing as unknown as BillingConfig)
                : config.billing;


              try {
                // Budget check
                if (activeBilling) {
                  const budgetResult = await checkBudget(activeBilling, tenant.tenantId);
                   if (!budgetResult.allowed) {
                     await dispatchWsTenantEgress(config, admitted, ws, {
                       tenantId: tenant.tenantId,
                       userId,
                       ingressId,
                       slot: "error",
                       frame: {
                         type: "error",
                         code: "BUDGET_EXHAUSTED",
                         message: tenant.billing?.overBudgetMessage
                           ?? activeBilling.overBudgetMessage ?? "Budget exhausted.",
                       },
                     });
                     return;
                  }
                }

                // Resolve agent context (multi-agent routing with ping-pong guard)
                const agentCtx = await resolveAgentContextAsync(
                  tenant, userParts, session,
                  { eventBus: config.eventBus },
                  "web",
                );

                // Update session with resolved prompt and agent
                session.setSystemPrompt(agentCtx.systemPrompt);
                if (agentCtx.activeAgentId) {
                  session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
                }

                const coordinationContext = await resolveCoordinationContextCandidates(config.coordinationContextProvider, {
                  appName: config.appName,
                  tenantId: tenant.tenantId,
                  userId,
                  sessionId: session.id,
                  channel: "web",
                  activeAgentId: agentCtx.activeAgentId,
                });

                const visitorContext = visitor ? formatVisitorContext(visitor) : undefined;
                const baseProjectedTurnContext = projectAdmittedTurnContext({
                  userContext: session.userContext,
                  cachedRuntimeSummary: undefined,
                  recalledMemoryCandidates: undefined,
                  visitorContext,
                  coordinationContextCandidates: coordinationContext.candidates,
                });
                const projectedTurnContext = {
                  ...baseProjectedTurnContext,
                  audit: appendCoordinationProviderFailureAudit(
                    baseProjectedTurnContext.audit,
                    coordinationContext.failureReason,
                  ),
                };

                const tenantToolCtx = agentCtx.tenantToolContext;

                // Register webhook tool definitions on the orchestrator
                if (tenantToolCtx.toolDefinitions.length > 0) {
                  config.orchestrator.registerTools(tenantToolCtx.toolDefinitions);
                }

                const admittedSession = admitted.session;
                const result = await config.orchestrator.bindProvider(
                  admitted.provider,
                  admitted.bundle.turn.execution.status === "routed" ? admitted.bundle.turn.execution.target.providerModelId : undefined,
                ).processMessage(
                  admittedSession,
                  userParts,
                  projectedTurnContext,
                  tenantToolCtx.callBuiltinTools.size > 0 ? tenantToolCtx.callBuiltinTools : undefined,
                  {
                    ...admitted.perCallConfig,
                    runtimeModelRoundDispatch: admitted.runtimeModelRoundDispatch,
                    ...(communicationIntent ? { communicationIntent } : {}),
                  },
                );

                // Persist mutated session (required for non-reference stores like Redis)
                await config.sessionRegistry.save(admittedSession);




                // Emit AGENT_ROUTED when multi-agent routing is active

                // Emit AGENT_HANDOFF when an agent switch occurred (or was blocked)

                const { content: responseContent, suggestions: followUpSuggestions } =
                  extractSuggestions(extractText(result.parts));

                const assistantSent = await dispatchWsTenantEgress(config, admitted, ws, {
                  tenantId: tenant.tenantId,
                  userId,
                  ingressId,
                  slot: "assistant",
                  frame: {
                    type: "done",
                    content: responseContent,
                    parts: result.parts,
                    inputTokens: result.inputTokens,
                    outputTokens: result.outputTokens,
                    outcome: result.outcome,
                    communicationResolution: result.communicationResolution,
                    effectivePromptObservation: projectFinalEffectivePromptObservation(result.providerRequests),
                  },
                });
                if (!assistantSent) return;

                if (followUpSuggestions.length > 0) {
                  await dispatchWsTenantEgress(config, admitted, ws, {
                    tenantId: tenant.tenantId,
                    userId,
                    ingressId,
                    slot: "suggestions",
                    frame: {
                      type: "suggestions",
                      items: followUpSuggestions,
                    },
                  });
                }

              } catch {
                await dispatchWsTenantEgress(config, admitted, ws, {
                  tenantId: tenant.tenantId,
                  userId,
                  ingressId,
                  slot: "error",
                  frame: { type: "error", message: "Something went wrong. Please try again." },
                });
              }
                  // Admission rejection is deliberately handled by the
                  // outer catch without emitting an outbound fallback.
                }).catch(() => {
                  // Fail closed: no response is sent when authority admission
                  // itself rejects the message.
                });
              } catch {
                // Discard malformed or rejected messages without egress.
              }
            }
          } catch {
            // Discard malformed messages
          }
        },
      };
    }),
  );

  return app;
}

function isRequestedAuthority(value: unknown): value is OperatorTurnRequestedAuthority | undefined {
  return value === undefined
    || value === "auto"
    || value === "read_only"
    || value === "audited"
    || value === "destructive";
}

type WsTenantEgressFrame = Record<string, unknown>;

/**
 * WebSocket assistant delivery is an external channel effect. The claim is
 * consumed immediately before the one socket call; a closed socket or a
 * duplicate claim is an unknown/no-redispatch outcome, never a fallback send.
 */
async function dispatchWsTenantEgress(
  config: WsTenantRoutesConfig,
  admitted: GatewayAuthorityAdmissionCommit,
  ws: WSContext,
  input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly ingressId: string;
    readonly slot: "assistant" | "suggestions" | "error";
    readonly frame: WsTenantEgressFrame;
  },
): Promise<boolean> {
  try {
    await dispatchChannelEgress({
      context: config.gatewayAdmission.channelEgressActionClaims,
      authorityAdmission: admitted.bundle,
      attemptId: admitted.runtimeModelRoundDispatch.attemptId,
      callerId: `ws:${config.appName}:${input.tenantId}:${input.userId}`,
      idempotencyKey: input.ingressId,
      logicalSendSlot: input.slot,
      channel: "web",
      destination: `web:${config.appName}:${input.tenantId}:${input.userId}`,
      adapterIdentity: "websocket:tenant",
      payload: input.frame,
      send: async () => {
        if (ws.readyState !== 1) throw new Error("WebSocket is not open.");
        ws.send(JSON.stringify(input.frame));
      },
    });
    return true;
  } catch {
    // dispatchChannelEgress has already settled unknown when the socket call
    // was reached. No error frame is attempted because that would be a retry.
    return false;
  }
}
