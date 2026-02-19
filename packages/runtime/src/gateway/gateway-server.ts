// Gateway: GatewayServer -- persistent Bun/Hono process hosting multiple Apps

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { createBunWebSocket } from "hono/bun";
import {
  parseGatewayYaml,
  AnthropicAdapter,
  OpenAIAdapter,
  DeepSeekAdapter,
  OllamaAdapter,
} from "@kilnai/core";
import type { ProviderAdapter, ProviderConfig, App } from "@kilnai/core";
import { ChannelRegistry } from "../channels/channel-registry.js";
import { resolveApps } from "./app-resolver.js";
import type { ResolvedApp } from "./app-resolver.js";
import { createGatewayApp } from "./gateway-routes.js";
import { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import type { DelegationTarget, DelegationRegistry } from "./delegation-handler.js";
import { TenantRegistry } from "../tenant/tenant-registry.js";

export type { LoadedApp, GatewayServerConfig } from "./gateway-routes.js";
export { createGatewayApp } from "./gateway-routes.js";

export async function startGateway(configPath: string, portOverride?: number): Promise<void> {
  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    throw new Error(`Failed to read gateway config: ${configPath}`);
  }

  const gatewayConfig = parseGatewayYaml(content);
  const gatewayYamlDir = dirname(configPath);

  const resolvedApps = resolveApps(gatewayConfig, gatewayYamlDir);

  const loadedApps = resolvedApps.map((resolved: ResolvedApp) => ({
    name: resolved.name,
    app: resolved.app,
    binding: resolved.binding,
    registry: new ChannelRegistry(),
    modeBRuntime: undefined as undefined | import("./mode-b-routes.js").ModeBAppRuntime,
    tenantRuntime: undefined as undefined | import("./tenant-routes.js").TenantAppRuntime,
    whatsappWebhookConfig: undefined as undefined | import("./whatsapp-webhook-routes.js").WhatsAppWebhookConfig,
    tenantAdminConfig: undefined as undefined | import("./tenant-admin-routes.js").TenantAdminRoutesConfig,
  }));

  // Initialize Mode B and multi-tenant runtimes
  const sessionRegistry = new SessionRegistry();
  for (const loaded of loadedApps) {
    const resolved = resolvedApps.find((r) => r.name === loaded.name);
    if (!resolved?.modeBConfig || resolved.modeBConfig.runtime !== "provider-adapter") continue;

    const provider = createProviderFromConfig(resolved.modeBConfig.provider);
    const orchestrator = new ModeBOrchestrator({ provider });
    const isMultiTenant = loaded.binding.channels.some((ch) => ch.multiTenant === true);

    if (isMultiTenant) {
      // Multi-tenant: use TenantRegistry + tenant routes
      const tenantStorageDir = join(resolved.memoryBasePath, "tenants");
      const tenantRegistry = new TenantRegistry(tenantStorageDir);
      tenantRegistry.load();

      loaded.tenantRuntime = {
        appName: loaded.name,
        orchestrator,
        sessionRegistry,
        tenantRegistry,
        billing: resolved.modeBConfig.billing,
      };

      // WhatsApp webhook: find whatsapp channel with verifyTokenEnv
      const whatsappChannel = loaded.binding.channels.find((ch) => ch.type === "whatsapp");
      if (whatsappChannel) {
        const verifyTokenEnv = (whatsappChannel.verifyTokenEnv as string) ?? "";
        loaded.whatsappWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: verifyTokenEnv ? process.env[verifyTokenEnv] ?? "" : "",
        };
      }

      // Admin routes
      const adminChannel = loaded.binding.channels.find((ch) => ch.adminTokenEnv);
      const adminTokenEnv = (adminChannel?.adminTokenEnv as string) ?? "";
      loaded.tenantAdminConfig = {
        tenantRegistry,
        appName: loaded.name,
        adminToken: adminTokenEnv ? process.env[adminTokenEnv] ?? undefined : undefined,
      };

      const tenantCount = tenantRegistry.list(loaded.name).length;
      console.log(`  ${loaded.name}: multi-tenant mode (${tenantCount} tenants loaded)`);
    } else {
      // Standard Mode B (non-tenant)
      const systemPrompt = buildSystemPromptFromApp(resolved.app);
      loaded.modeBRuntime = {
        appName: loaded.name,
        orchestrator,
        sessionRegistry,
        billing: resolved.modeBConfig.billing,
        systemPrompt,
      };
    }
  }

  const port = portOverride ?? gatewayConfig.port;

  // Build delegation registry from Mode B apps
  const delegationTargets = new Map<string, DelegationTarget>();
  for (const loaded of loadedApps) {
    const resolved = resolvedApps.find((r) => r.name === loaded.name);
    if (resolved?.modeBConfig?.runtime === "provider-adapter") {
      const provider = createProviderFromConfig(resolved.modeBConfig.provider);
      delegationTargets.set(loaded.name, {
        appName: loaded.name,
        provider,
        systemPrompt: buildSystemPromptFromApp(resolved.app),
      });
    }
  }
  const delegationRegistry: DelegationRegistry = { targets: delegationTargets };

  const honoApp = createGatewayApp({ port, apps: loadedApps, delegationRegistry });

  const { websocket } = createBunWebSocket();

  const appNames = loadedApps.map((a) => a.name).join(", ");
  console.log(`Gateway started on port ${port} with ${loadedApps.length} apps: ${appNames}`);

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({
      port,
      fetch: honoApp.fetch,
      websocket,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
      console.error(`Error: Port ${port} is already in use.`);
      process.exit(1);
    }
    throw err;
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      console.log("\nGateway shutting down...");
      server.stop(true);
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

/** Create a ProviderAdapter from a Mode B provider config */
function createProviderFromConfig(config: ProviderConfig): ProviderAdapter {
  const apiKey = config.apiKeyEnv ? process.env[config.apiKeyEnv] ?? "" : "";
  const model = config.model;

  switch (config.name) {
    case "anthropic":
      return new AnthropicAdapter({ apiKey, defaultModel: model });
    case "openai":
      return new OpenAIAdapter({ apiKey, defaultModel: model });
    case "deepseek":
      return new DeepSeekAdapter({ apiKey, defaultModel: model });
    case "ollama":
      return new OllamaAdapter({ defaultModel: model });
    default:
      throw new Error(`Unknown provider: ${config.name}`);
  }
}

/** Build a basic system prompt from an App composite */
function buildSystemPromptFromApp(app: App): string {
  return `You are ${app.name}. Respond helpfully.`;
}
