// Gateway: createGatewayApp -- pure Hono app factory (no Bun-specific imports)
// Separated from gateway-server.ts so it can be tested without Bun runtime.

import { Hono } from "hono";
import type { App, SttAdapter, ContactMemoryService } from "@kilnai/core";
import type { GatewayAppBinding, SecurityConfig, AuditLog, GatewayMcpConfig } from "@kilnai/core";
import { extractText, PromptScanner, textParts } from "@kilnai/core";
import type { WSContext } from "hono/ws";
import type { ChannelRegistry } from "../channels/channel-registry.js";
import type { WebChannel } from "../channels/web-channel.js";
import type { ProviderAdapterAppRuntime } from "./provider-adapter-routes.js";
import { createProviderAdapterRoutes } from "./provider-adapter-routes.js";
import type { WsRoutesConfig } from "./ws-routes.js";
import { createWsRoutes } from "./ws-routes.js";
import { createWsTenantRoutes } from "./ws-tenant-routes.js";
import type { DelegationRegistry } from "./delegation-handler.js";
import { createDelegationRoutes } from "./delegation-routes.js";
import type { TenantAppRuntime } from "./tenant-routes.js";
import { createTenantRoutes } from "./tenant-routes.js";
import type { WhatsAppWebhookConfig } from "./whatsapp-webhook-routes.js";
import { createWhatsAppWebhookRoutes } from "./whatsapp-webhook-routes.js";
import type { InstagramWebhookConfig } from "./instagram-webhook-routes.js";
import { createInstagramWebhookRoutes } from "./instagram-webhook-routes.js";
import type { MessengerWebhookConfig } from "./messenger-webhook-routes.js";
import { createMessengerWebhookRoutes } from "./messenger-webhook-routes.js";
import type { EmailWebhookConfig } from "./email-webhook-routes.js";
import { createEmailWebhookRoutes } from "./email-webhook-routes.js";
import type { TenantAdminRoutesConfig } from "./tenant-admin-routes.js";
import { createTenantAdminRoutes } from "./tenant-admin-routes.js";
import type { KnowledgeAdminRoutesConfig } from "./knowledge-admin-routes.js";
import { createKnowledgeAdminRoutes } from "./knowledge-admin-routes.js";
import type { ContactMemoryAdminRoutesConfig } from "./contact-memory-admin-routes.js";
import { createContactMemoryAdminRoutes } from "./contact-memory-admin-routes.js";
import type { EnrichmentAdminRoutesConfig } from "./enrichment-admin-routes.js";
import { createEnrichmentAdminRoutes } from "./enrichment-admin-routes.js";
import { createOutboundRoutes } from "./outbound-routes.js";
import { createHandoffRoutes } from "./handoff-routes.js";
import { HealthRegistry } from "./health-registry.js";
import { securityMiddleware } from "./security-middleware.js";
import { safetyMiddleware } from "./safety-middleware.js";
import type { SafetyPipeline } from "@kilnai/core";
import type { DevRoutesConfig } from "./dev-routes.js";
import { createDevRoutes } from "./dev-routes.js";
import { createDevInspectorHtml } from "./dev-inspector.js";
import type { TriggerRegistry } from "../trigger/trigger-registry.js";
import type { CredentialPoolObservabilityRegistry } from "../agents/credential-pool/credential-pool-observability.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { KnowledgePipelineResult } from "./knowledge-factory.js";
import type { JwtVerifyFn } from "./jwt-verifier.js";
import { requireJwt } from "./auth-middleware.js";
import type {
  GuiDashboardSnapshot,
  GuiInboundFrame,
  GuiOutboundFrame,
  GuiAppDescriptor,
  GuiSessionDetail,
  GuiSessionSummary,
  OperatorTurnRequestedAuthority,
} from "@kilnai/gateway-contracts";
import {
  appendCoordinationProviderFailureAudit,
  processAdmittedTurn,
  projectAdmittedTurnContext,
  resolveCoordinationContextCandidates,
} from "./message-pipeline.js";

