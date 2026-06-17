// Gateway: GatewayServer -- persistent Bun/Hono process hosting multiple Apps

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import type { Hono } from "hono";
import {
  parseGatewayYaml,
  parseAppYaml,
  KilnError,
  OTelExporter,
  SafetyPipeline,
  SqliteMemoryRepository,
  AesSecretStore,
  GroundingRail,
  MemoryArtifactResourceStore,
  ModelCapabilityRegistry,
  DeterministicDangerousCommandDetector,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  CredentialPoolObservabilityRegistry,
  CredentialWatcher,
  DirectProviderCredentialPoolService,
  isPooledDirectProviderId,
  OpenCodeCredentialPoolService,
} from "../agents/credential-pool/index.js";
import type { ProviderAdapter, ProviderConfig, App, ToolDefinition, SttAdapter, TtsAdapter, VoiceConfig, Capability, IntegrationAdapter, SecurityConfig } from "@kilnai/core";
import { ActionEffectAuthorizer } from "@kilnai/core";
import type { AppGraphResponse } from "./dev-routes-types.js";
import { EventBus, McpClient, CostTracker } from "@kilnai/core";
import { ChannelRegistry } from "../channels/channel-registry.js";
import { WebChannel } from "../channels/web-channel.js";
import { TriggerRegistry } from "../trigger/trigger-registry.js";
import { resolveApps } from "./app-resolver.js";
import type { ResolvedApp } from "./app-resolver.js";
import { createGatewayApp } from "./gateway-routes.js";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { RuntimeMultimodalDelegationRoute } from "../session/runtime-session-orchestrator.types.js";
import { createDefaultRuntimeMultimodalTransformRoutes } from "../session/runtime-multimodal-transforms.js";
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
import { createTtsAdapter } from "./tts-factory.js";
import { createSignedArtifactMediaPublisher } from "./public-media-delivery.js";
import { createKnowledgePipeline, createSourceManager, createContactMemoryService } from "./knowledge-factory.js";
import type { KnowledgePipelineResult } from "./knowledge-factory.js";
import type { KnowledgeAdminRoutesConfig } from "./knowledge-admin-routes.js";
import type { ContactMemoryService } from "@kilnai/core";
import { extractText, textPart, textParts } from "@kilnai/core";
import { WebhookDedup } from "./webhook-dedup.js";
import { IntegrationRegistry } from "./integration-registry.js";
import { LocalCredentialResolver } from "./local-credential-resolver.js";
import { configureIntegrationDeps, getIntegrationDeps } from "./tenant-tool-factory.js";
import { SqliteEmailThreadStore } from "./sqlite-email-thread-store.js";
import { SqliteEnrichmentStore } from "../enrichment/sqlite-enrichment-store.js";
import { CompositeEventStore } from "../observability/composite-event-store.js";
import { PrometheusCollector } from "../observability/prometheus-collector.js";
import { createRuntimeToolResultSanitizer } from "./tool-result-sanitizer-factory.js";
import {
  mountGuiStaticAssets,
  resolveGuiDistPath,
} from "./gui-static-assets.js";

export type { LoadedApp, GatewayServerConfig } from "./gateway-routes.js";
export { createGatewayApp } from "./gateway-routes.js";
export type { DevRoutesConfig } from "./dev-routes.js";
export { createDevRoutes } from "./dev-routes.js";
export type { AppGraphResponse, AppGraphTeam, AppGraphAgent, AppGraphRouter, EvalExperimentSummary } from "./dev-routes-types.js";
export { createDevInspectorHtml } from "./dev-inspector.js";
export { ApprovalGateRegistry } from "./approval-registry.js";

type MetaVoiceChannelType = "whatsapp" | "instagram" | "messenger";

export function assertMetaVoicePublicMediaConfig(input: {
  readonly appName: string;
  readonly channelType: MetaVoiceChannelType;
  readonly voiceConfig?: VoiceConfig;
  readonly publicMediaBaseUrlEnv?: string;
  readonly publicMediaSigningSecretEnv?: string;
  readonly publicMediaBaseUrl?: string;
  readonly publicMediaSigningSecret?: string;
}): void {
  const surfacePolicy = input.voiceConfig?.policy?.surfaces?.[input.channelType];
  if (!input.voiceConfig || surfacePolicy?.enabled === false) {
    return;
  }
  const outputModes = surfacePolicy?.output?.modes ?? ["transcript-only"];
  if (!outputModes.includes("audio-response")) {
    return;
  }
  if (!input.publicMediaBaseUrlEnv || !input.publicMediaSigningSecretEnv) {
    throw new KilnError(
      "CONFIG_INVALID",
      `App '${input.appName}' enables voice audio-response for ${input.channelType} but the channel binding does not declare publicMediaBaseUrlEnv and publicMediaSigningSecretEnv.`,
    );
  }
  if (!input.publicMediaBaseUrl || !input.publicMediaSigningSecret) {
    throw new KilnError(
      "CONFIG_MISSING_ENV",
      `App '${input.appName}' enables voice audio-response for ${input.channelType} but public media env vars ${input.publicMediaBaseUrlEnv} and ${input.publicMediaSigningSecretEnv} are not both set.`,
    );
  }
  try {
    if (new URL(input.publicMediaBaseUrl).protocol !== "https:") {
      throw new Error("not-https");
    }
  } catch {
    throw new KilnError(
      "CONFIG_INVALID",
      `App '${input.appName}' public media base URL for ${input.channelType} must be a valid HTTPS origin.`,
    );
  }
}
export type { ApprovalTarget } from "./approval-registry.js";
export { DevOrchestrator } from "./dev-orchestrator.js";
export type { DevOrchestratorConfig, DevRunResult } from "./dev-orchestrator.js";
export { DevTokenStore } from "./dev-token-store.js";
export type { DevToken } from "./dev-token-store.js";

