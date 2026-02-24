// Gateway: GatewayServer -- persistent Bun/Hono process hosting multiple Apps

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { createBunWebSocket, serveStatic } from "hono/bun";
import type { Hono } from "hono";
import {
  parseGatewayYaml,
  parseAppYaml,
  AnthropicAdapter,
  OpenAIAdapter,
  DeepSeekAdapter,
  OllamaAdapter,
  KilnError,
  OTelExporter,
  SafetyPipeline,
  SqliteMemoryStore,
} from "@kilnai/core";
import type { ProviderAdapter, ProviderConfig, App, ToolDefinition, MemoryLayer } from "@kilnai/core";
import type { AppGraphResponse } from "./dev-routes-types.js";
import { EventBus, McpClient } from "@kilnai/core";
import { ChannelRegistry } from "../channels/channel-registry.js";
import { WebChannel } from "../channels/web-channel.js";
import { TriggerRegistry } from "../trigger/trigger-registry.js";
import { resolveApps } from "./app-resolver.js";
import type { ResolvedApp } from "./app-resolver.js";
import { createGatewayApp } from "./gateway-routes.js";
import { ModeBOrchestrator } from "../session/mode-b-orchestrator.js";
import { SessionRegistry } from "../session/session-registry.js";
import type { DelegationTarget, DelegationRegistry } from "./delegation-handler.js";
import { TenantRegistry } from "../tenant/tenant-registry.js";
import { assertValidStartupConfig } from "./config-validator.js";
import { HealthRegistry } from "./health-registry.js";

export type { LoadedApp, GatewayServerConfig } from "./gateway-routes.js";
export { createGatewayApp } from "./gateway-routes.js";
export type { DevRoutesConfig } from "./dev-routes.js";
export { createDevRoutes } from "./dev-routes.js";
export type { AppGraphResponse, AppGraphTeam, AppGraphAgent, AppGraphRouter, EvalExperimentSummary } from "./dev-routes-types.js";
export { createDevInspectorHtml } from "./dev-inspector.js";

export interface StartGatewayOptions {
  readonly port?: number;
  readonly devMode?: boolean;
  readonly studioDistPath?: string;
}

export interface DevServerOptions {
  readonly port?: number;
  readonly appYamlPath?: string;
  readonly studioDistPath?: string;
}

function resolveStudioDist(): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const pkgPath = require.resolve("@kilnai/studio/package.json");
    const distDir = join(dirname(pkgPath), "dist");
    if (existsSync(join(distDir, "index.html"))) return distDir;
    console.warn("Studio: @kilnai/studio found but dist/ not built. Run `bun run build` in packages/studio.");
    return undefined;
  } catch {
    console.warn("Studio: @kilnai/studio not installed. Using inline dev inspector. Install it for the full Studio UI.");
    return undefined;
  }
}