export interface LoadedApp {
  readonly name: string;
  readonly app: App;
  readonly binding: GatewayAppBinding;
  readonly registry: ChannelRegistry;
  providerAdapterRuntime?: ProviderAdapterAppRuntime;
  tenantRuntime?: TenantAppRuntime;
  whatsappWebhookConfig?: WhatsAppWebhookConfig;
  instagramWebhookConfig?: InstagramWebhookConfig;
  messengerWebhookConfig?: MessengerWebhookConfig;
  emailWebhookConfig?: EmailWebhookConfig;
  tenantAdminConfig?: TenantAdminRoutesConfig;
  webChannel?: WebChannel;
  eventEmitter?: ConversationEventEmitter;
  sttAdapter?: SttAdapter;
  knowledgePipeline?: KnowledgePipelineResult;
  knowledgeAdminConfig?: KnowledgeAdminRoutesConfig;
  contactMemoryService?: ContactMemoryService;
  contactMemoryAdminConfig?: ContactMemoryAdminRoutesConfig;
  enrichmentAdminConfig?: EnrichmentAdminRoutesConfig;
}

export interface GatewayServerConfig {
  readonly port: number;
  readonly apps: readonly LoadedApp[];
  readonly mcp?: GatewayMcpConfig;
  readonly delegationRegistry?: DelegationRegistry;
  readonly healthRegistry?: HealthRegistry;
  readonly startTime?: number;
  readonly securityConfig?: SecurityConfig;
  readonly auditLog?: AuditLog;
  readonly devMode?: boolean;
  readonly devRoutesConfig?: DevRoutesConfig;
  readonly triggerRegistry?: TriggerRegistry;
  readonly credentialPoolObservability?: CredentialPoolObservabilityRegistry;
  readonly safetyPipelines?: Map<string, SafetyPipeline>;
  readonly studioDistPath?: string;
  readonly upgradeWebSocket?: WsRoutesConfig["upgradeWebSocket"];
  readonly validateToken?: WsRoutesConfig["validateToken"];
  /** Gateway-level JWT verifier. When set, applied to all API and admin routes. */
  readonly jwtVerifier?: JwtVerifyFn;
}