export interface ProviderSubsystemHealth {
  readonly status: "ok" | "degraded" | "error";
  readonly details: Record<string, string>;
}

type ProviderHealthStatus = "ok" | "degraded" | "error";

type BunHonoAdapters = typeof import("hono/bun");
type BunServeStatic = BunHonoAdapters["serveStatic"];
type BunWebSocketHandler = ReturnType<BunHonoAdapters["createBunWebSocket"]>["websocket"];

async function loadBunHonoAdapters(): Promise<BunHonoAdapters> {
  return import("hono/bun");
}

export interface StartGatewayOptions {
  readonly port?: number;
  readonly devMode?: boolean;
  readonly studioDistPath?: string;
  readonly guiDistPath?: string;
  /** Optional gateway security config (shared with HTTP middleware and runtime sanitizer wiring). */
  readonly securityConfig?: SecurityConfig;
  /** Integration adapters to register at gateway startup. */
  readonly integrations?: readonly IntegrationAdapter[];
  /** Env var name containing the master key for AES-256-GCM secret encryption. */
  readonly secretKeyEnv?: string;
  /** Runtime-managed auxiliary routes available for multimodal capability delegation, keyed by app name. */
  readonly multimodalDelegationRoutesByApp?: ReadonlyMap<string, readonly RuntimeMultimodalDelegationRoute[]>;
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
    approvePhase: (approvalId?: string) => approvalRegistry.approve(approvalId),
    rejectPhase: (reason: string, approvalId?: string) => approvalRegistry.reject(reason, approvalId),
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

export function evaluateProviderSubsystemHealth(
  resolvedApps: readonly Pick<ResolvedApp, "runtimeModeConfig">[],
  credentialPoolObservability?: CredentialPoolObservabilityRegistry,
): ProviderSubsystemHealth {
  const providerStatuses: Record<string, ProviderHealthStatus> = {};
  const poolSnapshots = credentialPoolObservability?.snapshot() ?? [];

  for (const resolved of resolvedApps) {
    if (resolved.runtimeModeConfig?.runtime !== "provider-adapter") continue;

    const providerName = resolved.runtimeModeConfig.provider.name;
    const apiKeyEnv = resolved.runtimeModeConfig.provider.apiKeyEnv;
    const status = apiKeyEnv
      ? (process.env[apiKeyEnv] ? "ok" : "error")
      : credentialPoolProviderStatus(providerName, poolSnapshots);
    providerStatuses[providerName] = mergeProviderStatus(
      providerStatuses[providerName],
      status,
    );
  }

  const statuses = Object.values(providerStatuses);
  return {
    status: statuses.includes("error")
      ? "error"
      : statuses.includes("degraded")
        ? "degraded"
        : "ok",
    details: providerStatuses,
  };
}

function credentialPoolProviderStatus(
  providerName: string,
  poolSnapshots: readonly ReturnType<CredentialPoolObservabilityRegistry["snapshot"]>[number][],
): ProviderHealthStatus {
  const matchingPools = poolSnapshots.filter((snapshot) => snapshot.provider === providerName);
  const totalCredentials = matchingPools.reduce(
    (total, snapshot) => total + snapshot.credentialPool.metrics.totalCredentials,
    0,
  );
  const availableCredentials = matchingPools.reduce(
    (total, snapshot) => total + snapshot.credentialPool.metrics.availableCount,
    0,
  );

  if (availableCredentials > 0) return "ok";
  if (totalCredentials > 0) return "degraded";
  return "error";
}

function mergeProviderStatus(
  current: ProviderHealthStatus | undefined,
  next: ProviderHealthStatus,
): ProviderHealthStatus {
  if (!current) return next;
  return providerHealthSeverity(next) > providerHealthSeverity(current) ? next : current;
}

function providerHealthSeverity(status: ProviderHealthStatus): number {
  if (status === "error") return 2;
  if (status === "degraded") return 1;
  return 0;
}

export interface DiscoverMcpCapabilitiesInput {
  readonly client: Pick<McpClient, "discoverTools">;
  readonly app: App;
  readonly appName: string;
  readonly serverName: string;
  readonly attempts?: number;
  readonly delayMs?: number;
}

export async function discoverMcpCapabilitiesWithConfiguredToolRetry(
  input: DiscoverMcpCapabilitiesInput,
): Promise<readonly Capability[]> {
  const attempts = Math.max(1, input.attempts ?? 3);
  const delayMs = Math.max(0, input.delayMs ?? 250);
  const configuredToolNames = collectConfiguredToolNames(input.app);
  let capabilities: readonly Capability[] = [];
  let missingConfiguredTools: readonly string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    capabilities = await input.client.discoverTools();
    missingConfiguredTools = missingTools(configuredToolNames, capabilities);
    if (missingConfiguredTools.length === 0 || attempt === attempts) {
      break;
    }
    await delay(delayMs);
  }

  if (missingConfiguredTools.length > 0) {
    console.warn(
      `  ${input.appName}: MCP server "${input.serverName}" did not expose configured tools: ${missingConfiguredTools.join(", ")}`,
    );
  }

  return capabilities;
}

function collectConfiguredToolNames(app: App): readonly string[] {
  const names = new Set<string>();
  for (const team of Object.values(app.teams)) {
    for (const agent of Object.values(team.agents)) {
      for (const tool of agent.tools ?? []) {
        if (tool !== "*") names.add(tool);
      }
    }
  }
  return [...names].sort();
}

