// Gateway: WS Tenant Routes -- multi-tenant WebSocket endpoint
// Resolves tenant by widgetId, creates per-user sessions, processes chat frames

import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type {
  ArtifactResourceStore,
  ContentPart,
  SttAdapter,
  RetrievalPipeline,
  ContactMemoryService,
} from "@kilnai/core";
import { textParts, extractText, hasModality } from "@kilnai/core";
import type { RuntimeSessionOrchestrator, PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import type { SessionRegistry } from "../session/persistence/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { resolveAgentContextAsync } from "../tenant/agent-resolver.js";
import type { AgentHandoffSummarizer } from "../session/support/summarization/agent-handoff-summarizer.js";
import type { EventBus } from "@kilnai/core";
import type { OperatorTurnRequestedAuthority } from "@kilnai/gateway-contracts";
import { extractSuggestions } from "../tenant/suggestion-parser.js";
import { projectEffectiveTurnAuthorityPerCallConfig } from "../session/effective-turn-authority.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { isOriginAllowed } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";
import {
  AudioTransformError,
  createGatewayAudioTransformSessionId,
  createGenericMediaDownloader,
  emitAudioTransformRoutingEvents,
  transformAudioParts,
} from "./audio-preprocessor.js";
import { formatKnowledgeContext, formatContactContext } from "./context-formatter.js";
import {
  appendCoordinationProviderFailureAudit,
  projectAdmittedTurnContext,
  resolveCoordinationContextCandidates,
} from "./message-pipeline/index.js";
import type { AdmittedTurnContext } from "./message-pipeline/index.js";
import { captureMultimodalArtifacts } from "./multimodal-artifact-ingestion.js";
import { sanitizeVisitorInfo, formatVisitorContext } from "./visitor-sanitizer.js";
import type { SanitizedVisitorInfo } from "./visitor-sanitizer.js";
import { authorityFromCapability } from "./tool-authority.js";

export interface WsTenantRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly appName: string;
  readonly orchestrator: RuntimeSessionOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly allowedOrigins?: readonly string[];
  readonly sttAdapter?: SttAdapter;
  readonly artifactStore?: ArtifactResourceStore;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactMemoryService?: ContactMemoryService;
  readonly handoffSummarizer?: AgentHandoffSummarizer;
  readonly eventBus?: EventBus;
  readonly coordinationContextProvider?: AdmittedTurnContext["coordinationContextProvider"];
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
              if (!isRequestedAuthority(parsed.requestedAuthority)) {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "requestedAuthority must be auto, read_only, audited, or destructive",
                }));
                return;
              }
              const trace = new TraceContext();
              trace.log("ws", "Message received", { tenantId: tenant.tenantId, userId });

              const visitor = visitors.get(ws);
              const displayName = visitor?.displayName;

              let userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

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
                  ws.send(JSON.stringify({
                    type: "error",
                    message: err instanceof Error ? err.message : String(err),
                  }));
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
                    ws.send(JSON.stringify({
                      type: "error",
                      message: "I could not process that voice note. Please try again or send text.",
                    }));
                    return;
                  }
                  throw err;
                }
              }

              // Resolve billing config once: tenant-level takes precedence
              const activeBilling = tenant.billing?.budgetEndpoint
                ? (tenant.billing as unknown as BillingConfig)
                : config.billing;

              // Emit MESSAGE_RECEIVED event (fire-and-forget)
              if (config.eventEmitter) {
                config.eventEmitter.emit({
                  eventType: "MESSAGE_RECEIVED",
                  tenantId: tenant.tenantId,
                  channel: "web",
                  externalUserId: userId,
                  displayName,
                  messageContent: extractText(userParts),
                  messageRole: "USER",
                  traceId: trace.traceId,
                  timestamp: new Date().toISOString(),
                });
              }

              try {
                // Budget check
                if (activeBilling) {
                  const budgetResult = await checkBudget(activeBilling, tenant.tenantId);
                  if (!budgetResult.allowed) {
                    ws.send(JSON.stringify({
                      type: "error",
                      code: "BUDGET_EXHAUSTED",
                      message: tenant.billing?.overBudgetMessage
                        ?? activeBilling.overBudgetMessage ?? "Budget exhausted.",
                    }));
                    return;
                  }
                }

                // Get or create session first (needed for ping-pong guard)
                const session = await config.sessionRegistry.getOrCreate({
                  appName: config.appName,
                  tenantId: tenant.tenantId,
                  userId,
                  systemPrompt: "",
                  idleTimeoutMs: tenant.idleTimeoutMs,
                });

                // Resolve agent context (multi-agent routing with ping-pong guard)
                const agentCtx = await resolveAgentContextAsync(
                  tenant, userParts, session,
                  { handoffSummarizer: config.handoffSummarizer, eventBus: config.eventBus },
                  "web",
                );

                // Update session with resolved prompt and agent
                session.setSystemPrompt(agentCtx.systemPrompt);
                if (agentCtx.activeAgentId) {
                  session.setActiveAgent(agentCtx.activeAgentId, agentCtx.handoffBrief);
                }

                // Knowledge retrieval (auto mode)
                let knowledgeContext: string | undefined;
                if (config.knowledgePipeline && (config.knowledgeMode ?? "auto") === "auto") {
                  const queryText = extractText(userParts);
                  if (queryText.length > 0) {
                    try {
                      const results = await config.knowledgePipeline.retrieve(queryText, { topK: 5 });
                      knowledgeContext = formatKnowledgeContext(results);
                    } catch {
                      // fail-open
                    }
                  }
                }

                // Contact memory recall (fail-open)
                let contactContext: string | undefined;
                if (config.contactMemoryService) {
                  try {
                    const facts = await config.contactMemoryService.recall(userId, tenant.tenantId);
                    contactContext = formatContactContext(facts);
                  } catch {
                    // fail-open
                  }
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
                  knowledgeContext,
                  contactContext,
                  visitorContext,
                  groundingMode: tenant.groundingMode,
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

                const perCallConfig = projectRequestedAuthorityPerCallConfig({
                  toolAllowlist: tenantToolCtx.toolAllowlist,
                  rateLimiter: tenantToolCtx.rateLimiter,
                  tenantId: tenant.tenantId,
                  toolAuthority: tenantToolCtx.toolAuthority,
                  additionalTools: tenantToolCtx.toolDefinitions.length > 0 ? tenantToolCtx.toolDefinitions : undefined,
                  perCallCapabilities: tenantToolCtx.capabilities.size > 0 ? tenantToolCtx.capabilities : undefined,
                }, parsed.requestedAuthority);

                const result = await config.orchestrator.processMessage(
                  session,
                  userParts,
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
                    tenantId: tenant.tenantId,
                    channel: "web",
                    externalUserId: userId,
                    displayName,
                    sessionMode: session.sessionMode,
                    traceId: trace.traceId,
                    timestamp: new Date().toISOString(),
                  });
                }

                // Emit escalation event when detected
                if (result.escalation && config.eventEmitter) {
                  config.eventEmitter.emit({
                    eventType: "ESCALATION_DETECTED",
                    tenantId: tenant.tenantId,
                    channel: "web",
                    externalUserId: userId,
                    displayName,
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
                      tenantId: tenant.tenantId,
                      channel: "web",
                      externalUserId: userId,
                      displayName,
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
                    tenantId: tenant.tenantId,
                    channel: "web",
                    externalUserId: userId,
                    displayName,
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
                    tenantId: tenant.tenantId,
                    channel: "web",
                    externalUserId: userId,
                    displayName,
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

                // Report usage (fire-and-forget)
                if (activeBilling) {
                  reportUsage(activeBilling, {
                    tenantId: tenant.tenantId,
                    messages: 1,
                    tokens: result.inputTokens + result.outputTokens,
                    model: config.orchestrator.model ?? "unknown",
                  });
                }

                const { content: responseContent, suggestions: followUpSuggestions } =
                  extractSuggestions(extractText(result.parts));

                ws.send(JSON.stringify({
                  type: "done",
                  content: responseContent,
                  parts: result.parts,
                  inputTokens: result.inputTokens,
                  outputTokens: result.outputTokens,
                  outcome: result.outcome,
                }));

                if (followUpSuggestions.length > 0) {
                  ws.send(JSON.stringify({
                    type: "suggestions",
                    items: followUpSuggestions,
                  }));
                }

                // Emit MESSAGE_SENT event (fire-and-forget)
                if (config.eventEmitter) {
                  config.eventEmitter.emit({
                    eventType: "MESSAGE_SENT",
                    tenantId: tenant.tenantId,
                    channel: "web",
                    externalUserId: userId,
                    displayName,
                    messageContent: responseContent,
                    messageRole: "ASSISTANT",
                    traceId: trace.traceId,
                    timestamp: new Date().toISOString(),
                  });
                }
              } catch {
                ws.send(JSON.stringify({
                  type: "error",
                  message: "Something went wrong. Please try again.",
                }));
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

function projectRequestedAuthorityPerCallConfig(
  config: PerCallToolConfig,
  requestedAuthority: OperatorTurnRequestedAuthority | undefined,
): PerCallToolConfig {
  return projectEffectiveTurnAuthorityPerCallConfig({
    config,
    executionMode: "execute",
    requestedAuthority,
    reason: "websocket tenant message requested turn authority",
    authorityDescriptorFromCapability: authorityFromCapability,
  }) ?? config;
}

function isRequestedAuthority(value: unknown): value is OperatorTurnRequestedAuthority | undefined {
  return value === undefined
    || value === "auto"
    || value === "read_only"
    || value === "audited"
    || value === "destructive";
}
