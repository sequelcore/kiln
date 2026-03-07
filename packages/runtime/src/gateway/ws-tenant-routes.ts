// Gateway: WS Tenant Routes -- multi-tenant WebSocket endpoint
// Resolves tenant by widgetId, creates per-user sessions, processes chat frames

import { Hono } from "hono";
import type { UpgradeWebSocket, WSContext } from "hono/ws";
import type { WebChannel } from "../channels/web-channel.js";
import type { ContentPart, SttAdapter, RetrievalPipeline, ContactMemoryService } from "@kilnai/core";
import { textParts, extractText, hasModality } from "@kilnai/core";
import type { ModeBOrchestrator, PerCallToolConfig } from "../session/mode-b-orchestrator.js";
import { buildTenantToolContext } from "./tenant-tool-factory.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { TenantRegistry } from "../tenant/tenant-registry.js";
import { buildTenantSystemPrompt } from "../tenant/system-prompt-builder.js";
import { extractSuggestions } from "../tenant/suggestion-parser.js";
import { checkBudget, reportUsage } from "./budget-middleware.js";
import type { BillingConfig } from "./budget-middleware.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { isOriginAllowed } from "./auth-middleware.js";
import { TraceContext } from "./trace-context.js";
import { preprocessAudio, createGenericMediaDownloader } from "./audio-preprocessor.js";
import { formatKnowledgeContext, formatContactContext, mergeContextSources } from "./context-formatter.js";

export interface WsTenantRoutesConfig {
  readonly webChannel: WebChannel;
  readonly upgradeWebSocket: UpgradeWebSocket;
  readonly appName: string;
  readonly orchestrator: ModeBOrchestrator;
  readonly sessionRegistry: SessionRegistry;
  readonly tenantRegistry: TenantRegistry;
  readonly billing?: BillingConfig;
  readonly eventEmitter?: ConversationEventEmitter;
  readonly allowedOrigins?: readonly string[];
  readonly sttAdapter?: SttAdapter;
  readonly knowledgePipeline?: RetrievalPipeline;
  readonly knowledgeMode?: "auto" | "tool";
  readonly contactMemoryService?: ContactMemoryService;
}

export function createWsTenantRoutes(config: WsTenantRoutesConfig): Hono {
  const app = new Hono();

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
      const systemPrompt = buildTenantSystemPrompt(tenant, "web");

      return {
        onOpen(_event: Event, ws: WSContext) {
          config.webChannel.addClient(ws, userId);

          const suggestions = tenant.faqEntries?.map((f) => f.q) ?? [];
          if (tenant.greeting || suggestions.length > 0) {
            ws.send(JSON.stringify({
              type: "welcome",
              ...(tenant.greeting && { greeting: tenant.greeting }),
              ...(suggestions.length > 0 && { suggestions }),
            }));
          }
        },
        onClose(_event: CloseEvent, ws: WSContext) {
          config.webChannel.removeClient(ws);
        },
        async onMessage(event: MessageEvent, ws: WSContext) {
          try {
            const raw = event.data;
            const text = typeof raw === "string" ? raw : new TextDecoder().decode(raw as ArrayBuffer);
            const parsed = JSON.parse(text) as Record<string, unknown>;

            if (parsed.type === "message") {
              const trace = new TraceContext();
              trace.log("ws", "Message received", { tenantId: tenant.tenantId, userId });

              let userParts: readonly ContentPart[] = Array.isArray(parsed.parts)
                ? (parsed.parts as ContentPart[])
                : textParts(String(parsed.content ?? ""));

              // Preprocess audio parts via STT (fail-open)
              if (config.sttAdapter && hasModality(userParts, "audio")) {
                try {
                  userParts = await preprocessAudio(userParts, config.sttAdapter, createGenericMediaDownloader());
                } catch {
                  // fail-open
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

                const session = await config.sessionRegistry.getOrCreate({
                  appName: config.appName,
                  tenantId: tenant.tenantId,
                  userId,
                  systemPrompt,
                  idleTimeoutMs: tenant.idleTimeoutMs,
                });

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

                const combinedMemory = mergeContextSources(knowledgeContext, contactContext);

                // Build tenant tool context (webhook tools, allowlist, rate limiter)
                const tenantToolCtx = buildTenantToolContext(tenant);

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

                const result = await config.orchestrator.processMessage(
                  session,
                  userParts,
                  combinedMemory,
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
                      toolName: exec.toolName,
                      durationMs: exec.durationMs,
                      success: exec.success,
                      resultSummary: exec.resultSummary,
                      traceId: trace.traceId,
                      timestamp: new Date().toISOString(),
                    });
                  }
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
