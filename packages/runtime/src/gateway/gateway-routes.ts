// Gateway: createGatewayApp -- pure Hono app factory (no Bun-specific imports)
// Separated from gateway-server.ts so it can be tested without Bun runtime.

import { Hono } from "hono";
import type { App, SttAdapter, ContactMemoryService } from "@kilnai/core";
import type { GatewayAppBinding, SecurityConfig, AuditLog, GatewayMcpConfig } from "@kilnai/core";
import { PromptScanner } from "@kilnai/core";
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
import type { MemoryRoutesConfig } from "./memory-routes.js";
import { createMemoryRoutes } from "./memory-routes.js";
import type { TriggerRegistry } from "../trigger/trigger-registry.js";
import type { ConversationEventEmitter } from "./conversation-event-emitter.js";
import type { KnowledgePipelineResult } from "./knowledge-factory.js";
import type { JwtVerifyFn } from "./jwt-verifier.js";
import { requireJwt } from "./auth-middleware.js";
import {
  appendCoordinationProviderFailureAudit,
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
  readonly memoryRoutesConfig?: MemoryRoutesConfig;
  readonly triggerRegistry?: TriggerRegistry;
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

  // Production memory routes (available in all modes)
  if (config.memoryRoutesConfig) {
    if (jwtMiddleware) {
      app.use("/api/memory/*", jwtMiddleware);
    }
    const memoryRoutes = createMemoryRoutes(config.memoryRoutesConfig);
    app.route("/api", memoryRoutes);
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
            processMessage: async (userId, parts) => {
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
              return runtime.orchestrator.processMessage(session, parts, projectedTurnContext);
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