function missingTools(
  configuredToolNames: readonly string[],
  capabilities: readonly Capability[],
): readonly string[] {
  if (configuredToolNames.length === 0) return [];
  const discovered = new Set(capabilities.map((capability) => capability.name));
  return configuredToolNames.filter((name) => !discovered.has(name));
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
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

class ProviderScorerLlmBridge {
  constructor(
    private readonly adapter: ProviderAdapter,
    private readonly model: string,
  ) {}

  async evaluate(prompt: string): Promise<string> {
    const response = await this.adapter.createMessage({
      system: `You are an evaluation judge running as model ${this.model}.`,
      messages: [{ role: "user", parts: [textPart(prompt)] }],
      maxTokens: 512,
    });
    return extractText(response.parts);
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

  // Build startup config validation input from provider-adapter apps
  const providerAdapterApps: { provider: string; apiKeyEnv: string }[] = [];
  let whatsappConfig: { verifyTokenEnv: string; accessTokenEnv: string } | undefined;
  let tenantAdminConfig: { adminTokenEnv: string } | undefined;

  for (const resolved of resolvedApps) {
    if (resolved.runtimeModeConfig?.runtime === "provider-adapter") {
      const providerName = resolved.runtimeModeConfig.provider.name;
      const apiKeyEnv = resolved.runtimeModeConfig.provider.apiKeyEnv;
      if (apiKeyEnv) {
        providerAdapterApps.push({ provider: providerName, apiKeyEnv });
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
    providerAdapterApps: providerAdapterApps.length > 0 ? providerAdapterApps : undefined,
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
  const credentialWatcher = new CredentialWatcher({
    rootDir: join(homedir(), ".kiln", "auth"),
  });
  await credentialWatcher.start();
  const credentialPoolObservability = new CredentialPoolObservabilityRegistry();
  const prometheusCollector = new PrometheusCollector();
  const compositeStore = new CompositeEventStore(
    otelExporter ? [otelExporter, prometheusCollector] : [prometheusCollector],
  );
  const gatewayEventBus = new EventBus(100, compositeStore);
  const costTracker = new CostTracker();
  const webhookDedup = new WebhookDedup();

  // Secret store: AES-256-GCM encryption for tenant credentials (channel tokens, integration keys)
  const secretKeyEnv = options?.secretKeyEnv;
  const secretMasterKey = secretKeyEnv ? process.env[secretKeyEnv] : undefined;
  const secretStore = secretMasterKey
    ? new AesSecretStore(join(dirname(configPath), ".kiln", "secrets.json"), secretMasterKey)
    : undefined;

  // Integration runtime: register adapters and configure credential resolution
  if (options?.integrations && options.integrations.length > 0) {
    const registry = new IntegrationRegistry();
    for (const adapter of options.integrations) {
      registry.register(adapter);
    }
    if (secretStore) {
      configureIntegrationDeps({ registry, credentialResolver: new LocalCredentialResolver(secretStore) });
      const providers = options.integrations.map((a) => a.provider).join(", ");
      console.log(`Integrations: ${options.integrations.length} adapter(s) registered (${providers})`);
    } else {
      console.warn("Integrations: adapters registered but no secretKeyEnv configured — credential resolution disabled");
    }
  }

  const loadedApps = resolvedApps.map((resolved: ResolvedApp) => {
    const hasWebChannel = resolved.binding.channels.some((ch) => ch.type === "web");
    return {
      name: resolved.name,
      app: resolved.app,
      binding: resolved.binding,
      registry: new ChannelRegistry(),
      providerAdapterRuntime: undefined as undefined | import("./provider-adapter-routes.js").ProviderAdapterAppRuntime,
      tenantRuntime: undefined as undefined | import("./tenant-routes.js").TenantAppRuntime,
      whatsappWebhookConfig: undefined as undefined | import("./whatsapp-webhook-routes.js").WhatsAppWebhookConfig,
      instagramWebhookConfig: undefined as undefined | import("./instagram-webhook-routes.js").InstagramWebhookConfig,
      messengerWebhookConfig: undefined as undefined | import("./messenger-webhook-routes.js").MessengerWebhookConfig,
      emailWebhookConfig: undefined as undefined | import("./email-webhook-routes.js").EmailWebhookConfig,
      tenantAdminConfig: undefined as undefined | import("./tenant-admin-routes.js").TenantAdminRoutesConfig,
      webChannel: hasWebChannel ? new WebChannel() : undefined,
      eventEmitter: undefined as undefined | ConversationEventEmitter,
      sttAdapter: undefined as undefined | SttAdapter,
      ttsAdapter: undefined as undefined | TtsAdapter,
      artifactStore: new MemoryArtifactResourceStore(),
      publicMediaSigningSecret: undefined as undefined | string,
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

  // Initialize provider-adapter runtimes and delegation targets in a single pass
  const sessionRegistry = new SessionRegistry();
  const delegationTargets = new Map<string, DelegationTarget>();

  for (const loaded of loadedApps) {
    const resolved = resolvedApps.find((r) => r.name === loaded.name);
    if (!resolved?.runtimeModeConfig || resolved.runtimeModeConfig.runtime !== "provider-adapter") continue;

    const provider = await createProviderFromConfig(
      resolved.runtimeModeConfig.provider,
      credentialWatcher,
      credentialPoolObservability,
    );
    const systemPrompt = buildSystemPromptFromApp(resolved.app);

    // Discover MCP tools if configured
    const mcpClients: McpClient[] = [];
    const tools: ToolDefinition[] = [];
    const capabilityMap = new Map<string, Capability>();

    if (resolved.app.mcp?.servers) {
      for (const serverConfig of resolved.app.mcp.servers) {
        try {
          const client = new McpClient(serverConfig);
          const capabilities = await discoverMcpCapabilitiesWithConfiguredToolRetry({
            client,
            app: resolved.app,
            appName: loaded.name,
            serverName: serverConfig.name,
          });
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

    if (resolved.app.voice?.tts) {
      try {
        loaded.ttsAdapter = createTtsAdapter(resolved.app.voice.tts);
        console.log(`  ${loaded.name}: TTS adapter "${resolved.app.voice.tts.provider}" initialized`);
      } catch (err) {
        console.warn(`  ${loaded.name}: TTS initialization failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Initialize knowledge pipeline if knowledge config is present
    if (resolved.app.knowledge) {
      try {
        loaded.knowledgePipeline = await createKnowledgePipeline(resolved.app.knowledge);
        console.log(`  ${loaded.name}: knowledge pipeline initialized (mode: ${resolved.app.knowledge.mode ?? "auto"})`);

        // Initialize source manager for knowledge admin
        const storageDir = join(resolved.memoryBasePath, "knowledge-sources");
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
          const failedSources = results.filter((r) => r.status === "failed");
          if (indexed > 0 || failedSources.length > 0) {
            console.log(`  ${loaded.name}: knowledge sources ingested (${indexed} indexed, ${failedSources.length} failed)`);
          }
          for (const source of failedSources) {
            const evt: import("@kilnai/core").KnowledgeSourceFailedEvent = {
              type: "knowledge_source_failed",
              timestamp: new Date(),
              sessionId: "",
              sourceId: source.sourceId,
              sourceName: source.name,
              sourceType: source.type,
              error: source.error ?? "Unknown error",
              appName: loaded.name,
            };
            gatewayEventBus.emit(evt);
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
    const toolAuthorizer = capabilityMap.size > 0 ? new ActionEffectAuthorizer() : undefined;
    const safetyPipeline = safetyPipelines.get(loaded.name);
    const toolResultSanitizer = createRuntimeToolResultSanitizer({
      safetyPipeline,
      eventBus: gatewayEventBus,
      promptInjectionConfig: options?.securityConfig?.promptInjection,
    });
    const dangerousCommandDetector = new DeterministicDangerousCommandDetector();

    const multimodalDelegationRoutes = options?.multimodalDelegationRoutesByApp?.get(loaded.name);
    const multimodalTransformRoutes = createDefaultRuntimeMultimodalTransformRoutes({
      artifactStore: loaded.artifactStore,
    });
    const orchestrator = new RuntimeSessionOrchestrator({
      provider,
      model: resolved.runtimeModeConfig.provider.model,
      tools: tools.length > 0 ? tools : undefined,
      mcpClients: mcpClients.length > 0 ? mcpClients : undefined,
      eventBus: gatewayEventBus,
      capabilityMap: capabilityMap.size > 0 ? capabilityMap : undefined,
      toolAuthorizer,
      toolResultSanitizer,
      dangerousCommandDetector,
      ...(multimodalDelegationRoutes ? { multimodalDelegationRoutes } : {}),
      multimodalTransformRoutes,
    });

    // Build grounding deps (shared by all routes for this app)
    const groundingRail = new GroundingRail();
    const modelRegistry = new ModelCapabilityRegistry();
    const groundingProviderPool = new Map<string, ProviderAdapter>([[provider.name, provider]]);
    const groundingDeps = {
      rail: groundingRail,
      providerPool: groundingProviderPool as ReadonlyMap<string, ProviderAdapter>,
      modelRegistry,
      eventBus: gatewayEventBus,
    };

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
      const tenantRegistry = new TenantRegistry(tenantStorageDir, secretStore);
      tenantRegistry.load();

      loaded.tenantRuntime = {
        appName: loaded.name,
        orchestrator,
        sessionRegistry,
        tenantRegistry,
        artifactStore: loaded.artifactStore,
        voiceConfig: resolved.app.voice,
        ttsAdapter: loaded.ttsAdapter,
        billing: resolved.runtimeModeConfig.billing,
        apiKey: resolvedApiKey,
        groundingDeps,
      };

      const createOutboundMediaPublisher = (channel: (typeof loaded.binding.channels)[number] | undefined) => {
        const publicMediaBaseUrlEnv = channel?.publicMediaBaseUrlEnv ?? "";
        const publicMediaSigningSecretEnv = channel?.publicMediaSigningSecretEnv ?? "";
        const publicMediaBaseUrl = publicMediaBaseUrlEnv ? process.env[publicMediaBaseUrlEnv] : undefined;
        const publicMediaSigningSecret = publicMediaSigningSecretEnv ? process.env[publicMediaSigningSecretEnv] : undefined;
        if (channel?.type === "whatsapp" || channel?.type === "instagram" || channel?.type === "messenger") {
          assertMetaVoicePublicMediaConfig({
            appName: loaded.name,
            channelType: channel.type,
            voiceConfig: resolved.app.voice,
            publicMediaBaseUrlEnv,
            publicMediaSigningSecretEnv,
            publicMediaBaseUrl,
            publicMediaSigningSecret,
          });
        }
        if (publicMediaSigningSecret) {
          if (loaded.publicMediaSigningSecret && loaded.publicMediaSigningSecret !== publicMediaSigningSecret) {
            throw new KilnError(
              "CONFIG_INVALID",
              `App '${loaded.name}' has conflicting public media signing secrets across channel bindings.`,
            );
          }
          loaded.publicMediaSigningSecret = publicMediaSigningSecret;
        }
        if (!publicMediaBaseUrl || !publicMediaSigningSecret) {
          return undefined;
        }
        return createSignedArtifactMediaPublisher({
          appName: loaded.name,
          publicBaseUrl: publicMediaBaseUrl,
          signingSecret: publicMediaSigningSecret,
        });
      };

      // WhatsApp webhook: find whatsapp channel with verifyTokenEnv
      const whatsappChannel = loaded.binding.channels.find((ch) => ch.type === "whatsapp");
      if (whatsappChannel) {
        const verifyTokenEnv = whatsappChannel.verifyTokenEnv ?? "";
        const appSecretEnv = whatsappChannel.appSecretEnv ?? "";
        const outboundMediaPublisher = createOutboundMediaPublisher(whatsappChannel);
        loaded.whatsappWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: verifyTokenEnv ? process.env[verifyTokenEnv] ?? "" : "",
          appSecret: appSecretEnv ? process.env[appSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          eventEmitter,
          eventBus: gatewayEventBus,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          artifactStore: loaded.artifactStore,
          voiceConfig: resolved.app.voice,
          ttsAdapter: loaded.ttsAdapter,
          ...(outboundMediaPublisher ? { outboundMediaPublisher } : {}),
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
        const outboundMediaPublisher = createOutboundMediaPublisher(instagramChannel);
        loaded.instagramWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: igVerifyTokenEnv ? process.env[igVerifyTokenEnv] ?? "" : "",
          appSecret: igAppSecretEnv ? process.env[igAppSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          eventEmitter,
          eventBus: gatewayEventBus,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          artifactStore: loaded.artifactStore,
          voiceConfig: resolved.app.voice,
          ttsAdapter: loaded.ttsAdapter,
          ...(outboundMediaPublisher ? { outboundMediaPublisher } : {}),
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
        const outboundMediaPublisher = createOutboundMediaPublisher(messengerChannel);
        loaded.messengerWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          verifyToken: msgVerifyTokenEnv ? process.env[msgVerifyTokenEnv] ?? "" : "",
          appSecret: msgAppSecretEnv ? process.env[msgAppSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          eventEmitter,
          eventBus: gatewayEventBus,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          artifactStore: loaded.artifactStore,
          voiceConfig: resolved.app.voice,
          ttsAdapter: loaded.ttsAdapter,
          ...(outboundMediaPublisher ? { outboundMediaPublisher } : {}),
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
          billing: resolved.runtimeModeConfig.billing,
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
      // Standard provider-adapter runtime (non-tenant)
      loaded.providerAdapterRuntime = {
        appName: loaded.name,
        orchestrator,
        sessionRegistry,
        artifactStore: loaded.artifactStore,
        voiceConfig: resolved.app.voice,
        ttsAdapter: loaded.ttsAdapter,
        billing: resolved.runtimeModeConfig.billing,
        systemPrompt,
        apiKey: resolvedApiKey,
        knowledgePipeline: loaded.knowledgePipeline?.pipeline,
        knowledgeMode: resolved.app.knowledge?.mode,
        groundingDeps,
      };
    }
  }

  // Auth warnings: notify when channels lack auth configuration
  for (const loaded of loadedApps) {
    for (const channel of loaded.binding.channels) {
      if (channel.type === "api" && channel.path && !channel.apiKeyEnv && !gatewayConfig.auth) {
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
  healthRegistry.register("providers", () =>
    evaluateProviderSubsystemHealth(resolvedApps, credentialPoolObservability),
  );

  // Register budget health checker
  healthRegistry.register("budget", () => {
    // Check if any app has billing configured
    const hasBilling = loadedApps.some((loaded) => {
      const resolved = resolvedApps.find((r) => r.name === loaded.name);
      return Boolean(resolved?.runtimeModeConfig?.billing);
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
  const guiDistPath = resolveGuiDistPath(options?.guiDistPath);

  // Initialize dev-mode swarm coordination store.
  let swarmMemoryRepository: SqliteMemoryRepository | undefined;
  if (options?.devMode) {
    const firstResolved = resolvedApps[0];
    if (firstResolved) {
      const devMemoryDir = join(firstResolved.memoryBasePath, "dev");
      mkdirSync(devMemoryDir, { recursive: true });
      swarmMemoryRepository = new SqliteMemoryRepository({
        dbPath: join(devMemoryDir, "swarm.db"),
      });
    }
  }

  const tokenStore = options?.devMode ? new DevTokenStore() : undefined;

  // JWT verifier: built once at startup when auth block is present in gateway.yaml
  let jwtVerifier: import("./jwt-verifier.js").JwtVerifyFn | undefined;
  if (gatewayConfig.auth) {
    try {
      const { buildJwtVerifier } = await import("./jwt-verifier.js");
      jwtVerifier = await buildJwtVerifier(gatewayConfig.auth);
      const mode =
        gatewayConfig.auth.algorithm === "RS256"
          ? `RS256 JWKS (${gatewayConfig.auth.jwksUri})`
          : `HS256 (${gatewayConfig.auth.secretEnv})`;
      console.log(`Auth: JWT verification enabled -- ${mode}`);
    } catch (err) {
      throw new KilnError("CONFIG_INVALID", `Failed to initialize JWT verifier: ${err instanceof Error ? err.message : String(err)}`, {
        context: { algorithm: gatewayConfig.auth.algorithm },
        retryable: false,
      });
    }
  }

  const { createBunWebSocket, serveStatic } = await loadBunHonoAdapters();
  const { upgradeWebSocket, websocket: bunWebsocket } = createBunWebSocket();

  const honoApp = createGatewayApp({
    port,
    apps: loadedApps,
    mcp: gatewayConfig.mcp,
    delegationRegistry,
    eventBus: gatewayEventBus,
    healthRegistry,
    credentialPoolObservability,
    startTime,
    triggerRegistry,
    safetyPipelines,
    securityConfig: options?.securityConfig,
    upgradeWebSocket,
    validateToken: tokenStore ? (token) => tokenStore.validate(token) : undefined,
    jwtVerifier,
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
    mountStudio(honoApp, studioDistPath, serveStatic);
  }
  mountGuiStaticAssets(honoApp, guiDistPath);
  honoApp.get("/gui", (c) => c.redirect("/gui/"));

  // Prometheus metrics endpoint (unauthenticated, before per-app routes)
  honoApp.get("/metrics", async (c) => {
    const registry = await prometheusCollector.getRegistry();
    if (!registry) {
      return c.text("Prometheus metrics not available (prom-client not installed)", 503);
    }
    const metrics = await registry.metrics();
    return c.text(metrics, 200, { "Content-Type": registry.contentType });
  });

  // MCP server: expose gateway capabilities as MCP tools for external agents
  let mcpServerInstance: { close(): Promise<void> } | undefined;
  if (gatewayConfig.mcp?.enabled) {
    try {
      const { GatewayMcpServer } = await import("../mcp/gateway-mcp-server.js");
      const mcpPath = gatewayConfig.mcp.path ?? "/mcp";
      const mcpApiKey =
        gatewayConfig.mcp.auth?.type === "api-key" && gatewayConfig.mcp.auth.keyEnv
          ? process.env[gatewayConfig.mcp.auth.keyEnv]
          : undefined;
      const evalProvider = gatewayConfig.mcp.eval
        ? await createProviderFromConfig({
            name: gatewayConfig.mcp.eval.provider,
            model: gatewayConfig.mcp.eval.model,
            apiKeyEnv: gatewayConfig.mcp.eval.apiKeyEnv,
          })
        : undefined;
      const evalBridge = evalProvider && gatewayConfig.mcp.eval
        ? new ProviderScorerLlmBridge(evalProvider, gatewayConfig.mcp.eval.model ?? "claude-haiku-4-5-20251001")
        : undefined;
      const { SwarmStore } = await import("../mcp/swarm-store.js");
      const swarmStore = swarmMemoryRepository
        ? new SwarmStore({ repository: swarmMemoryRepository, eventBus: gatewayEventBus })
        : undefined;

      const mcpServer = new GatewayMcpServer({
        deps: {
          swarmJoin: swarmStore
            ? (swarmId: string, agentId: string, description?: string) =>
                swarmStore.join(swarmId, agentId, description)
            : undefined,
          swarmLeave: swarmStore
            ? (swarmId: string, agentId: string) =>
                swarmStore.leave(swarmId, agentId)
            : undefined,
          swarmStatus: swarmStore
            ? (swarmId: string) =>
                swarmStore.status(swarmId)
            : undefined,
          swarmBroadcast: swarmStore
            ? (swarmId: string, agentId: string, message: string) =>
                swarmStore.broadcast(swarmId, agentId, message)
            : undefined,
          swarmClaim: swarmStore
            ? (swarmId: string, agentId: string, resourceId: string) =>
                swarmStore.claim(swarmId, agentId, resourceId)
            : undefined,
          swarmRelease: swarmStore
            ? (swarmId: string, agentId: string, resourceId: string) =>
                swarmStore.release(swarmId, agentId, resourceId)
            : undefined,
          searchKnowledge: async (appName: string, query: string, limit?: number) => {
            const loaded = loadedApps.find((a) => a.name === appName);
            if (!loaded?.knowledgePipeline) return { results: [] };
            const results = await loaded.knowledgePipeline.pipeline.retrieve(query, { topK: limit });
            return {
              results: results.map((r) => ({
                content: r.content,
                score: r.score,
                source: r.metadata?.source as string | undefined,
              })),
            };
          },
          listKnowledgeSources: (appName: string) => {
            const loaded = loadedApps.find((a) => a.name === appName);
            if (!loaded?.knowledgeAdminConfig) return { sources: [] };
            const sources = loaded.knowledgeAdminConfig.sourceManager.list(appName);
            return { sources: sources.map((s) => ({ ...s })) };
          },
          getCostSummary: () => costTracker.summary,
          getSafetyMetrics: () => {
            if (safetyPipelines.size === 0) return { enabled: false };
            const apps: Record<string, unknown> = {};
            for (const [appName, pipeline] of safetyPipelines) apps[appName] = pipeline.metrics;
            return { enabled: true, apps };
          },

          // Integration Runtime (Phase 4)
          listIntegrations: () => {
            const deps = getIntegrationDeps();
            if (!deps) return [];
            return deps.registry.all().map((a) => ({
              provider: a.provider,
              version: a.version,
              operations: a.operations.map((op) => ({ name: op.name, description: op.description })),
            }));
          },
          executeIntegration: async (provider: string, operation: string, tenantId: string, input: Record<string, unknown>) => {
            const deps = getIntegrationDeps();
            if (!deps) throw new KilnError("CONFIG_INVALID", "Integration runtime not configured");
            const adapter = deps.registry.get(provider);
            if (!adapter) throw new KilnError("CONFIG_INVALID", `Integration provider "${provider}" not registered`);
            const { IntegrationExecutor } = await import("./integration-executor.js");
            const executor = new IntegrationExecutor(adapter, deps.credentialResolver, tenantId, provider);
            return executor.execute(operation, input);
          },

          // Routing diagnostics
          testRouting: async (tenantId: string, message: string) => {
            for (const loaded of loadedApps) {
              const tr = loaded.tenantRuntime;
              if (!tr) continue;
              const tenant = tr.tenantRegistry.get(tenantId);
              if (!tenant || !tenant.routing || !tenant.agents?.length) continue;

              const { DefaultTenantRouter } = await import("../tenant/tenant-router.js");
              const userParts = textParts(message);
              const text = extractText(userParts);

              const allRules: { pattern: string; agent: string; matched: boolean }[] = [];
              for (const rule of tenant.routing.rules ?? []) {
                try {
                  allRules.push({ pattern: rule.match, agent: rule.agent, matched: new RegExp(rule.match, "i").test(text) });
                } catch {
                  allRules.push({ pattern: rule.match, agent: rule.agent, matched: false });
                }
              }

              const router = new DefaultTenantRouter(tenant.routing);
              const result = router.route(userParts);
              const agent = tenant.agents.find((a) => a.id === result.agentId);

              return {
                agentId: result.agentId,
                agentName: agent?.name ?? result.agentId,
                tier: result.tier,
                matchedPattern: result.matchedPattern ?? null,
                confidence: result.confidence ?? null,
                allRules,
              };
            }
            throw new KilnError("CONFIG_INVALID", `Tenant "${tenantId}" not found or has no routing configured`);
          },

          // Eval scoring (rule-based scorers only — no LLM dependency)
          evalScore: async (input: string, output: string, expected?: string, scorerNames?: readonly string[]) => {
            const { ExactMatchScorer, JsonValidityScorer, EffortScorer, RoutingAccuracyScorer, ToolCallingAccuracyScorer } = await import("@kilnai/core");
            const allScorers = [
              new ExactMatchScorer(),
              new JsonValidityScorer(),
              new EffortScorer(),
              new RoutingAccuracyScorer(),
              new ToolCallingAccuracyScorer(),
            ];
            const scorers = scorerNames?.length
              ? allScorers.filter((s) => scorerNames.includes(s.name))
              : allScorers;
            const results = await Promise.all(scorers.map((s) => s.score({ input, output, expected })));
            return results;
          },
          evalScoreLlm: gatewayConfig.mcp?.eval
            ? async (
                input: string,
                output: string,
                expected?: string,
                context?: readonly string[],
                scorerNames?: readonly string[],
                scorerOptions?: Record<string, unknown>,
              ) => {
                if (!evalBridge) return [];

                const {
                  FaithfulnessScorer,
                  RelevanceScorer,
                  CoherenceScorer,
                  HallucinationScorer,
                  ToxicityScorer,
                  PolicyAdherenceScorer,
                  ContextRelevanceScorer,
                  ToolTrajectoryScorer,
                  MultiTurnConsistencyScorer,
                  SafetyPreservationScorer,
                  HandoffQualityScorer,
                  CustomPromptScorer,
                } = await import("@kilnai/core");

                type EvalLikeScorer = {
                  readonly name: string;
                  score(input: {
                    input: string;
                    output: string;
                    expected?: string;
                    context?: readonly string[];
                    metadata?: Record<string, unknown>;
                  }): Promise<{ name: string; score: number; reasoning?: string }>;
                };

                const isRecord = (v: unknown): v is Record<string, unknown> =>
                  typeof v === "object" && v !== null && !Array.isArray(v);
                const options = isRecord(scorerOptions) ? scorerOptions : {};
                const policies =
                  Array.isArray(options["policies"]) && (options["policies"] as unknown[]).every((p) => typeof p === "string")
                    ? (options["policies"] as string[])
                    : [];
                const customPrompt =
                  typeof options["prompt"] === "string" && options["prompt"].trim()
                    ? options["prompt"]
                    : `Evaluate this output quality.

Input: {{input}}
Output: {{output}}
Expected: {{expected}}
Context: {{context}}

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

                const metadata: Record<string, unknown> = {};
                if (isRecord(options["metadata"])) Object.assign(metadata, options["metadata"]);
                for (const key of ["toolCalls", "conversationHistory", "handoffHistory", "attackType"]) {
                  if (key in options) metadata[key] = options[key];
                }

                const allScorers: EvalLikeScorer[] = [
                  new FaithfulnessScorer(evalBridge),
                  new RelevanceScorer(evalBridge),
                  new CoherenceScorer(evalBridge),
                  new HallucinationScorer(evalBridge),
                  new ToxicityScorer(evalBridge),
                  new PolicyAdherenceScorer(evalBridge, policies),
                  new ContextRelevanceScorer(evalBridge),
                  new ToolTrajectoryScorer(evalBridge),
                  new MultiTurnConsistencyScorer(evalBridge),
                  new SafetyPreservationScorer(evalBridge),
                  new HandoffQualityScorer(evalBridge),
                  new CustomPromptScorer("custom-prompt", customPrompt, evalBridge),
                ];

                const scorers = scorerNames?.length
                  ? allScorers.filter((s) => scorerNames.includes(s.name))
                  : allScorers;

                return Promise.all(scorers.map((s) => s.score({ input, output, expected, context, metadata })));
              }
            : undefined,

          // Enrichment access
          getEnrichment: async (sessionId: string) => {
            for (const loaded of loadedApps) {
              const store = loaded.enrichmentAdminConfig?.enrichmentStore;
              if (!store) continue;
              const enrichment = await store.get(sessionId);
              if (enrichment) return enrichment as unknown as Record<string, unknown>;
            }
            return undefined;
          },
          listEnrichments: async (tenantId: string, limit?: number, cursor?: string) => {
            for (const loaded of loadedApps) {
              const store = loaded.enrichmentAdminConfig?.enrichmentStore;
              if (!store) continue;
              const result = await store.listByTenant(tenantId, limit ?? 20, cursor);
              return {
                enrichments: result.enrichments as unknown as readonly Record<string, unknown>[],
                nextCursor: result.nextCursor,
              };
            }
            return { enrichments: [] };
          },

          // Budget enforcement
          checkBudget: async (tenantId: string, appName: string) => {
            const loaded = loadedApps.find((a) => a.name === appName);
            const billing = loaded?.tenantRuntime?.billing;
            if (!billing) return { allowed: true, remaining: -1, unit: "unknown" };
            const { checkBudget: check } = await import("./budget-middleware.js");
            return check(billing, tenantId);
          },
          reportUsage: async (tenantId: string, appName: string, messages: number, tokens: number, model: string) => {
            const loaded = loadedApps.find((a) => a.name === appName);
            const billing = loaded?.tenantRuntime?.billing;
            if (!billing) return;
            const { reportUsage: report } = await import("./budget-middleware.js");
            await report(billing, { tenantId, messages, tokens, model });
          },
        },
        apiKey: mcpApiKey,
      });

      await mcpServer.initialize();
      mcpServerInstance = mcpServer;

      honoApp.all(`${mcpPath}`, async (c) => mcpServer.handleRequest(c.req.raw));
      honoApp.all(`${mcpPath}/*`, async (c) => mcpServer.handleRequest(c.req.raw));

      console.log(`MCP server: listening on ${mcpPath}${mcpApiKey ? " (api-key auth)" : " (no auth)"}`);
    } catch (err) {
      console.warn(`MCP server: failed to initialize -- ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  triggerRegistry.start();

  const appNames = loadedApps.map((a) => a.name).join(", ");
  console.log(`Gateway started on port ${port} with ${loadedApps.length} apps: ${appNames}`);
  console.log(`GUI: http://localhost:${port}/gui/`);
  if (options?.devMode) {
    console.log(`Studio: http://localhost:${port}/${studioDistPath ? "studio" : "dev"}/`);
  }

  await serveAndWait(honoApp, port, () => {
    triggerRegistry.stop();
    credentialWatcher.stop();
    webhookDedup.close();
    swarmMemoryRepository?.close();
    mcpServerInstance?.close().catch(() => {});
    for (const loaded of loadedApps) {
      loaded.knowledgePipeline?.close().catch(() => {});
    }
  }, bunWebsocket);
}

/** Create a ProviderAdapter from a provider-adapter runtime config. */
async function createProviderFromConfig(
  config: ProviderConfig,
  credentialWatcher?: CredentialWatcher,
  credentialPoolObservability?: CredentialPoolObservabilityRegistry,
): Promise<ProviderAdapter> {
  const model = config.model;
  const requireModel = (): string => {
    const selectedModel = model?.trim();
    if (!selectedModel) {
      throw new KilnError("CONFIG_INVALID", `Provider ${config.name} requires a model`, {
        context: { provider: config.name },
      });
    }
    return selectedModel;
  };

  switch (config.name) {
    case "codex-oauth":
      return await new CodexOAuthCredentialPoolService({
        watcher: credentialWatcher,
        observability: credentialPoolObservability,
      }).createPooledAdapter({ defaultModel: requireModel() });
    case "opencode-go":
    case "opencode-zen":
      return await new OpenCodeCredentialPoolService({
        watcher: credentialWatcher,
        observability: credentialPoolObservability,
      }).createPooledAdapter({
        tier: config.name === "opencode-zen" ? "zen" : "go",
        defaultModel: requireModel(),
      });
    case "anthropic":
    case "openai":
    case "deepseek":
    case "openrouter":
    case "ollama":
    case "lmstudio":
      if (!isPooledDirectProviderId(config.name)) {
        throw new KilnError("CONFIG_INVALID", `Unsupported pooled provider: ${config.name}`);
      }
      return await new DirectProviderCredentialPoolService({
        watcher: credentialWatcher,
        observability: credentialPoolObservability,
      }).createPooledAdapter({
        provider: config.name,
        defaultModel: model,
        openRouterAppUrl: process.env.OPENROUTER_APP_URL,
        openRouterAppName: process.env.OPENROUTER_APP_NAME,
      });
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

function mountStudio(app: Hono, distPath: string, serveStatic: BunServeStatic): void {
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

async function serveAndWait(app: Hono, port: number, onShutdown?: () => void, websocketHandler?: BunWebSocketHandler): Promise<void> {
  const websocket = websocketHandler ?? (await loadBunHonoAdapters()).createBunWebSocket().websocket;

  let server: ReturnType<typeof Bun.serve>;
  try {
    // idleTimeout: 255s is the uWebSockets max (uint8). Prevents Bun from killing SSE streams.
    server = Bun.serve({ port, fetch: app.fetch, websocket, idleTimeout: 255 });
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
    const { serveStatic } = await loadBunHonoAdapters();
    mountStudio(honoApp, studioDistPath, serveStatic);
  }

  console.log(`Dev server started on port ${port}`);
  console.log(`Studio: http://localhost:${port}/${studioDistPath ? "studio" : "dev"}/`);

  await serveAndWait(honoApp, port);
}