export async function startGateway(configPath: string, options?: StartGatewayOptions): Promise<void> {
  let content: string;
  try {
    content = readFileSync(configPath, "utf-8");
  } catch {
    throw new KilnError("CONFIG_INVALID", `Failed to read gateway config: ${configPath}`, {
      context: { configPath },
    });
  }

  const gatewayConfig = parseGatewayYaml(content);
  const gatewayYamlDir = dirname(configPath);

  const resolvedApps = resolveApps(gatewayConfig, gatewayYamlDir);

  // Build startup config validation input from resolved apps
  const modeBApps: { provider: string; apiKeyEnv: string }[] = [];
  let whatsappConfig: { verifyTokenEnv: string; accessTokenEnv: string } | undefined;
  let tenantAdminConfig: { adminTokenEnv: string } | undefined;

  for (const resolved of resolvedApps) {
    if (resolved.modeBConfig?.runtime === "provider-adapter") {
      const providerName = resolved.modeBConfig.provider.name;
      const apiKeyEnv = resolved.modeBConfig.provider.apiKeyEnv;
      if (apiKeyEnv) {
        modeBApps.push({ provider: providerName, apiKeyEnv });
      }

      // Check for WhatsApp channel
      const whatsappChannel = resolved.binding.channels.find((ch) => ch.type === "whatsapp");
      if (whatsappChannel) {
        const verifyTokenEnv = (whatsappChannel.verifyTokenEnv as string) ?? "";
        const accessTokenEnv = (whatsappChannel.accessTokenEnv as string) ?? "";
        if (verifyTokenEnv && accessTokenEnv) {
          whatsappConfig = { verifyTokenEnv, accessTokenEnv };
        }
      }

      // Check for tenant admin
      const adminChannel = resolved.binding.channels.find((ch) => ch.adminTokenEnv);
      const adminTokenEnv = (adminChannel?.adminTokenEnv as string) ?? "";
      if (adminTokenEnv) {
        tenantAdminConfig = { adminTokenEnv };
      }
    }
  }

  // Validate startup configuration before creating providers
  assertValidStartupConfig({
    modeBApps: modeBApps.length > 0 ? modeBApps : undefined,
    whatsapp: whatsappConfig,
    tenantAdmin: tenantAdminConfig,
  });

  // Initialize OTel exporter if observability is configured
  // @opentelemetry/sdk-trace-base and @opentelemetry/exporter-trace-otlp-http are user-installed
  // optional packages -- loaded via dynamic import so they're truly optional at compile time.
  let otelExporter: OTelExporter | undefined;
  const obsConfig = gatewayConfig.observability;
  if (obsConfig?.enabled) {
    try {
      const { trace } = await import("@opentelemetry/api");
      let provider: import("@opentelemetry/api").TracerProvider;

      if (obsConfig.exporter === "console") {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const sdkBase = await (new Function("m", "return import(m)"))("@opentelemetry/sdk-trace-base") as {
          BasicTracerProvider: new () => { addSpanProcessor(p: unknown): void; register(): void };
          ConsoleSpanExporter: new () => unknown;
          SimpleSpanProcessor: new (e: unknown) => unknown;
        };
        const p = new sdkBase.BasicTracerProvider();
        p.addSpanProcessor(new sdkBase.SimpleSpanProcessor(new sdkBase.ConsoleSpanExporter()));
        p.register();
        provider = p as unknown as import("@opentelemetry/api").TracerProvider;
      } else if (obsConfig.exporter === "otlp") {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const sdkBase = await (new Function("m", "return import(m)"))("@opentelemetry/sdk-trace-base") as {
          BasicTracerProvider: new () => { addSpanProcessor(p: unknown): void; register(): void };
          SimpleSpanProcessor: new (e: unknown) => unknown;
        };
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        const otlpMod = await (new Function("m", "return import(m)"))("@opentelemetry/exporter-trace-otlp-http") as {
          OTLPTraceExporter: new (opts: { url?: string }) => unknown;
        };
        const p = new sdkBase.BasicTracerProvider();
        p.addSpanProcessor(new sdkBase.SimpleSpanProcessor(new otlpMod.OTLPTraceExporter({ url: obsConfig.endpoint })));
        p.register();
        provider = p as unknown as import("@opentelemetry/api").TracerProvider;
      } else {
        // exporter: none -- use the global noop tracer provider
        provider = trace.getTracerProvider();
      }

      otelExporter = new OTelExporter(provider, {
        serviceName: obsConfig.serviceName,
        attributes: obsConfig.attributes,
      });
      console.log(`Observability: OTel exporter "${obsConfig.exporter}" enabled for service "${obsConfig.serviceName}"`);
    } catch (err) {
      console.warn(`Observability: failed to initialize OTel exporter -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // EventBus: shared across all apps for observability and dev inspector
  const gatewayEventBus = new EventBus(100, otelExporter);

  const loadedApps = resolvedApps.map((resolved: ResolvedApp) => {
    const hasWebChannel = resolved.binding.channels.some((ch) => ch.type === "web");
    return {
      name: resolved.name,
      app: resolved.app,
      binding: resolved.binding,
      registry: new ChannelRegistry(),
      modeBRuntime: undefined as undefined | import("./mode-b-routes.js").ModeBAppRuntime,
      tenantRuntime: undefined as undefined | import("./tenant-routes.js").TenantAppRuntime,
      whatsappWebhookConfig: undefined as undefined | import("./whatsapp-webhook-routes.js").WhatsAppWebhookConfig,
      tenantAdminConfig: undefined as undefined | import("./tenant-admin-routes.js").TenantAdminRoutesConfig,
      webChannel: hasWebChannel ? new WebChannel() : undefined,
    };
  });

  // Initialize Mode B and multi-tenant runtimes
  const sessionRegistry = new SessionRegistry();
  for (const loaded of loadedApps) {
    const resolved = resolvedApps.find((r) => r.name === loaded.name);
    if (!resolved?.modeBConfig || resolved.modeBConfig.runtime !== "provider-adapter") continue;

    const provider = createProviderFromConfig(resolved.modeBConfig.provider);

    // Discover MCP tools if configured
    const mcpClients: McpClient[] = [];
    const tools: ToolDefinition[] = [];
    if (resolved.app.mcp?.servers) {
      for (const serverConfig of resolved.app.mcp.servers) {
        try {
          const client = new McpClient(serverConfig);
          const capabilities = await client.discoverTools();
          for (const cap of capabilities) {
            tools.push({
              name: cap.name,
              description: cap.description,
              inputSchema: cap.schema,
              tags: new Set(cap.tags),
            });
          }
          mcpClients.push(client);
          console.log(`  ${loaded.name}: discovered ${capabilities.length} tools from MCP server "${serverConfig.name}"`);
        } catch (err) {
          console.warn(`  ${loaded.name}: failed to connect to MCP server "${serverConfig.name}": ${err}`);
        }
      }
    }

    const orchestrator = new ModeBOrchestrator({
      provider,
      tools: tools.length > 0 ? tools : undefined,
      mcpClients: mcpClients.length > 0 ? mcpClients : undefined,
      eventBus: gatewayEventBus,
    });
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

  const port = options?.port ?? gatewayConfig.port;

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

  // Create health registry and register subsystem checkers
  const healthRegistry = new HealthRegistry();
  const startTime = Date.now();

  // Register memory health checker
  healthRegistry.register("memory", () => {
    // Simple memory check - verify we have access to memory
    try {
      // Check if we can create a session (basic connectivity test)
      return { status: "ok" as const };
    } catch {
      return { status: "error" as const, details: { reason: "Memory store unreachable" } };
    }
  });

  // Register provider health checker
  healthRegistry.register("providers", () => {
    const providerStatuses: Record<string, string> = {};
    let hasError = false;

    for (const loaded of loadedApps) {
      const resolved = resolvedApps.find((r) => r.name === loaded.name);
      if (resolved?.modeBConfig?.runtime === "provider-adapter") {
        const providerName = resolved.modeBConfig.provider.name;
        // Provider is considered ok if we have an API key configured
        const apiKeyEnv = resolved.modeBConfig.provider.apiKeyEnv;
        const hasKey = apiKeyEnv ? Boolean(process.env[apiKeyEnv]) : false;
        providerStatuses[providerName] = hasKey ? "ok" : "error";
        if (!hasKey) hasError = true;
      }
    }

    return {
      status: hasError ? "error" : "ok",
      details: providerStatuses,
    };
  });

  // Register budget health checker
  healthRegistry.register("budget", () => {
    // Check if any app has billing configured
    const hasBilling = loadedApps.some((loaded) => {
      const resolved = resolvedApps.find((r) => r.name === loaded.name);
      return Boolean(resolved?.modeBConfig?.billing);
    });

    if (!hasBilling) {
      return { status: "ok" as const, details: { configured: false } };
    }

    return { status: "ok" as const, details: { configured: true } };
  });

  // Initialize trigger registry for apps with triggers
  const triggerRegistry = new TriggerRegistry({ eventBus: gatewayEventBus });

  for (const loaded of loadedApps) {
    const triggers = loaded.app.triggers;
    if (triggers && triggers.length > 0) {
      triggerRegistry.registerApp(loaded.name, triggers);
      console.log(`  ${loaded.name}: ${triggers.length} trigger(s) registered`);
    }
  }

  // Initialize safety pipelines per app
  const safetyPipelines = new Map<string, SafetyPipeline>();
  for (const loaded of loadedApps) {
    if (loaded.app.safety) {
      safetyPipelines.set(loaded.name, new SafetyPipeline(loaded.app.safety));
      console.log(`  ${loaded.name}: safety pipeline enabled`);
    }
  }

  const studioDistPath = options?.studioDistPath ?? (options?.devMode ? resolveStudioDist() : undefined);

  // Initialize dev-mode memory stores (one per layer)
  let devMemoryStores: Map<MemoryLayer, SqliteMemoryStore> | undefined;
  if (options?.devMode) {
    const firstResolved = resolvedApps[0];
    if (firstResolved) {
      const devMemoryDir = join(firstResolved.memoryBasePath, "dev");
      mkdirSync(devMemoryDir, { recursive: true });
      devMemoryStores = new Map<MemoryLayer, SqliteMemoryStore>();
      for (const layer of ["user", "agent", "project"] as MemoryLayer[]) {
        devMemoryStores.set(layer, new SqliteMemoryStore({
          dbPath: join(devMemoryDir, `${layer}.db`),
          layer,
        }));
      }
    }
  }

  const { upgradeWebSocket, websocket: bunWebsocket } = createBunWebSocket();

  const honoApp = createGatewayApp({
    port,
    apps: loadedApps,
    delegationRegistry,
    healthRegistry,
    startTime,
    triggerRegistry,
    safetyPipelines,
    upgradeWebSocket,
    devMode: options?.devMode,
    studioDistPath,
    devRoutesConfig: options?.devMode
      ? {
        getEventBus: () => gatewayEventBus,
        getPhaseState: () => {
          const active = sessionRegistry.activeSessions();
          if (active.length === 0) {
            return { status: "idle", activeSessions: 0, sessions: [] };
          }
          return {
            status: "active",
            activeSessions: active.length,
            sessions: active.map((s) => ({
              id: s.id,
              appName: s.appName,
              userId: s.userId,
              messageCount: s.messageCount,
              createdAt: s.createdAt.toISOString(),
              lastActivityAt: s.lastActivityAt.toISOString(),
            })),
          };
        },
        getMemorySnapshot: () => {
          if (!devMemoryStores) return { entries: [] };
          const counts: Record<string, number> = {};
          for (const [layer, store] of devMemoryStores) {
            counts[layer] = store.count;
          }
          return { layers: counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
        },
        getCostSummary: () => ({ totalCostUsd: 0, byRole: {} }),
        getAppNames: () => loadedApps.map((a) => a.name),
        getTriggers: () => triggerRegistry.listAll(),
        getMemoryByScope: async (scope: string, q?: string, tags?: string) => {
          if (!devMemoryStores) return [];
          const validLayers: MemoryLayer[] = ["user", "agent", "project"];
          const layer = validLayers.includes(scope as MemoryLayer) ? (scope as MemoryLayer) : "project";
          const store = devMemoryStores.get(layer);
          if (!store) return [];

          if (q) {
            const results = await store.search(q, layer, 100);
            return results.map((r) => ({
              id: r.entry.id,
              layer: r.entry.layer,
              content: r.entry.content,
              tags: r.entry.tags,
              score: r.score,
              snippet: r.snippet,
              createdAt: r.entry.createdAt.toISOString(),
              lastAccessedAt: r.entry.lastAccessedAt.toISOString(),
              accessCount: r.entry.accessCount,
            }));
          }

          const entries = store.listEntries({ tags });
          return entries.map((e) => ({
            id: e.id,
            layer: e.layer,
            content: e.content,
            tags: e.tags,
            createdAt: e.createdAt.toISOString(),
            lastAccessedAt: e.lastAccessedAt.toISOString(),
            accessCount: e.accessCount,
          }));
        },
        createMemoryEntry: async (entry: Record<string, unknown>) => {
          if (!devMemoryStores) return { id: "" };
          const validLayers: MemoryLayer[] = ["user", "agent", "project"];
          const layer = validLayers.includes(entry["layer"] as MemoryLayer)
            ? (entry["layer"] as MemoryLayer)
            : "project";
          const store = devMemoryStores.get(layer);
          if (!store) return { id: "" };

          const content = typeof entry["content"] === "string" ? entry["content"] : String(entry["content"] ?? "");
          const rawTags = Array.isArray(entry["tags"]) ? entry["tags"] : [];
          const entryTags = rawTags.filter((t): t is string => typeof t === "string");

          const id = await store.save({ layer, content, tags: entryTags });
          return { id };
        },
        deleteMemoryEntry: async (id: string) => {
          if (!devMemoryStores) return false;
          for (const store of devMemoryStores.values()) {
            if (store.hasEntry(id)) {
              await store.forget(id);
              return true;
            }
          }
          return false;
        },
        getAppGraph: () => {
          const firstLoaded = loadedApps[0];
          if (!firstLoaded) return undefined;
          return appToGraph(firstLoaded.app);
        },
        getYamlContent: () => {
          try {
            const firstBinding = gatewayConfig.apps[0];
            if (!firstBinding) return undefined;
            const yamlPath = join(gatewayYamlDir, firstBinding.config);
            return readFileSync(yamlPath, "utf-8");
          } catch { return undefined; }
        },
        putYamlContent: (content: string) => {
          try {
            // Validate YAML before writing
            parseAppYaml(content);
            const firstBinding = gatewayConfig.apps[0];
            if (!firstBinding) return { ok: false, errors: ["No YAML path available"] };
            const yamlPath = join(gatewayYamlDir, firstBinding.config);
            writeFileSync(yamlPath, content, "utf-8");
            return { ok: true };
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            return { ok: false, errors: [msg] };
          }
        },
        getEvalExperiments: () => {
          const firstLoaded = loadedApps[0];
          if (!firstLoaded?.app.eval?.experiments) return [];
          return firstLoaded.app.eval.experiments.map((exp) => ({
            name: exp.name,
            dataset: exp.dataset,
            scorers: [...exp.scorers],
          }));
        },
        getEvalResults: () => undefined,
      }
      : undefined,
  });

  if (studioDistPath) {
    mountStudio(honoApp, studioDistPath);
  }

  triggerRegistry.start();

  const appNames = loadedApps.map((a) => a.name).join(", ");
  console.log(`Gateway started on port ${port} with ${loadedApps.length} apps: ${appNames}`);
  if (options?.devMode) {
    console.log(`Studio: http://localhost:${port}/${studioDistPath ? "studio" : "dev"}/`);
  }

  await serveAndWait(honoApp, port, () => triggerRegistry.stop(), bunWebsocket);
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
      throw new KilnError("CONFIG_INVALID", `Unknown provider: ${config.name}`, {
        context: { provider: config.name },
      });
  }
}

/** Build a system prompt from an App composite using agent metadata */
function buildSystemPromptFromApp(app: App): string {
  // Find the primary agent: the manager of the fallback team, or first agent
  const fallbackTeam = app.teams[app.router.fallback];
  let primaryAgent: { name: string; role: string; goal: string; backstory?: string; instructions?: string } | undefined;

  if (fallbackTeam) {
    if (fallbackTeam.manager && fallbackTeam.agents[fallbackTeam.manager]) {
      primaryAgent = fallbackTeam.agents[fallbackTeam.manager];
    } else {
      const agents = Object.values(fallbackTeam.agents);
      primaryAgent = agents[0];
    }
  }

  if (!primaryAgent) {
    return `You are ${app.name}. Respond helpfully.`;
  }

  const parts: string[] = [];

  // Identity
  if (primaryAgent.backstory) {
    parts.push(primaryAgent.backstory);
  } else {
    parts.push(`You are ${primaryAgent.name}, ${primaryAgent.role}.`);
  }

  // Goal
  if (primaryAgent.goal) {
    parts.push(`\nYour goal: ${primaryAgent.goal}`);
  }

  // Instructions
  if (primaryAgent.instructions) {
    parts.push(`\n${primaryAgent.instructions}`);
  }

  return parts.join("\n");
}

function appToGraph(app: App): AppGraphResponse {
  return {
    name: app.name,
    teams: Object.entries(app.teams).map(([name, team]) => ({
      name,
      agents: Object.values(team.agents).map((a) => ({
        name: a.name,
        role: a.role,
        goal: a.goal,
        tier: a.tier,
        tools: [...a.tools],
        modalities: a.modalities ? [...a.modalities] : undefined,
      })),
      capabilities: team.capabilities.map((c) => c.name),
      phases: [...team.workflow.phases],
      mode: team.mode,
    })),
    router: {
      rules: app.router.rules.map((r) => ({ pattern: r.match, team: r.team })),
      fallback: app.router.fallback,
      classifier: app.router.classifier?.name,
    },
    channels: [...app.channels],
    triggers: app.triggers?.map((t) => t.name) ?? [],
    hasKnowledge: !!app.knowledge,
    hasEval: !!app.eval,
    hasSafety: !!app.safety,
  };
}

function mountStudio(app: Hono, distPath: string): void {
  app.get("/studio", (c) => c.redirect("/studio/"));
  app.use("/studio/*", serveStatic({
    root: distPath,
    rewriteRequestPath: (path) => {
      const stripped = path.replace(/^\/studio/, "");
      return stripped === "/" || stripped === "" ? "/index.html" : stripped;
    },
  }));
  app.get("/studio/*", (c) => {
    const html = readFileSync(join(distPath, "index.html"), "utf-8");
    return c.html(html);
  });
}

async function serveAndWait(app: Hono, port: number, onShutdown?: () => void, websocketHandler?: ReturnType<typeof createBunWebSocket>["websocket"]): Promise<void> {
  const websocket = websocketHandler ?? createBunWebSocket().websocket;

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ port, fetch: app.fetch, websocket });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
      console.error(`Error: Port ${port} is already in use.`);
      process.exit(1);
    }
    throw err;
  }

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      console.log("\nShutting down...");
      onShutdown?.();
      server.stop(true);
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