export function createGatewayApp(config: GatewayServerConfig): Hono {
  const app = new Hono();

  // Security middleware: prompt injection scanning (opt-in via securityConfig)
  if (config.securityConfig?.promptInjection?.enabled) {
    const scanner = new PromptScanner(config.securityConfig.promptInjection);
    app.use("*", securityMiddleware(scanner, config.auditLog, config.securityConfig.promptInjection));
  }

  // JWT middleware factory -- created once, reused for all protected route groups
  const jwtMiddleware = config.jwtVerifier ? requireJwt(config.jwtVerifier) : undefined;

  // Health endpoint
  app.get("/health", async (c) => {
    const startTime = config.startTime ?? Date.now();
    const uptime = Math.floor((Date.now() - startTime) / 1000);

    const appStatuses = config.apps.map((loadedApp) => ({
      name: loadedApp.name,
      status: "ok" as const,
      channels: loadedApp.binding.channels.map((ch) => ch.type),
      multiTenant: loadedApp.binding.channels.some((ch) => ch.multiTenant === true),
    }));

    // Check subsystem health if registry is provided
    let subsystems: Record<string, { status: "ok" | "degraded" | "error"; details?: Record<string, unknown> }> = {};
    let overallStatus: "ok" | "degraded" | "error" = "ok";

    if (config.healthRegistry) {
      subsystems = await config.healthRegistry.checkAll();
      overallStatus = HealthRegistry.aggregateStatus(subsystems);
    }

    return c.json({
      status: overallStatus,
      uptime,
      apps: appStatuses,
      subsystems,
    });
  });

  app.get("/gui/api/dashboard", async (c) => {
    return c.json(await buildAppGatewayGuiDashboard(config));
  });

  if (jwtMiddleware) {
    app.use("/observability", jwtMiddleware);
  }
  app.get("/observability", async (c) => {
    return c.json({
      providers: config.credentialPoolObservability?.snapshot() ?? [],
    });
  });

  app.get("/gui/api/sessions", async (c) => {
    return c.json({ sessions: await listAppGatewayGuiSessions(config) });
  });

  app.get("/gui/api/sessions/:sessionId", async (c) => {
    const detail = await getAppGatewayGuiSessionDetail(config, c.req.param("sessionId"));
    if (!detail) {
      return c.json({ error: "Session not found" }, 404);
    }
    return c.json(detail);
  });

  app.post("/gui/api/preferences/theme", (c) => c.json({ ok: false, reason: "Theme persistence is local to operator surfaces" }, 202));
  app.post("/gui/api/window-closed", (c) => c.json({ ok: true }));

  if (config.upgradeWebSocket) {
    app.get(
      "/gui/ws",
      config.upgradeWebSocket(() => ({
        onOpen(_event: Event, ws: WSContext) {
          const selectedRuntime = resolveAppGatewayGuiRuntime(config);
          ws.send(JSON.stringify({
            type: "welcome",
            models: {},
            providers: [],
            executionMode: "execute",
            domainLabel: selectedRuntime?.loadedApp.name ?? "app-gateway",
            authorityStatus: { effective: "unknown", completeness: "partial" },
          } satisfies GuiInboundFrame));
        },
        async onMessage(event: MessageEvent, ws: WSContext) {
          if (event.data === "ping") {
            ws.send("pong");
            return;
          }
          const frame = parseGuiOutboundFrame(event.data);
          if (!frame) {
            ws.send(JSON.stringify({
              type: "error",
              code: "APP_GATEWAY_INVALID_FRAME",
              message: "Invalid GUI frame.",
            } satisfies GuiInboundFrame));
            return;
          }
          if (frame.type === "clear") {
            const selectedRuntime = resolveAppGatewayGuiRuntime(config);
            if (selectedRuntime) {
              await selectedRuntime.runtime.sessionRegistry.detachActive(
                selectedRuntime.loadedApp.name,
                selectedRuntime.userId,
                selectedRuntime.tenantId,
              );
            }
            ws.send(JSON.stringify({ type: "cleared" } satisfies GuiInboundFrame));
            return;
          }
          if (frame.type === "refresh_providers") {
            ws.send(JSON.stringify({
              type: "providers_refreshed",
              models: {},
              providerDiscovery: [],
              providers: [],
            } satisfies GuiInboundFrame));
            return;
          }
          if (frame.type === "execution_mode_transition") {
            if (frame.toMode === "execute") {
              ws.send(JSON.stringify({
                type: "error",
                code: "APP_GATEWAY_PLAN_APPROVAL_UNAVAILABLE",
                message: "App Gateway attach mode cannot approve plan execution because it does not retain plan artifacts.",
              } satisfies GuiInboundFrame));
              return;
            }
            ws.send(JSON.stringify({
              type: "execution_mode_transitioned",
              executionMode: frame.toMode,
            } satisfies GuiInboundFrame));
            return;
          }
          if (frame.type !== "message") {
            ws.send(JSON.stringify({
              type: "error",
              code: "APP_GATEWAY_UNSUPPORTED_GUI_FRAME",
              message: `App Gateway attach mode does not support '${frame.type}' frames yet.`,
            } satisfies GuiInboundFrame));
            return;
          }
          const content = typeof frame.content === "string" ? frame.content.trim() : "";
          if (!content) {
            return;
          }
          await processAppGatewayGuiMessage(config, frame, ws);
        },
      })),
    );
  }

  if (config.mcp?.enabled) {
    app.get("/.well-known/oauth-authorization-server", (c) => {
      const baseUrl = new URL(c.req.url).origin;
      return c.json({
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/oauth/authorize`,
        token_endpoint: `${baseUrl}/oauth/token`,
        response_types_supported: ["code", "token"],
        grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:token-exchange"],
        token_endpoint_auth_methods_supported: ["none", "client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    });

    app.get("/.well-known/oauth-protected-resource", (c) => {
      const baseUrl = new URL(c.req.url).origin;
      return c.json({
        resource: baseUrl,
        authorization_servers: [baseUrl],
        bearer_methods_supported: ["header"],
        resource_documentation: `${baseUrl}/mcp`,
      });
    });
  }

  // Dev mode routes (local development only -- no auth)
  if (config.devMode) {
    if (config.studioDistPath) {
      app.get("/dev/", (c) => c.redirect("/studio/"));
      // Studio static files are served separately by the gateway server
    } else {
      app.get("/dev/", (c) => c.html(createDevInspectorHtml()));
    }
    const devRoutes = createDevRoutes(config.devRoutesConfig ?? {});
    app.route("/dev", devRoutes);
  }

  // Per-app routes
  for (const loadedApp of config.apps) {
    // JWT auth: applied to API/admin/outbound/handoff routes when gateway-level JWT is configured
    if (jwtMiddleware) {
      for (const channel of loadedApp.binding.channels) {
        if (channel.type === "api" && channel.path) {
          app.use(`${channel.path}/*`, jwtMiddleware);
        }
      }
      app.use(`/admin/${loadedApp.name}/*`, jwtMiddleware);
      app.use(`/outbound/${loadedApp.name}/*`, jwtMiddleware);
      app.use(`/handoff/${loadedApp.name}/*`, jwtMiddleware);
    }

    // Safety middleware per app (scans both input and output)
    const safetyPipeline = config.safetyPipelines?.get(loadedApp.name);
    if (safetyPipeline) {
      for (const channel of loadedApp.binding.channels) {
        if (channel.type === "api" && channel.path) {
          app.use(`${channel.path}/*`, safetyMiddleware(safetyPipeline));
        }
      }
    }

    for (const channel of loadedApp.binding.channels) {
      if (channel.type === "api" && channel.path) {
        // Multi-tenant apps use tenant routes; otherwise provider-adapter or placeholder
        if (loadedApp.tenantRuntime) {
          const tenantApp = createTenantRoutes(loadedApp.tenantRuntime);
          app.route(channel.path, tenantApp);
        } else if (loadedApp.providerAdapterRuntime) {
          const providerAdapterApp = createProviderAdapterRoutes(loadedApp.providerAdapterRuntime);
          app.route(channel.path, providerAdapterApp);
        } else {
          const apiApp = new Hono();
          const appName = loadedApp.name;
          apiApp.get("/", (c) => {
            return c.json({ app: appName, status: "ok" });
          });
          app.route(channel.path, apiApp);
        }
      }

      // WhatsApp webhook routes for multi-tenant apps
      if (channel.type === "whatsapp" && loadedApp.whatsappWebhookConfig) {
        const webhookApp = createWhatsAppWebhookRoutes(loadedApp.whatsappWebhookConfig);
        app.route(`/whatsapp/${loadedApp.name}`, webhookApp);
      }

      // Instagram webhook routes for multi-tenant apps
      if (channel.type === "instagram" && loadedApp.instagramWebhookConfig) {
        const igWebhookApp = createInstagramWebhookRoutes(loadedApp.instagramWebhookConfig);
        app.route(`/instagram/${loadedApp.name}`, igWebhookApp);
      }

      // Messenger webhook routes for multi-tenant apps
      if (channel.type === "messenger" && loadedApp.messengerWebhookConfig) {
        const msgWebhookApp = createMessengerWebhookRoutes(loadedApp.messengerWebhookConfig);
        app.route(`/messenger/${loadedApp.name}`, msgWebhookApp);
      }

      // Email webhook routes for multi-tenant apps
      if (channel.type === "email" && loadedApp.emailWebhookConfig) {
        const emailWebhookApp = createEmailWebhookRoutes(loadedApp.emailWebhookConfig);
        app.route(`/email/${loadedApp.name}`, emailWebhookApp);
      }

      // WebSocket route for web channel
      if (channel.type === "web" && loadedApp.webChannel && config.upgradeWebSocket) {
        if (loadedApp.tenantRuntime) {
          const tenantRuntime = loadedApp.tenantRuntime;
          const wsTenantApp = createWsTenantRoutes({
            webChannel: loadedApp.webChannel,
            upgradeWebSocket: config.upgradeWebSocket,
            appName: loadedApp.name,
            orchestrator: tenantRuntime.orchestrator,
            sessionRegistry: tenantRuntime.sessionRegistry,
            tenantRegistry: tenantRuntime.tenantRegistry,
            billing: tenantRuntime.billing,
            eventEmitter: loadedApp.eventEmitter,
            allowedOrigins: channel.allowedOrigins,
            sttAdapter: loadedApp.sttAdapter,
            knowledgePipeline: loadedApp.knowledgePipeline?.pipeline,
            knowledgeMode: loadedApp.app.knowledge?.mode,
            contactMemoryService: loadedApp.contactMemoryService,
            coordinationContextProvider: tenantRuntime.coordinationContextProvider,
          });
          app.route(`/apps/${loadedApp.name}`, wsTenantApp);
        } else if (loadedApp.providerAdapterRuntime) {
          const runtime = loadedApp.providerAdapterRuntime;
          const wsApp = createWsRoutes({
            webChannel: loadedApp.webChannel,
            upgradeWebSocket: config.upgradeWebSocket,
            validateToken: config.validateToken,
            apiKey: runtime.apiKey,
            processMessage: async (userId, parts, options) => {
              const session = await runtime.sessionRegistry.getOrCreate({
                appName: loadedApp.name,
                tenantId: "_default",
                userId,
                systemPrompt: runtime.systemPrompt,
              });
              const coordinationContext = await resolveCoordinationContextCandidates(runtime.coordinationContextProvider, {
                appName: loadedApp.name,
                tenantId: "_default",
                userId,
                sessionId: session.id,
                channel: "web",
              });
              const baseProjectedTurnContext = projectAdmittedTurnContext({
                userContext: session.userContext,
                cachedRuntimeSummary: undefined,
                recalledMemory: undefined,
                knowledgeContext: undefined,
                contactContext: undefined,
                groundingMode: undefined,
                coordinationContextCandidates: coordinationContext.candidates,
              });
              const projectedTurnContext = {
                ...baseProjectedTurnContext,
                audit: appendCoordinationProviderFailureAudit(
                  baseProjectedTurnContext.audit,
                  coordinationContext.failureReason,
                ),
              };
              return runtime.orchestrator.processMessage(
                session,
                parts,
                projectedTurnContext,
                undefined,
                options?.requestedAuthority ? {
                  ...((options.requestedAuthority !== "auto") ? {
                    toolAllowlist: new Set<string>(),
                  } : {}),
                  effectiveTurnAuthority: {
                    executionMode: "execute",
                    requestedAuthority: options.requestedAuthority,
                    admittedAuthority: options.requestedAuthority !== "auto"
                      ? "fail_closed"
                      : "unknown",
                    sourcePolicy: "runtime_surface_projection",
                    reason: "provider-adapter websocket requested turn authority before full min-policy admission",
                    completeness: options.requestedAuthority !== "auto"
                      ? "authoritative"
                      : "partial",
                    toolCount: 0,
                    deniedToolCount: 0,
                  },
                } : undefined,
              );
            },
          });
          app.route(`/apps/${loadedApp.name}`, wsApp);
        }
      }
    }

    // Admin routes for multi-tenant apps
    if (loadedApp.tenantAdminConfig) {
      const adminApp = createTenantAdminRoutes(loadedApp.tenantAdminConfig);
      app.route(`/admin/${loadedApp.name}`, adminApp);

      // Outbound send routes (same auth as admin)
      const outboundApp = createOutboundRoutes({
        tenantRegistry: loadedApp.tenantAdminConfig.tenantRegistry,
        appName: loadedApp.name,
        adminToken: loadedApp.tenantAdminConfig.adminToken,
      });
      app.route(`/outbound/${loadedApp.name}`, outboundApp);

      // Handoff routes for multi-tenant apps (operator messaging, session transitions)
      const sessionRegistry = loadedApp.tenantRuntime?.sessionRegistry ?? loadedApp.providerAdapterRuntime?.sessionRegistry;
      if (sessionRegistry) {
        const handoffApp = createHandoffRoutes({
          sessionRegistry,
          tenantRegistry: loadedApp.tenantAdminConfig.tenantRegistry,
          appName: loadedApp.name,
          adminToken: loadedApp.tenantAdminConfig.adminToken,
          webChannel: loadedApp.webChannel,
          eventEmitter: loadedApp.eventEmitter,
        });
        app.route(`/handoff/${loadedApp.name}`, handoffApp);
      }
    }

    // Knowledge admin routes (available for any app with knowledge config)
    if (loadedApp.knowledgeAdminConfig) {
      const knowledgeAdminApp = createKnowledgeAdminRoutes(loadedApp.knowledgeAdminConfig);
      app.route(`/admin/${loadedApp.name}/knowledge`, knowledgeAdminApp);
    }

    // Contact memory admin routes (GDPR: forget, forgetAll)
    if (loadedApp.contactMemoryAdminConfig) {
      const contactMemoryAdminApp = createContactMemoryAdminRoutes(loadedApp.contactMemoryAdminConfig);
      app.route(`/admin/${loadedApp.name}/contact-memory`, contactMemoryAdminApp);
    }

    // Enrichment admin routes (GDPR: get, list, delete)
    if (loadedApp.enrichmentAdminConfig) {
      const enrichmentAdminApp = createEnrichmentAdminRoutes(loadedApp.enrichmentAdminConfig);
      app.route(`/admin/${loadedApp.name}/enrichment`, enrichmentAdminApp);
    }
  }

  // Mount webhook trigger routes per app
  if (config.triggerRegistry) {
    for (const loadedApp of config.apps) {
      const webhookApp = config.triggerRegistry.getWebhookApp(loadedApp.name);
      if (webhookApp) {
        app.route(`/webhooks/${loadedApp.name}`, webhookApp);
      }
    }
  }

  if (config.delegationRegistry) {
    const delegationApp = createDelegationRoutes({ registry: config.delegationRegistry });
    app.route("/_internal/delegation", delegationApp);
  }

  return app;
}

async function buildAppGatewayGuiDashboard(config: GatewayServerConfig): Promise<GuiDashboardSnapshot> {
  const selectedRuntime = resolveAppGatewayGuiRuntime(config);
  return {
    providers: [],
    sessions: await listAppGatewayGuiSessions(config),
    telemetry: {
      status: "stable",
      dominantRegions: config.apps.map((app) => app.name).slice(0, 3),
      saturation: config.apps.length,
      entropy: 0,
    },
    resumeInfoByProvider: {},
    apps: buildAppGatewayGuiApps(config),
    ...(selectedRuntime ? { activeAppName: selectedRuntime.loadedApp.name } : {}),
    ...(selectedRuntime ? { activeTenantId: selectedRuntime.tenantId } : {}),
    domainLabel: selectedRuntime?.loadedApp.name ?? "app-gateway",
  };
}

function buildAppGatewayGuiApps(config: GatewayServerConfig): readonly GuiAppDescriptor[] {
  return config.apps.map((loadedApp) => {
    const runtime: GuiAppDescriptor["runtime"] = loadedApp.providerAdapterRuntime
      ? "provider-adapter"
      : loadedApp.tenantRuntime
        ? "tenant"
        : "none";
    return {
      name: loadedApp.name,
      runtime,
      channels: loadedApp.binding.channels.map((channel) => channel.type),
      runtimeCapable: runtime !== "none",
      ...(loadedApp.tenantRuntime ? {
        tenants: loadedApp.tenantRuntime.tenantRegistry.list(loadedApp.name).map((tenant) => ({
          tenantId: tenant.tenantId,
          label: tenant.businessName ?? tenant.name,
          enabled: tenant.enabled,
        })),
      } : {}),
    };
  });
}

async function listAppGatewayGuiSessions(config: GatewayServerConfig): Promise<readonly GuiSessionSummary[]> {
  const sessions = await collectAppGatewayRuntimeSessions(config);
  return sessions.map((session) => {
    const firstUserMessage = session.conversationHistory.find((message) => message.role === "user");
    const taskSummary = firstUserMessage ? extractText(firstUserMessage.parts) : `${session.appName} session`;
    const lastProvider = session.sessionLedger.lastProvider;
    return {
      id: session.id,
      title: session.appName,
      providersUsed: lastProvider ? [lastProvider] : [],
      ...(lastProvider ? { lastProvider } : {}),
      completedAt: session.lastActivityAt.toISOString(),
      cost: 0,
      taskSummary,
    };
  });
}

async function getAppGatewayGuiSessionDetail(
  config: GatewayServerConfig,
  sessionId: string,
): Promise<GuiSessionDetail | null> {
  const sessions = await collectAppGatewayRuntimeSessions(config);
  const session = sessions.find((entry) => entry.id === sessionId);
  if (!session) {
    return null;
  }
  const firstUserMessage = session.conversationHistory.find((message) => message.role === "user");
  const ledger = session.sessionLedger;
  return {
    id: session.id,
    meta: {
      kilnSessionId: session.id,
      title: session.appName,
      task: firstUserMessage ? extractText(firstUserMessage.parts) : `${session.appName} session`,
      startedAt: session.createdAt.toISOString(),
      completedAt: session.lastActivityAt.toISOString(),
      costUsd: 0,
      turnDepth: session.userTurnCount,
      sessionLedger: {
        currentPhase: ledger.currentPhase,
        ...(ledger.lastError ? { lastError: ledger.lastError } : {}),
        ...(ledger.lastProvider ? { lastProvider: ledger.lastProvider } : {}),
        ...(ledger.toolCallCount !== undefined ? { toolCallCount: ledger.toolCallCount } : {}),
        ...(ledger.turnDepth !== undefined ? { turnDepth: ledger.turnDepth } : {}),
      },
      exactArtifacts: session.exactArtifacts,
    },
    events: [],
  };
}

type AppGatewayGuiRuntimeSelection =
  | {
      readonly loadedApp: LoadedApp;
      readonly userId: string;
      readonly tenantId: string;
      readonly runtime: ProviderAdapterAppRuntime;
      readonly kind: "provider-adapter";
    }
  | {
      readonly loadedApp: LoadedApp;
      readonly userId: string;
      readonly tenantId: string;
      readonly runtime: TenantAppRuntime;
      readonly kind: "tenant";
    };

function resolveAppGatewayGuiRuntime(
  config: GatewayServerConfig,
  selection?: { readonly appName?: string; readonly tenantId?: string },
): AppGatewayGuiRuntimeSelection | undefined {
  if (selection?.appName) {
    const loadedApp = config.apps.find((app) => app.name === selection.appName);
    if (!loadedApp) {
      return undefined;
    }
    return resolveLoadedAppGatewayGuiRuntime(loadedApp, selection.tenantId);
  }

  for (const loadedApp of config.apps) {
    const resolved = resolveLoadedAppGatewayGuiRuntime(loadedApp);
    if (resolved?.kind === "provider-adapter") {
      return resolved;
    }
  }

  for (const loadedApp of config.apps) {
    const resolved = resolveLoadedAppGatewayGuiRuntime(loadedApp);
    if (resolved) return resolved;
  }

  return undefined;
}

function resolveLoadedAppGatewayGuiRuntime(
  loadedApp: LoadedApp,
  tenantId?: string,
): AppGatewayGuiRuntimeSelection | undefined {
  if (loadedApp.providerAdapterRuntime) {
    return {
      loadedApp,
      userId: "_gui",
      tenantId: "_default",
      runtime: loadedApp.providerAdapterRuntime,
      kind: "provider-adapter",
    };
  }
  const runtime = loadedApp.tenantRuntime;
  if (!runtime) {
    return undefined;
  }
  const tenant = tenantId
    ? runtime.tenantRegistry.get(tenantId)
    : runtime.tenantRegistry.list(loadedApp.name).find((entry) => entry.enabled);
  if (!tenant || tenant.appName !== loadedApp.name || !tenant.enabled) {
    return undefined;
  }
  return {
    loadedApp,
    userId: "_gui",
    tenantId: tenant.tenantId,
    runtime,
    kind: "tenant",
  };
}

async function processAppGatewayGuiMessage(
  config: GatewayServerConfig,
  frame: Extract<GuiOutboundFrame, { type: "message" }>,
  ws: WSContext,
): Promise<void> {
  const selectedRuntime = resolveAppGatewayGuiRuntime(config, {
    appName: frame.appName,
    tenantId: frame.tenantId,
  });
  if (!selectedRuntime) {
    ws.send(JSON.stringify({
      type: "error",
      code: "APP_GATEWAY_NO_GUI_RUNTIME",
      message: frame.appName
        ? `No runtime-capable App Gateway app matched '${frame.appName}'.`
        : "No runtime-capable App Gateway app is available for GUI attach mode.",
    } satisfies GuiInboundFrame));
    return;
  }

  const content = frame.content.trim();
  const sessionId = typeof frame.resumeSessionId === "string" && frame.resumeSessionId.trim()
    ? frame.resumeSessionId.trim()
    : undefined;
  if (!isRequestedAuthority(frame.requestedAuthority)) {
    ws.send(JSON.stringify({
      type: "error",
      message: "requestedAuthority must be auto, read_only, or audited",
    } satisfies GuiInboundFrame));
    return;
  }
  ws.send(JSON.stringify({ type: "thinking" } satisfies GuiInboundFrame));

  try {
    const processResult = selectedRuntime.kind === "provider-adapter"
      ? await processAdmittedTurn({
        orchestrator: selectedRuntime.runtime.orchestrator,
        sessionRegistry: selectedRuntime.runtime.sessionRegistry,
        appName: selectedRuntime.runtime.appName,
        tenantId: selectedRuntime.tenantId,
        userId: selectedRuntime.userId,
        ...(sessionId ? { sessionId } : {}),
        systemPrompt: selectedRuntime.runtime.systemPrompt,
        userParts: textParts(content),
        billing: selectedRuntime.runtime.billing,
        channel: "gui",
        knowledgePipeline: selectedRuntime.runtime.knowledgePipeline,
        knowledgeMode: selectedRuntime.runtime.knowledgeMode,
        tenant: selectedRuntime.runtime.tenant,
        handoffSummarizer: selectedRuntime.runtime.handoffSummarizer,
        eventBus: selectedRuntime.runtime.eventBus,
        groundingMode: selectedRuntime.runtime.tenant?.groundingMode,
        groundingDeps: selectedRuntime.runtime.groundingDeps,
        contextArtifactCache: selectedRuntime.runtime.contextArtifactCache,
        coordinationContextProvider: selectedRuntime.runtime.coordinationContextProvider,
        requestedAuthority: frame.requestedAuthority,
      })
      : await processTenantAppGatewayGuiTurn(selectedRuntime, content, sessionId, frame.requestedAuthority);

    if (!processResult.ok) {
      ws.send(JSON.stringify({
        type: "error",
        message: processResult.budgetDenied.message,
      } satisfies GuiInboundFrame));
      return;
    }

    const result = processResult.result;
    ws.send(JSON.stringify({
      type: "done",
      content: extractText(result.parts),
      parts: result.parts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      ...(result.routingDecision?.provider ? { routedProvider: result.routingDecision.provider } : {}),
      ...(result.routingDecision?.model ? { routedModel: result.routingDecision.model } : {}),
      runtimeContinuity: result.runtimeContinuity ?? { strategy: "none" },
      authorityStatus: deriveAppGatewayGuiAuthorityStatus(result.effectiveTurnAuthority),
    } satisfies GuiInboundFrame));
  } catch (error) {
    ws.send(JSON.stringify({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    } satisfies GuiInboundFrame));
  }
}

async function processTenantAppGatewayGuiTurn(
  selection: Extract<AppGatewayGuiRuntimeSelection, { kind: "tenant" }>,
  content: string,
  sessionId?: string,
  requestedAuthority?: OperatorTurnRequestedAuthority,
): ReturnType<typeof processAdmittedTurn> {
  const tenant = selection.runtime.tenantRegistry.get(selection.tenantId);
  if (!tenant || tenant.appName !== selection.runtime.appName) {
    throw new Error(`Tenant '${selection.tenantId}' is not available for app '${selection.runtime.appName}'.`);
  }
  if (!tenant.enabled) {
    throw new Error(`Tenant '${selection.tenantId}' is disabled.`);
  }
  const billingConfig = tenant.billing?.budgetEndpoint
    ? (tenant.billing as unknown as TenantAppRuntime["billing"])
    : selection.runtime.billing;

  return processAdmittedTurn({
    orchestrator: selection.runtime.orchestrator,
    sessionRegistry: selection.runtime.sessionRegistry,
    appName: selection.runtime.appName,
    tenantId: selection.tenantId,
    userId: selection.userId,
    ...(sessionId ? { sessionId } : {}),
    userParts: textParts(content),
    billing: billingConfig,
    channel: "gui",
    tenant,
    idleTimeoutMs: tenant.idleTimeoutMs,
    groundingMode: tenant.groundingMode,
    groundingDeps: selection.runtime.groundingDeps,
    contextArtifactCache: selection.runtime.contextArtifactCache,
    coordinationContextProvider: selection.runtime.coordinationContextProvider,
    requestedAuthority,
  });
}

type AppGatewayGuiAuthorityStatus = NonNullable<Extract<GuiInboundFrame, { type: "done" }>["authorityStatus"]>;

function deriveAppGatewayGuiAuthorityStatus(
  effectiveTurnAuthority: NonNullable<import("../session/runtime-session-orchestrator.js").PerCallToolConfig["effectiveTurnAuthority"]> | undefined,
): AppGatewayGuiAuthorityStatus {
  if (!effectiveTurnAuthority) {
    return { effective: "unknown", completeness: "partial" };
  }
  return {
    effective: effectiveTurnAuthority.admittedAuthority,
    completeness: effectiveTurnAuthority.completeness,
  };
}

function isRequestedAuthority(value: unknown): value is OperatorTurnRequestedAuthority | undefined {
  return value === undefined
    || value === "auto"
    || value === "read_only"
    || value === "audited";
}

function parseGuiOutboundFrame(data: unknown): GuiOutboundFrame | null {
  const raw = typeof data === "string"
    ? data
    : data instanceof ArrayBuffer
      ? new TextDecoder().decode(data)
      : "";
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as GuiOutboundFrame;
  } catch {
    return null;
  }
}

async function collectAppGatewayRuntimeSessions(config: GatewayServerConfig): Promise<readonly import("../session/runtime-session.js").RuntimeSession[]> {
  const registries = new Set<import("../session/session-registry.js").SessionRegistry>();
  for (const app of config.apps) {
    if (app.providerAdapterRuntime) {
      registries.add(app.providerAdapterRuntime.sessionRegistry);
    }
    if (app.tenantRuntime) {
      registries.add(app.tenantRuntime.sessionRegistry);
    }
  }
  const sessions = await Promise.all([...registries].map((registry) => registry.activeSessions()));
  return sessions.flat().sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
}
