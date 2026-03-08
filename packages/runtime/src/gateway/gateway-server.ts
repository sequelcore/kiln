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
import type { ProviderAdapter, ProviderConfig, App, ToolDefinition, MemoryLayer, SttAdapter, Capability } from "@kilnai/core";
import { AnnotationAuthorizer, ToolResultSanitizer } from "@kilnai/core";
import type { AppGraphResponse } from "./dev-routes-types.js";
import { EventBus, McpClient, CostTracker } from "@kilnai/core";
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
import { ApprovalGateRegistry } from "./approval-registry.js";
import { DevOrchestrator } from "./dev-orchestrator.js";
import { DevTokenStore } from "./dev-token-store.js";
import { ConversationEventEmitter } from "./conversation-event-emitter.js";
import { createSttAdapter } from "./stt-factory.js";
import { createKnowledgePipeline, createSourceManager, createContactMemoryService } from "./knowledge-factory.js";
import type { KnowledgePipelineResult } from "./knowledge-factory.js";
import type { KnowledgeAdminRoutesConfig } from "./knowledge-admin-routes.js";
import type { ContactMemoryService } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import { WebhookDedup } from "./webhook-dedup.js";
import { SqliteEmailThreadStore } from "./sqlite-email-thread-store.js";
import { SqliteEnrichmentStore } from "../enrichment/sqlite-enrichment-store.js";
import { CompositeEventStore } from "../observability/composite-event-store.js";
import { PrometheusCollector } from "../observability/prometheus-collector.js";

export type { LoadedApp, GatewayServerConfig } from "./gateway-routes.js";
export { createGatewayApp } from "./gateway-routes.js";
export type { DevRoutesConfig } from "./dev-routes.js";
export { createDevRoutes } from "./dev-routes.js";
export type { AppGraphResponse, AppGraphTeam, AppGraphAgent, AppGraphRouter, EvalExperimentSummary } from "./dev-routes-types.js";
export { createDevInspectorHtml } from "./dev-inspector.js";
export { ApprovalGateRegistry } from "./approval-registry.js";
export type { ApprovalTarget } from "./approval-registry.js";
export { DevOrchestrator } from "./dev-orchestrator.js";
export type { DevOrchestratorConfig, DevRunResult } from "./dev-orchestrator.js";
export { DevTokenStore } from "./dev-token-store.js";
export type { DevToken } from "./dev-token-store.js";

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

interface DevRoutesSharedDeps {
  readonly eventBus: EventBus;
  readonly costTracker: CostTracker;
  readonly approvalRegistry: ApprovalGateRegistry;
  readonly devOrchestrator?: DevOrchestrator;
  readonly tokenStore?: DevTokenStore;
}

