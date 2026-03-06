// Gateway: createGatewayApp -- pure Hono app factory (no Bun-specific imports)
// Separated from gateway-server.ts so it can be tested without Bun runtime.

import { Hono } from "hono";
import type { App, SttAdapter, RetrievalPipeline } from "@kilnai/core";
import type { GatewayAppBinding, SecurityConfig, AuditLog } from "@kilnai/core";
import { PromptScanner } from "@kilnai/core";
import type { ChannelRegistry } from "../channels/channel-registry.js";
import type { WebChannel } from "../channels/web-channel.js";
import type { ModeBAppRuntime } from "./mode-b-routes.js";
import { createModeBRoutes } from "./mode-b-routes.js";
import type { WsRoutesConfig } from "./ws-routes.js";
import { createWsRoutes } from "./ws-routes.js";
import { createWsTenantRoutes } from "./ws-tenant-routes.js";
import type { DelegationRegistry } from "./delegation-handler.js";
import { createDelegationRoutes } from "./delegation-routes.js";
import type { TenantAppRuntime } from "./tenant-routes.js";
import { createTenantRoutes } from "./tenant-routes.js";
import type { WhatsAppWebhookConfig } from "./whatsapp-webhook-routes.js";
import { createWhatsAppWebhookRoutes } from "./whatsapp-webhook-routes.js";
import type { TenantAdminRoutesConfig } from "./tenant-admin-routes.js";
import { createTenantAdminRoutes } from "./tenant-admin-routes.js";
import type { KnowledgeAdminRoutesConfig } from "./knowledge-admin-routes.js";
import { createKnowledgeAdminRoutes } from "./knowledge-admin-routes.js";
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

export interface LoadedApp {
  readonly name: string;
  readonly app: App;
  readonly binding: GatewayAppBinding;
  readonly registry: ChannelRegistry;
  modeBRuntime?: ModeBAppRuntime;
  tenantRuntime?: TenantAppRuntime;
  whatsappWebhookConfig?: WhatsAppWebhookConfig;
  tenantAdminConfig?: TenantAdminRoutesConfig;
  webChannel?: WebChannel;
  eventEmitter?: ConversationEventEmitter;
  sttAdapter?: SttAdapter;
  knowledgePipeline?: { readonly pipeline: RetrievalPipeline; readonly close: () => Promise<void> };
  knowledgeAdminConfig?: KnowledgeAdminRoutesConfig;
}

export interface GatewayServerConfig {
  readonly port: number;
  readonly apps: readonly LoadedApp[];
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
}

export function createGatewayApp(config: GatewayServerConfig): Hono {
  const app = new Hono();

  // Security middleware: prompt injection scanning (opt-in via securityConfig)
  if (config.securityConfig?.promptInjection?.enabled) {
    const scanner = new PromptScanner(config.securityConfig.promptInjection);
    app.use("*", securityMiddleware(scanner, config.auditLog, config.securityConfig.promptInjection));
  }

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
    const memoryRoutes = createMemoryRoutes(config.memoryRoutesConfig);
    app.route("/api", memoryRoutes);
  }

  // Per-app routes
  for (const loadedApp of config.apps) {
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
        // Multi-tenant apps use tenant routes; otherwise Mode B or placeholder
        if (loadedApp.tenantRuntime) {
          const tenantApp = createTenantRoutes(loadedApp.tenantRuntime);
          app.route(channel.path, tenantApp);
        } else if (loadedApp.modeBRuntime) {
          const modeBApp = createModeBRoutes(loadedApp.modeBRuntime);
          app.route(channel.path, modeBApp);
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
          });
          app.route(`/apps/${loadedApp.name}`, wsTenantApp);
        } else if (loadedApp.modeBRuntime) {
          const runtime = loadedApp.modeBRuntime;
          const wsApp = createWsRoutes({
            webChannel: loadedApp.webChannel,
            upgradeWebSocket: config.upgradeWebSocket,
            validateToken: config.validateToken,
            apiKey: runtime.apiKey,
            processMessage: async (userId, parts) => {
              const session = await runtime.sessionRegistry.getOrCreate({
                appName: loadedApp.name,
                userId,
                systemPrompt: runtime.systemPrompt,
              });
              return runtime.orchestrator.processMessage(session, parts);
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
      const sessionRegistry = loadedApp.tenantRuntime?.sessionRegistry ?? loadedApp.modeBRuntime?.sessionRegistry;
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
