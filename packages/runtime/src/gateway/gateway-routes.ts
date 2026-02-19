// Gateway: createGatewayApp -- pure Hono app factory (no Bun-specific imports)
// Separated from gateway-server.ts so it can be tested without Bun runtime.

import { Hono } from "hono";
import type { App } from "@kiln/core";
import type { GatewayAppBinding } from "@kiln/core";
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

export interface LoadedApp {
  readonly name: string;
  readonly app: App;
  readonly binding: GatewayAppBinding;
  readonly registry: ChannelRegistry;
  modeBRuntime?: ModeBAppRuntime;
  tenantRuntime?: TenantAppRuntime;
  whatsappWebhookConfig?: WhatsAppWebhookConfig;
  tenantAdminConfig?: TenantAdminRoutesConfig;
}

export interface GatewayServerConfig {
  readonly port: number;
  readonly apps: readonly LoadedApp[];
  readonly delegationRegistry?: DelegationRegistry;
}

export function createGatewayApp(config: GatewayServerConfig): Hono {
  const app = new Hono();

  // Health endpoint
  app.get("/health", (c) => {
    const appStatuses = config.apps.map((loadedApp) => ({
      name: loadedApp.name,
      status: "ok" as const,
      channels: loadedApp.binding.channels.map((ch) => ch.type),
      multiTenant: loadedApp.binding.channels.some((ch) => ch.multiTenant === true),
    }));
    return c.json({ status: "ok", apps: appStatuses });
  });

  // Per-app routes
  for (const loadedApp of config.apps) {
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
  }

  if (config.delegationRegistry) {
    const delegationApp = createDelegationRoutes({ registry: config.delegationRegistry });
    app.route("/_internal/delegation", delegationApp);
  }

  return app;
}