export async function startDevServer(options?: DevServerOptions): Promise<void> {
  const port = options?.port ?? 4800;
  const eventBus = new EventBus(100);
  const studioDistPath = options?.studioDistPath ?? resolveStudioDist();

  let app: App | undefined;
  const appYamlPath = options?.appYamlPath;
  if (appYamlPath && existsSync(appYamlPath)) {
    try {
      app = parseAppYaml(readFileSync(appYamlPath, "utf-8"));
    } catch {
      // Invalid YAML -- Studio will show empty graph
    }
  }

  const honoApp = createGatewayApp({
    port,
    apps: [],
    devMode: true,
    studioDistPath,
    devRoutesConfig: {
      getEventBus: () => eventBus,
      getPhaseState: () => ({ status: "idle", phase: null }),
      getMemorySnapshot: () => ({ entries: [] }),
      getCostSummary: () => ({ totalCostUsd: 0, byRole: {} }),
      getAppNames: () => app ? [app.name] : [],
      getTriggers: () => [],
      getAppGraph: () => app ? appToGraph(app) : undefined,
      getYamlContent: () => {
        if (!appYamlPath) return undefined;
        try { return readFileSync(appYamlPath, "utf-8"); } catch { return undefined; }
      },
      putYamlContent: (content: string) => {
        if (!appYamlPath) return { ok: false, errors: ["No app.yaml path"] };
        try {
          parseAppYaml(content);
          writeFileSync(appYamlPath, content, "utf-8");
          try { app = parseAppYaml(content); } catch { /* keep previous */ }
          return { ok: true };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { ok: false, errors: [msg] };
        }
      },
      getEvalExperiments: () => {
        if (!app?.eval?.experiments) return [];
        return app.eval.experiments.map((exp) => ({
          name: exp.name,
          dataset: exp.dataset,
          scorers: [...exp.scorers],
        }));
      },
      getEvalResults: () => undefined,
    },
  });

  if (studioDistPath) {
    mountStudio(honoApp, studioDistPath);
  }

  console.log(`Dev server started on port ${port}`);
  console.log(`Studio: http://localhost:${port}/${studioDistPath ? "studio" : "dev"}/`);

  await serveAndWait(honoApp, port);
}
