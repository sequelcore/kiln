// Gateway: createGatewayApp -- pure Hono app factory (no Bun-specific imports)
// Separated from gateway-server.ts so it can be tested without Bun runtime.

import { Hono } from "hono";
import type { App } from "@kilnai/core";
import type { GatewayAppBinding, SecurityConfig, AuditLog, AgentCard, A2AMessage, A2ATaskStatus, A2AArtifact } from "@kilnai/core";
import { PromptScanner } from "@kilnai/core";
import type { ChannelRegistry } from "../channels/channel-registry.js";
import type { ModeBAppRuntime } from "./mode-b-routes.js";
import { createModeBRoutes } from "./mode-b-routes.js";
import type { DelegationRegistry } from "./delegation-handler.js";
import { createDelegationRoutes } from "./delegation-routes.js";
import type { TenantAppRuntime } from "./tenant-routes.js";
import { createTenantRoutes } from "./tenant-routes.js";
import type { WhatsAppWebhookConfig } from "./whatsapp-webhook-routes.js";
import { createWhatsAppWebhookRoutes } from "./whatsapp-webhook-routes.js";
import type { TenantAdminRoutesConfig } from "./tenant-admin-routes.js";
import { createTenantAdminRoutes } from "./tenant-admin-routes.js";
import { HealthRegistry } from "./health-registry.js";
import { securityMiddleware } from "./security-middleware.js";
import { safetyMiddleware } from "./safety-middleware.js";
import type { SafetyPipeline } from "@kilnai/core";
import type { DevRoutesConfig } from "./dev-routes.js";
import { createDevRoutes } from "./dev-routes.js";
import { createDevInspectorHtml } from "./dev-inspector.js";
import type { TriggerRegistry } from "../trigger/trigger-registry.js";
import { createA2ARoutes, A2ATaskStore } from "../a2a/index.js";

export interface LoadedApp {
  readonly name: string;
  readonly app: App;
  readonly binding: GatewayAppBinding;
  readonly registry: ChannelRegistry;
  modeBRuntime?: ModeBAppRuntime;
  tenantRuntime?: TenantAppRuntime;
  whatsappWebhookConfig?: WhatsAppWebhookConfig;
  tenantAdminConfig?: TenantAdminRoutesConfig;
  a2aConfig?: {
    readonly agentCard: AgentCard;
    readonly taskStore: A2ATaskStore;
    readonly executeTask: (taskId: string, message: A2AMessage) => Promise<{ status: A2ATaskStatus; artifacts?: readonly A2AArtifact[] }>;
  };
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
  readonly triggerRegistry?: TriggerRegistry;
  readonly safetyPipelines?: Map<string, SafetyPipeline>;
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
    app.get("/dev/", (c) => c.html(createDevInspectorHtml()));
    const devRoutes = createDevRoutes(config.devRoutesConfig ?? {});
    app.route("/dev", devRoutes);
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
    }

    // Admin routes for multi-tenant apps
    if (loadedApp.tenantAdminConfig) {
      const adminApp = createTenantAdminRoutes(loadedApp.tenantAdminConfig);
      app.route(`/admin/${loadedApp.name}`, adminApp);
    }

    // A2A routes per app (only when explicitly configured)
    if (loadedApp.a2aConfig) {
      const a2aApp = createA2ARoutes(loadedApp.a2aConfig);
      app.route(`/${loadedApp.name}/a2a`, a2aApp);
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