/** Build the shared portion of DevRoutesConfig from common dependencies */
function buildSharedDevRoutesConfig(deps: DevRoutesSharedDeps): Partial<import("./dev-routes.js").DevRoutesConfig> {
  const { eventBus, costTracker, approvalRegistry, devOrchestrator, tokenStore } = deps;
  return {
    getEventBus: () => eventBus,
    getCostSummary: () => costTracker.summary,
    approvePhase: (sessionId?: string) => approvalRegistry.approve(sessionId),
    rejectPhase: (reason: string, sessionId?: string) => approvalRegistry.reject(reason, sessionId),
    startRun: devOrchestrator
      ? (task: string) => {
          if (devOrchestrator.isRunning) return { error: "A run is already in progress" };
          const sessionId = devOrchestrator.start(task);
          return { sessionId };
        }
      : undefined,
    getRunStatus: devOrchestrator
      ? () => ({
          sessionId: devOrchestrator.orchestrator.sessionId,
          status: devOrchestrator.orchestrator.status,
          phase: devOrchestrator.orchestrator.currentPhase,
          task: devOrchestrator.orchestrator.task,
        })
      : undefined,
    issueToken: tokenStore ? (userId: string) => tokenStore.issue(userId) : undefined,
  };
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
        const verifyTokenEnv = whatsappChannel.verifyTokenEnv ?? "";
        const accessTokenEnv = whatsappChannel.accessTokenEnv ?? "";
        if (verifyTokenEnv && accessTokenEnv) {
          whatsappConfig = { verifyTokenEnv, accessTokenEnv };
        }
      }

      // Check for tenant admin
      const adminChannel = resolved.binding.channels.find((ch) => ch.adminTokenEnv);
      const adminTokenEnv = adminChannel?.adminTokenEnv ?? "";
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

      if (obsConfig.exporter === "console" || obsConfig.exporter === "otlp") {
        const sdkModuleName = "@opentelemetry/sdk-trace-base";
        const sdkBase = await import(sdkModuleName) as {
          BasicTracerProvider: new () => { addSpanProcessor(p: unknown): void; register(): void };
          ConsoleSpanExporter: new () => unknown;
          BatchSpanProcessor: new (e: unknown, opts?: { maxQueueSize?: number; scheduledDelayMillis?: number; exportTimeoutMillis?: number; maxExportBatchSize?: number }) => unknown;
        };
        const p = new sdkBase.BasicTracerProvider();

        if (obsConfig.exporter === "console") {
          p.addSpanProcessor(new sdkBase.BatchSpanProcessor(new sdkBase.ConsoleSpanExporter(), { maxQueueSize: 2048, scheduledDelayMillis: 5000, exportTimeoutMillis: 30000, maxExportBatchSize: 512 }));
        } else {
          const otlpModuleName = "@opentelemetry/exporter-trace-otlp-http";
          const otlpMod = await import(otlpModuleName) as {
            OTLPTraceExporter: new (opts: { url?: string }) => unknown;
          };
          p.addSpanProcessor(new sdkBase.BatchSpanProcessor(new otlpMod.OTLPTraceExporter({ url: obsConfig.endpoint }), { maxQueueSize: 2048, scheduledDelayMillis: 5000, exportTimeoutMillis: 30000, maxExportBatchSize: 512 }));
        }

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
  const prometheusCollector = new PrometheusCollector();
  const compositeStore = new CompositeEventStore(
    otelExporter ? [otelExporter, prometheusCollector] : [prometheusCollector],
  );
  const gatewayEventBus = new EventBus(100, compositeStore);
  const costTracker = new CostTracker();
  const webhookDedup = new WebhookDedup();

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
      instagramWebhookConfig: undefined as undefined | import("./instagram-webhook-routes.js").InstagramWebhookConfig,
      messengerWebhookConfig: undefined as undefined | import("./messenger-webhook-routes.js").MessengerWebhookConfig,
      emailWebhookConfig: undefined as undefined | import("./email-webhook-routes.js").EmailWebhookConfig,
      tenantAdminConfig: undefined as undefined | import("./tenant-admin-routes.js").TenantAdminRoutesConfig,
      webChannel: hasWebChannel ? new WebChannel() : undefined,
      eventEmitter: undefined as undefined | ConversationEventEmitter,
      sttAdapter: undefined as undefined | SttAdapter,
      knowledgePipeline: undefined as undefined | KnowledgePipelineResult,
      knowledgeAdminConfig: undefined as undefined | KnowledgeAdminRoutesConfig,
      contactMemoryService: undefined as undefined | ContactMemoryService,
      contactMemoryAdminConfig: undefined as undefined | import("./contact-memory-admin-routes.js").ContactMemoryAdminRoutesConfig,
      enrichmentAdminConfig: undefined as undefined | import("./enrichment-admin-routes.js").EnrichmentAdminRoutesConfig,
    };
  });

  // Initialize safety pipelines per app (before orchestrator wiring so sanitizers are available)
  const safetyPipelines = new Map<string, SafetyPipeline>();
  for (const loaded of loadedApps) {
    if (loaded.app.safety) {
      safetyPipelines.set(loaded.name, new SafetyPipeline(loaded.app.safety));
      console.log(`  ${loaded.name}: safety pipeline enabled`);
    }
  }

  // Initialize Mode B runtimes and delegation targets in a single pass
  const sessionRegistry = new SessionRegistry();
  const delegationTargets = new Map<string, DelegationTarget>();

  for (const loaded of loadedApps) {
    const resolved = resolvedApps.find((r) => r.name === loaded.name);
    if (!resolved?.modeBConfig || resolved.modeBConfig.runtime !== "provider-adapter") continue;

    const provider = createProviderFromConfig(resolved.modeBConfig.provider);
    const systemPrompt = buildSystemPromptFromApp(resolved.app);

    // Discover MCP tools if configured
    const mcpClients: McpClient[] = [];
    const tools: ToolDefinition[] = [];
    const capabilityMap = new Map<string, Capability>();

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
            capabilityMap.set(cap.name, cap);
          }
          mcpClients.push(client);
          console.log(`  ${loaded.name}: discovered ${capabilities.length} tools from MCP server "${serverConfig.name}"`);
        } catch (err) {
          console.warn(`  ${loaded.name}: failed to connect to MCP server "${serverConfig.name}": ${err}`);
        }
      }
    }

    // Collect capabilities from app team definitions
    for (const team of Object.values(resolved.app.teams)) {
      for (const cap of team.capabilities) {
        if (!capabilityMap.has(cap.name)) {
          capabilityMap.set(cap.name, cap);
        }
      }
    }

    // Initialize STT adapter if voice config is present
    if (resolved.app.voice?.stt) {
      try {
        loaded.sttAdapter = createSttAdapter(resolved.app.voice.stt);
        console.log(`  ${loaded.name}: STT adapter "${resolved.app.voice.stt.provider}" initialized`);
      } catch (err) {
        console.warn(`  ${loaded.name}: STT initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Initialize knowledge pipeline if knowledge config is present
    if (resolved.app.knowledge) {
      try {
        loaded.knowledgePipeline = await createKnowledgePipeline(resolved.app.knowledge);
        console.log(`  ${loaded.name}: knowledge pipeline initialized (mode: ${resolved.app.knowledge.mode ?? "auto"})`);

        // Initialize source manager for knowledge admin
        const storageDir = resolved.app.knowledge.store.backend === "pgvector"
          ? undefined
          : join(resolved.memoryBasePath, "knowledge-sources");
        const { sourceManager } = createSourceManager(
          loaded.knowledgePipeline.pipeline,
          loaded.knowledgePipeline.store,
          storageDir,
        );

        // Register YAML-declared sources
        for (const yamlSource of resolved.app.knowledge.sources) {
          const type = yamlSource.type ?? "file";
          try {
            await sourceManager.addSource({
              appName: loaded.name,
              name: yamlSource.name,
              type,
              uri: yamlSource.path,
            });
          } catch {
            // Source may already exist from previous run (JsonSourceStore)
          }
        }

        // Resolve admin token from channel binding
        const adminChannel = loaded.binding.channels.find((ch) => ch.adminTokenEnv);
        const adminTokenEnv = adminChannel?.adminTokenEnv ?? "";
        loaded.knowledgeAdminConfig = {
          sourceManager,
          appName: loaded.name,
          adminToken: adminTokenEnv ? process.env[adminTokenEnv] ?? undefined : undefined,
        };

        // Initialize contact memory service if configured
        if (resolved.app.knowledge.contactMemory?.enabled && loaded.knowledgePipeline) {
          try {
            loaded.contactMemoryService = createContactMemoryService({
              contactMemoryConfig: resolved.app.knowledge.contactMemory,
              vectorStore: loaded.knowledgePipeline.store,
              embedder: loaded.knowledgePipeline.embedder,
            });
            console.log(`  ${loaded.name}: contact memory service initialized`);

            // Wire contact memory admin routes (reuse same admin token as knowledge)
            loaded.contactMemoryAdminConfig = {
              contactMemoryService: loaded.contactMemoryService,
              appName: loaded.name,
              adminToken: adminTokenEnv ? process.env[adminTokenEnv] ?? undefined : undefined,
            };
          } catch (err) {
            console.warn(`  ${loaded.name}: contact memory initialization failed: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        // Fire-and-forget startup ingestion
        sourceManager.ingestAll(loaded.name).then((results) => {
          const indexed = results.filter((r) => r.status === "indexed").length;
          const failed = results.filter((r) => r.status === "failed").length;
          if (indexed > 0 || failed > 0) {
            console.log(`  ${loaded.name}: knowledge sources ingested (${indexed} indexed, ${failed} failed)`);
          }
        }).catch((err) => {
          console.warn(`  ${loaded.name}: knowledge ingestion failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } catch (err) {
        console.warn(`  ${loaded.name}: knowledge pipeline initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Wire enrichment admin routes (always available for multi-tenant apps)
    if (loaded.binding.channels.some((ch) => ch.multiTenant === true)) {
      const enrichmentDbPath = join(resolved.memoryBasePath, "enrichments.db");
      const enrichmentStore = new SqliteEnrichmentStore(enrichmentDbPath);
      const adminChannel = loaded.binding.channels.find((ch) => ch.adminTokenEnv);
      const enrichmentAdminTokenEnv = adminChannel?.adminTokenEnv ?? "";
      loaded.enrichmentAdminConfig = {
        enrichmentStore,
        appName: loaded.name,
        adminToken: enrichmentAdminTokenEnv ? process.env[enrichmentAdminTokenEnv] ?? undefined : undefined,
      };
      console.log(`  ${loaded.name}: enrichment admin routes enabled`);
    }

    // Wire tool execution enhancements
    const toolAuthorizer = capabilityMap.size > 0 ? new AnnotationAuthorizer() : undefined;
    const safetyPipeline = safetyPipelines.get(loaded.name);
    const toolResultSanitizer = safetyPipeline ? new ToolResultSanitizer(safetyPipeline) : undefined;

    const orchestrator = new ModeBOrchestrator({
      provider,
      model: resolved.modeBConfig.provider.model,
      tools: tools.length > 0 ? tools : undefined,
      mcpClients: mcpClients.length > 0 ? mcpClients : undefined,
      eventBus: gatewayEventBus,
      capabilityMap: capabilityMap.size > 0 ? capabilityMap : undefined,
      toolAuthorizer,
      toolResultSanitizer,
    });

    // Register delegation target (reuse provider + systemPrompt)
    delegationTargets.set(loaded.name, { appName: loaded.name, provider, systemPrompt });

    const isMultiTenant = loaded.binding.channels.some((ch) => ch.multiTenant === true);

    // Create event emitter if events config is present
    const eventEmitter = resolved.eventsConfig
      ? new ConversationEventEmitter(resolved.eventsConfig)
      : undefined;

    if (eventEmitter) {
      sessionRegistry.eventEmitter = eventEmitter;
      loaded.eventEmitter = eventEmitter;
    }

    // Wire contact memory extraction on session expiry
    if (loaded.contactMemoryService) {
      const cms = loaded.contactMemoryService;
      sessionRegistry.onSessionExpired = (session) => {
        if (session.tenantId && session.messageCount > 0) {
          const history = session.conversationHistory
            .map((m) => `${m.role}: ${extractText(m.parts)}`)
            .join("\n");
          cms.extractAndStore(history, session.userId, session.tenantId)
            .catch((err) => console.warn(`Contact memory extraction failed: ${err}`));
        }
      };
    }

    // Resolve API key from channel binding (shared across REST + WS for this app)
    const apiChannel = loaded.binding.channels.find((ch) => ch.type === "api");
    const resolvedApiKey = apiChannel?.apiKeyEnv ? process.env[apiChannel.apiKeyEnv] ?? undefined : undefined;

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
        apiKey: resolvedApiKey,
      };

      // WhatsApp webhook: find whatsapp channel with verifyTokenEnv
      const whatsappChannel = loaded.binding.channels.find((ch) => ch.type === "whatsapp");
      if (whatsappChannel) {
        const verifyTokenEnv = whatsappChannel.verifyTokenEnv ?? "";
        const appSecretEnv = whatsappChannel.appSecretEnv ?? "";
        loaded.whatsappWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: verifyTokenEnv ? process.env[verifyTokenEnv] ?? "" : "",
          appSecret: appSecretEnv ? process.env[appSecretEnv] ?? undefined : undefined,
          billing: resolved.modeBConfig.billing,
          eventEmitter,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          knowledgePipeline: loaded.knowledgePipeline?.pipeline,
          knowledgeMode: resolved.app.knowledge?.mode,
          contactMemoryService: loaded.contactMemoryService,
          dedup: webhookDedup,
        };
      }

      // Instagram webhook: find instagram channel config
      const instagramChannel = loaded.binding.channels.find((ch) => ch.type === "instagram");
      if (instagramChannel) {
        // Instagram shares the same Meta App Secret as WhatsApp
        const igAppSecretEnv = instagramChannel.appSecretEnv ?? whatsappChannel?.appSecretEnv ?? "";
        const igVerifyTokenEnv = instagramChannel.verifyTokenEnv ?? "";
        loaded.instagramWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: igVerifyTokenEnv ? process.env[igVerifyTokenEnv] ?? "" : "",
          appSecret: igAppSecretEnv ? process.env[igAppSecretEnv] ?? undefined : undefined,
          billing: resolved.modeBConfig.billing,
          eventEmitter,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          knowledgePipeline: loaded.knowledgePipeline?.pipeline,
          knowledgeMode: resolved.app.knowledge?.mode,
          contactMemoryService: loaded.contactMemoryService,
          dedup: webhookDedup,
        };
      }

      // Messenger webhook: find messenger channel config
      const messengerChannel = loaded.binding.channels.find((ch) => ch.type === "messenger");
      if (messengerChannel) {
        const msgAppSecretEnv = messengerChannel.appSecretEnv ?? whatsappChannel?.appSecretEnv ?? "";
        const msgVerifyTokenEnv = messengerChannel.verifyTokenEnv ?? "";
        loaded.messengerWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: msgVerifyTokenEnv ? process.env[msgVerifyTokenEnv] ?? "" : "",
          appSecret: msgAppSecretEnv ? process.env[msgAppSecretEnv] ?? undefined : undefined,
          billing: resolved.modeBConfig.billing,
          eventEmitter,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          knowledgePipeline: loaded.knowledgePipeline?.pipeline,
          knowledgeMode: resolved.app.knowledge?.mode,
          contactMemoryService: loaded.contactMemoryService,
          dedup: webhookDedup,
        };
      }

      // Email webhook: find email channel config
      const emailChannel = loaded.binding.channels.find((ch) => ch.type === "email");
      if (emailChannel) {
        const emailWebhookSecretEnv = emailChannel.appSecretEnv ?? "";
        const emailThreadDbPath = join(resolved.memoryBasePath, "email-threads.db");
        const emailThreadStore = new SqliteEmailThreadStore(emailThreadDbPath);

        loaded.emailWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          webhookSecret: emailWebhookSecretEnv ? process.env[emailWebhookSecretEnv] ?? undefined : undefined,
          billing: resolved.modeBConfig.billing,
          eventEmitter,
          memoryBasePath: resolved.memoryBasePath,
          knowledgePipeline: loaded.knowledgePipeline?.pipeline,
          knowledgeMode: resolved.app.knowledge?.mode,
          contactMemoryService: loaded.contactMemoryService,
          threadStore: emailThreadStore,
        };
      }

      // Admin routes
      const adminChannel = loaded.binding.channels.find((ch) => ch.adminTokenEnv);
      const adminTokenEnv = adminChannel?.adminTokenEnv ?? "";
      loaded.tenantAdminConfig = {
        tenantRegistry,
        sessionRegistry,
        appName: loaded.name,
        adminToken: adminTokenEnv ? process.env[adminTokenEnv] ?? undefined : undefined,
      };

      const tenantCount = tenantRegistry.list(loaded.name).length;
      console.log(`  ${loaded.name}: multi-tenant mode (${tenantCount} tenants loaded)`);
    } else {
      // Standard Mode B (non-tenant)
      loaded.modeBRuntime = {
        appName: loaded.name,
        orchestrator,
        sessionRegistry,
        billing: resolved.modeBConfig.billing,
        systemPrompt,
        apiKey: resolvedApiKey,
        knowledgePipeline: loaded.knowledgePipeline?.pipeline,
        knowledgeMode: resolved.app.knowledge?.mode,
      };
    }
  }

  // Auth warnings: notify when channels lack auth configuration
  for (const loaded of loadedApps) {
    for (const channel of loaded.binding.channels) {
      if (channel.type === "api" && channel.path && !channel.apiKeyEnv) {
        console.warn(`  [warn] API channel at ${channel.path} has no apiKeyEnv -- endpoints are unauthenticated`);
      }
      if (channel.type === "whatsapp" && !channel.appSecretEnv) {
        console.warn(`  [warn] WhatsApp channel for ${loaded.name} has no appSecretEnv -- webhook signatures will not be verified`);
      }
      if (channel.type === "instagram" && !channel.appSecretEnv) {
        console.warn(`  [warn] Instagram channel for ${loaded.name} has no appSecretEnv -- webhook signatures will not be verified`);
      }
      if (channel.type === "messenger" && !channel.appSecretEnv) {
        console.warn(`  [warn] Messenger channel for ${loaded.name} has no appSecretEnv -- webhook signatures will not be verified`);
      }
      if (channel.multiTenant && !channel.adminTokenEnv) {
        console.warn(`  [warn] Multi-tenant app ${loaded.name} has no adminTokenEnv -- admin routes are unauthenticated`);
      }
    }
  }

  const port = options?.port ?? gatewayConfig.port;
  const delegationRegistry: DelegationRegistry = { targets: delegationTargets };

  // Create health registry and register subsystem checkers
  const healthRegistry = new HealthRegistry();
  const startTime = Date.now();

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

  const approvalRegistry = new ApprovalGateRegistry();
  const devOrchestrator = options?.devMode
    ? new DevOrchestrator({ eventBus: gatewayEventBus, approvalRegistry })
    : undefined;

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

  const tokenStore = options?.devMode ? new DevTokenStore() : undefined;

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
    validateToken: tokenStore ? (token) => tokenStore.validate(token) : undefined,
    devMode: options?.devMode,
    studioDistPath,
    devRoutesConfig: options?.devMode
      ? {
        ...buildSharedDevRoutesConfig({
          eventBus: gatewayEventBus,
          costTracker,
          approvalRegistry,
          devOrchestrator,
          tokenStore,
        }),
        getPhaseState: async () => {
          const active = await sessionRegistry.activeSessions();
          const orch = devOrchestrator?.orchestrator;
          return {
            status: orch && devOrchestrator.isRunning ? orch.status : (active.length > 0 ? "active" : "idle"),
            activeSessions: active.length,
            sessions: active.map((s) => ({
              id: s.id,
              appName: s.appName,
              userId: s.userId,
              messageCount: s.messageCount,
              createdAt: s.createdAt.toISOString(),
              lastActivityAt: s.lastActivityAt.toISOString(),
            })),
            orchestrator: orch ? {
              sessionId: orch.sessionId,
              status: orch.status,
              phase: orch.currentPhase,
              task: orch.task,
            } : undefined,
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
        getAppNames: () => loadedApps.map((a) => a.name),
        getSafetyMetrics: () => {
          if (safetyPipelines.size === 0) return { enabled: false };
          const apps: Record<string, unknown> = {};
          for (const [appName, pipeline] of safetyPipelines) {
            apps[appName] = pipeline.metrics;
          }
          return { enabled: true, apps };
        },
        getTriggers: () => triggerRegistry.listAll(),
        getMemoryByScope: async (scope: string, q?: string, tags?: string) => {
          if (!devMemoryStores) return [];
          const validLayers: MemoryLayer[] = ["user", "agent", "project"];
          const layer = validLayers.includes(scope as MemoryLayer) ? (scope as MemoryLayer) : "project";
          const store = devMemoryStores.get(layer);
          if (!store) return [];

          if (q) {
            const results = await store.search(q, 100);
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
      }
      : undefined,
  });

  if (studioDistPath) {
    mountStudio(honoApp, studioDistPath);
  }

  // Prometheus metrics endpoint (unauthenticated, before per-app routes)
  honoApp.get("/metrics", async (c) => {
    const registry = await prometheusCollector.getRegistry();
    if (!registry) {
      return c.text("Prometheus metrics not available (prom-client not installed)", 503);
    }
    const metrics = await registry.metrics();
    return c.text(metrics, 200, { "Content-Type": registry.contentType });
  });

  triggerRegistry.start();

  const appNames = loadedApps.map((a) => a.name).join(", ");
  console.log(`Gateway started on port ${port} with ${loadedApps.length} apps: ${appNames}`);
  if (options?.devMode) {
    console.log(`Studio: http://localhost:${port}/${studioDistPath ? "studio" : "dev"}/`);
  }

  await serveAndWait(honoApp, port, () => {
    triggerRegistry.stop();
    webhookDedup.close();
    for (const loaded of loadedApps) {
      loaded.knowledgePipeline?.close().catch(() => {});
    }
  }, bunWebsocket);
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
  const costTracker = new CostTracker();
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

  const approvalRegistry = new ApprovalGateRegistry();
  const devOrchestrator = new DevOrchestrator({ eventBus, approvalRegistry });
  const tokenStore = new DevTokenStore();

  const honoApp = createGatewayApp({
    port,
    apps: [],
    devMode: true,
    studioDistPath,
    upgradeWebSocket: undefined,
    validateToken: (token) => tokenStore.validate(token),
    devRoutesConfig: {
      ...buildSharedDevRoutesConfig({
        eventBus,
        costTracker,
        approvalRegistry,
        devOrchestrator,
        tokenStore,
      }),
      getPhaseState: () => {
        const orch = devOrchestrator.orchestrator;
        return {
          status: devOrchestrator.isRunning ? orch.status : "idle",
          orchestrator: {
            sessionId: orch.sessionId,
            status: orch.status,
            phase: orch.currentPhase,
            task: orch.task,
          },
        };
      },
      getMemorySnapshot: () => ({ entries: [] }),
      getSafetyMetrics: () => ({ enabled: false }),
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
    },
  });

  if (studioDistPath) {
    mountStudio(honoApp, studioDistPath);
  }

  console.log(`Dev server started on port ${port}`);
  console.log(`Studio: http://localhost:${port}/${studioDistPath ? "studio" : "dev"}/`);

  await serveAndWait(honoApp, port);
}
