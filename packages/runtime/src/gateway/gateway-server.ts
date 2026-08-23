// Gateway: GatewayServer -- persistent Bun/Hono process hosting multiple Apps

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { Hono } from "hono";
import type { AppGatewayRuntimeIdentity } from "@kilnai/gateway-contracts";
import {
  KilnError,
  OTelExporter,
  SafetyPipeline,
  SqliteMemoryRepository,
  AesSecretStore,
  MemoryArtifactResourceStore,
  DeterministicDangerousCommandDetector,
  KilnMcpClient,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  CredentialPoolObservabilityRegistry,
  CredentialWatcher,
  DirectProviderCredentialPoolService,
  isPooledDirectProviderId,
  OpenCodeCredentialPoolService,
} from "../agents/credential-pool/index.js";
import type { ProviderAdapter, ProviderConfig, App, ToolDefinition, SttAdapter, TtsAdapter, VoiceConfig, Capability, IntegrationAdapter, SecurityConfig, ResolvedMcpServer, ExecutionCatalog } from "@kilnai/core";
import { ActionEffectAuthorizer } from "@kilnai/core";
import { EventBus, CostTracker } from "@kilnai/core";
import { WebChannel } from "../channels/web-channel.js";
import { TriggerRegistry } from "../trigger/trigger-registry.js";
import { resolveApps } from "./app-resolver.js";
import type { ResolvedApp } from "./app-resolver.js";
import { readGatewayConfigurationSource } from "./gateway-configuration-source.js";
import {
  createGatewayDrainController,
  handleAppGatewayControlRequest,
} from "./app-gateway-control.js";
import { createGatewayApp } from "./gateway-routes.js";
import { startModelGatewayListener } from "../model-gateway/model-gateway-listener.js";
import type { ModelGatewayListenerFetch } from "../model-gateway/model-gateway-listener.js";
import type {
  ModelGatewayExecutionCandidatePort,
  ModelGatewayExecutionRoutingPort,
} from "../model-gateway/model-gateway-ingress.js";
import type { ExecutionAccountCapacityAuthority } from "../execution-kernel/execution-account-capacity-authority.js";
import type { RuntimeModelRoundActionClaimStore } from "../execution-kernel/runtime-model-round-action-claim.js";
import type { RuntimeToolActionClaimStore } from "../execution-kernel/runtime-tool-action-claim.js";
import {
  RuntimeModelRoundDispatchService,
  runtimeModelRoundEffectIdentity,
} from "../execution-kernel/runtime-model-round-action-claim.js";
import { ConfiguredExecutionAccountRuntime, type ConfiguredExecutionCredential } from "../managed-account-leases/configured-execution-account-runtime.js";
import type { OperatorSessionExecutionCatalogSnapshot } from "../execution-routing/operator-session-execution-routing-service.js";
import type { AuthorityAdmissionEvidenceStore } from "../session/authority-admission-evidence.js";
import type { OperatorAdoptionDecisionPersistence } from "../session/operator-adoption-authority.js";
import type { RuntimeSessionTurnBudgetAuthority } from "../session/session-turn-budget-authority.js";
import type { ChannelEgressActionClaimContext } from "../channels/channel-egress-action-claim.js";
import { FixedRouteGatewayAuthorityAdmission } from "./gateway-authority-admission.js";
import type { GovernedOneRoundDispatcherResolver } from "../execution-kernel/governed-one-round-invocation.js";
import { RuntimeSessionOrchestrator } from "../session/runtime-session-orchestrator.js";
import type { RuntimeMultimodalDelegationRoute } from "../session/runtime-session-orchestrator.types.js";
import { createDefaultRuntimeMultimodalTransformRoutes } from "../session/runtime-multimodal-transforms.js";
import { SessionRegistry } from "../session/persistence/session-registry.js";
import type { DelegationTarget, DelegationRegistry } from "./delegation-handler.js";
import { TenantRegistry } from "../tenant/tenant-registry.js";
import { assertValidStartupConfig } from "./config-validator.js";
import { HealthRegistry } from "./health-registry.js";
import { createSttAdapter } from "./stt-factory.js";
import { createTtsAdapter } from "./tts-factory.js";
import type { SignedArtifactMediaOptions } from "./public-media-delivery.js";
import { extractText, textParts } from "@kilnai/core";
import { WebhookDedup } from "./webhook-dedup.js";
import { IntegrationRegistry } from "./integration-registry.js";
import { LocalCredentialResolver } from "./local-credential-resolver.js";
import { configureIntegrationDeps, getIntegrationDeps } from "./tenant-tool-factory.js";
import { SqliteEmailThreadStore } from "./sqlite-email-thread-store.js";
import { CompositeEventStore } from "../observability/composite-event-store.js";
import { PrometheusCollector } from "../observability/prometheus-collector.js";
import { createRuntimeToolResultSanitizer } from "./tool-result-sanitizer-factory.js";
import {
  mountGuiStaticAssets,
  resolveGuiDistPath,
} from "./gui-static-assets.js";

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
export interface ProviderSubsystemHealth {
  readonly status: "ok" | "degraded" | "error";
  readonly details: Record<string, string>;
}

type ProviderHealthStatus = "ok" | "degraded" | "error";

type BunHonoAdapters = typeof import("hono/bun");
type BunWebSocketHandler = ReturnType<BunHonoAdapters["createBunWebSocket"]>["websocket"];

async function loadBunHonoAdapters(): Promise<BunHonoAdapters> {
  return import("hono/bun");
}

export interface StartGatewayOptions {
  readonly port?: number;
  readonly onReady?: (url: string) => void;
  /** Local supervisor ownership. The credential is runtime-only and never projected by control responses. */
  readonly supervision?: {
    readonly identity: AppGatewayRuntimeIdentity;
    readonly controlToken: string;
    readonly drainTimeoutMs?: number;
  };
  readonly swarmCoordination?: "project-local";
  readonly guiDistPath?: string;
  /** Optional gateway security config (shared with HTTP middleware and runtime sanitizer wiring). */
  readonly securityConfig?: SecurityConfig;
  /** Integration adapters to register at gateway startup. */
  readonly integrations?: readonly IntegrationAdapter[];
  /** Env var name containing the master key for AES-256-GCM secret encryption. */
  readonly secretKeyEnv?: string;
  /** Runtime-managed auxiliary routes available for multimodal capability delegation, keyed by app name. */
  readonly multimodalDelegationRoutesByApp?: ReadonlyMap<string, readonly RuntimeMultimodalDelegationRoute[]>;
  /** Canonical effective project MCP servers. Apps may only admit these identities by id. */
  readonly canonicalMcpServers?: ReadonlyMap<string, ResolvedMcpServer>;
  readonly mcpCredentialResolver?: (credentialId: string) => string | undefined;
  /**
   * Canonical execution authority for the private model gateway. This bundle
   * is required whenever `modelGateway` is enabled in the gateway config;
   * startup never derives it from the model-gateway overlay.
   */
  readonly modelGatewayExecution?: ModelGatewayExecutionBundle;
  /** Required canonical execution and evidence authority for provider-adapter Apps. */
  readonly appGatewayExecution?: AppGatewayExecutionBundle;
  /** Test seam for the dedicated loopback model-gateway listener. */
  readonly modelGatewayListener?: (input: { readonly hostname: "127.0.0.1"; readonly port: number; readonly fetch: ModelGatewayListenerFetch }) => { stop(force?: boolean): void | Promise<void> };
}

export interface ModelGatewayExecutionBundle {
  readonly executionCatalog: ExecutionCatalog;
  readonly executionRouting: ModelGatewayExecutionRoutingPort;
  readonly executionCandidates: ModelGatewayExecutionCandidatePort;
  readonly executionDispatcher: GovernedOneRoundDispatcherResolver;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
}

export interface AppGatewayExecutionBundle {
  readonly snapshot: OperatorSessionExecutionCatalogSnapshot;
  readonly accountRuntime: ConfiguredExecutionAccountRuntime;
  readonly accountCapacityAuthority: ExecutionAccountCapacityAuthority;
  readonly evidenceStore: AuthorityAdmissionEvidenceStore;
  readonly modelRoundActionClaims: RuntimeModelRoundActionClaimStore;
  readonly toolActionClaims: RuntimeToolActionClaimStore;
  readonly channelEgressActionClaims: ChannelEgressActionClaimContext;
  readonly runtimeMediaActionClaims: import("../execution-kernel/runtime-media-action-claim.js").RuntimeMediaActionClaimContext;
  readonly persistOperatorAdoptionDecision: OperatorAdoptionDecisionPersistence;
  readonly sessionTurnBudget?: RuntimeSessionTurnBudgetAuthority;
  /** Releases CLI-owned account-authority resources when the gateway stops or startup fails. */
  readonly close?: () => void | Promise<void>;
}

export async function closeGatewayResources(actions: readonly (() => void | Promise<void>)[]): Promise<void> {
  for (const action of actions) {
    try { await action(); } catch { /* cleanup is best-effort across independent resources */ }
  }
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
  readonly client: Pick<KilnMcpClient, "discoverProviderCapabilities">;
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
  const configuredToolNames = collectConfiguredToolNames(input.app)
    .filter((name) => name.startsWith(`mcp:${input.serverName}:`));
  let capabilities: readonly Capability[] = [];
  let missingConfiguredTools: readonly string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    capabilities = await input.client.discoverProviderCapabilities();
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

export async function startGateway(configPath: string, options?: StartGatewayOptions): Promise<void> {
  const suppliedExecution = options?.appGatewayExecution;
  if (!suppliedExecution?.close) return startGatewayWithOwnedResources(configPath, options);

  let closed = false;
  const closeOnce = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    await suppliedExecution.close?.();
  };
  const guardedOptions: StartGatewayOptions = {
    ...options,
    appGatewayExecution: { ...suppliedExecution, close: closeOnce },
  };
  try {
    await startGatewayWithOwnedResources(configPath, guardedOptions);
  } catch (error) {
    await closeOnce();
    throw error;
  }
}

async function startGatewayWithOwnedResources(configPath: string, options?: StartGatewayOptions): Promise<void> {
  const configurationSource = readGatewayConfigurationSource(configPath);
  const gatewayConfig = configurationSource.config;
  const gatewayYamlDir = dirname(configurationSource.gateway.path);
  const port = options?.port ?? gatewayConfig.port;
  if (options?.supervision && (
    options.supervision.identity.port !== port
    || options.supervision.identity.configurationRevision !== configurationSource.configurationRevision
    || options.supervision.identity.lifecycle !== "ready"
  )) {
    throw new KilnError(
      "CONFIG_INVALID",
      "App Gateway supervision identity does not match the exact admitted configuration revision and effective port.",
      { context: { port, configurationRevision: configurationSource.configurationRevision }, retryable: false },
    );
  }
  const modelGatewayExecution = options?.modelGatewayExecution;
  if (gatewayConfig.modelGateway?.port === port) {
    throw new KilnError("CONFIG_INVALID", "The effective main gateway port must differ from the model gateway port.", { context: { port } });
  }
  if (gatewayConfig.modelGateway && modelGatewayExecution === undefined) {
    throw new KilnError(
      "CONFIG_INVALID",
      "Model gateway execution composition is required when modelGateway is configured.",
      { context: { configPath } },
    );
  }

  const resolvedApps = resolveApps(configurationSource);
  const appGatewayExecution = options?.appGatewayExecution;
  if (resolvedApps.some((resolved) => resolved.runtimeModeConfig?.runtime === "provider-adapter") && !appGatewayExecution) {
    throw new KilnError(
      "CONFIG_INVALID",
      "App Gateway execution composition is required when provider-adapter Apps are configured.",
      { context: { configPath } },
    );
  }

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
  const guiDistPath = resolveGuiDistPath(options?.guiDistPath);

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

  // EventBus: shared across all apps for canonical observability projections.
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
      providerAdapterRuntime: undefined as undefined | import("./provider-adapter-routes.js").ProviderAdapterAppRuntime,
      tenantRuntime: undefined as undefined | import("./tenant-routes.js").TenantAppRuntime,
      whatsappWebhookConfig: undefined as undefined | import("./whatsapp-webhook-routes.js").WhatsAppWebhookConfig,
      instagramWebhookConfig: undefined as undefined | import("./instagram-webhook-routes.js").InstagramWebhookConfig,
      messengerWebhookConfig: undefined as undefined | import("./messenger-webhook-routes.js").MessengerWebhookConfig,
      emailWebhookConfig: undefined as undefined | import("./email-webhook-routes.js").EmailWebhookConfig,
      tenantAdminConfig: undefined as undefined | import("./tenant-admin-routes.js").TenantAdminRoutesConfig,
      webChannel: hasWebChannel ? new WebChannel() : undefined,
      sttAdapter: undefined as undefined | SttAdapter,
      ttsAdapter: undefined as undefined | TtsAdapter,
      artifactStore: new MemoryArtifactResourceStore(),
      publicMediaSigningSecret: undefined as undefined | string,
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
  const ownedMcpClients: KilnMcpClient[] = [];

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
    const mcpClients: KilnMcpClient[] = [];
    const tools: ToolDefinition[] = [];
    const capabilityMap = new Map<string, Capability>();
    const configuredToolNames = new Set(collectConfiguredToolNames(resolved.app));
    const configuredWildcard = Object.values(resolved.app.teams).some((team) =>
      Object.values(team.agents).some((agent) => agent.tools?.includes("*")));

    if (resolved.app.mcp?.servers) {
      for (const serverId of resolved.app.mcp.servers) {
        const serverConfig = options?.canonicalMcpServers?.get(serverId);
        if (!serverConfig) {
          throw new KilnError("CONFIG_INVALID", `App '${loaded.name}' references unavailable canonical MCP server '${serverId}'`);
        }
        const client = new KilnMcpClient(serverConfig, {
          ...(options?.mcpCredentialResolver ? { credentialResolver: options.mcpCredentialResolver } : {}),
        });
        const capabilities = await discoverMcpCapabilitiesWithConfiguredToolRetry({
          client,
          app: resolved.app,
          appName: loaded.name,
          serverName: serverId,
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
        ownedMcpClients.push(client);
        console.log(`  ${loaded.name}: discovered ${capabilities.length} tools from MCP server "${serverId}"`);
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
    const toolAllowlist = new Set(tools
      .filter((tool) => !tool.name.startsWith("mcp:") || configuredWildcard || configuredToolNames.has(tool.name))
      .map((tool) => tool.name));
    const providerName = resolved.runtimeModeConfig.provider.name;
    const providerModel = resolved.runtimeModeConfig.provider.model;
    const matchingAppRoutes = appGatewayExecution!.snapshot.catalog.routes.filter((route) =>
      route.providerId === providerName && route.providerModelId === providerModel);
    if (matchingAppRoutes.length !== 1) {
      throw new KilnError(
        "CONFIG_INVALID",
        `App '${loaded.name}' provider/model ${providerName}/${providerModel} must match exactly one canonical execution target.`,
        { context: { appName: loaded.name, provider: providerName, model: providerModel, matchCount: matchingAppRoutes.length } },
      );
    }
    const gatewayAdmission = new FixedRouteGatewayAuthorityAdmission<ConfiguredExecutionCredential>({
      appName: loaded.name,
      routeId: matchingAppRoutes[0]!.id,
      snapshot: appGatewayExecution!.snapshot,
      sessionRegistry,
      candidates: appGatewayExecution!.accountRuntime.operatorSessionCandidates,
      accountCapacityAuthority: appGatewayExecution!.accountCapacityAuthority,
      credentials: appGatewayExecution!.accountRuntime.operatorSessionCredentials,
      evidenceStore: appGatewayExecution!.evidenceStore,
      modelRoundActionClaims: appGatewayExecution!.modelRoundActionClaims,
      toolActionClaims: appGatewayExecution!.toolActionClaims,
      channelEgressActionClaims: appGatewayExecution!.channelEgressActionClaims,
      runtimeMediaActionClaims: appGatewayExecution!.runtimeMediaActionClaims,
      persistOperatorAdoptionDecision: appGatewayExecution!.persistOperatorAdoptionDecision,
      createProvider: ({ credential, admission }) => appGatewayExecution!.accountRuntime.createProviderAdapterFromCredential({
        providerId: admission.providerId,
        providerModelId: admission.providerModelId,
        credential,
      }),
      ...(appGatewayExecution!.sessionTurnBudget ? { sessionTurnBudget: appGatewayExecution!.sessionTurnBudget } : {}),
    });

    // Cross-app delegation is a child effect and therefore enters the same
    // persisted admission/fence as every other productive App execution.
    delegationTargets.set(loaded.name, {
      appName: loaded.name,
      systemPrompt,
      execute: async ({ fromApp, task, request }) => {
        const tenantId = "_delegation";
        const userId = `app:${fromApp}`;
        const session = await sessionRegistry.getOrCreate({
          appName: loaded.name,
          tenantId,
          userId,
          systemPrompt,
        });
        return gatewayAdmission.execute({
          ingressId: crypto.randomUUID(),
          appName: loaded.name,
          tenantId,
          userId,
          sessionId: session.id,
          channel: "delegation",
          userParts: textParts(task),
          requestedAuthority: "read_only",
        }, async (admitted) => {
          const dispatch = admitted.runtimeModelRoundDispatch;
          const providerRequestId = request.requestIdentity?.requestId
            ?? `kiln:runtime-model-round:${dispatch.admission.admissionId}:${dispatch.attemptId}:0`;
          const delegatedRequest = {
            ...request,
            sessionId: admitted.session.id,
            executionContext: admitted.bundle.turn.execution.status === "routed"
              ? {
                  requestedAuthority: "read_only" as const,
                  executionBinding: admitted.bundle.turn.execution.binding,
                }
              : undefined,
            requestIdentity: {
              ...(request.requestIdentity ?? {}),
              requestId: providerRequestId,
            },
          };
          return new RuntimeModelRoundDispatchService(dispatch.store).dispatch({
            admission: dispatch.admission,
            sessionId: admitted.session.id,
            turnId: dispatch.admission.turnId,
            attemptId: dispatch.attemptId,
            round: 0,
            intentFingerprint: dispatch.intentFingerprint,
            effectIdentity: runtimeModelRoundEffectIdentity({
              provider: admitted.provider.name,
              request: delegatedRequest,
            }),
            providerRequestId,
            routeId: dispatch.routeId,
            accountId: dispatch.accountId,
            credentialRevision: dispatch.credentialRevision,
            readAdmission: dispatch.readAdmission,
            provider: admitted.provider,
            request: delegatedRequest,
            ...(dispatch.state ? { state: dispatch.state } : {}),
          });
        });
      },
    });

    const isMultiTenant = loaded.binding.channels.some((ch) => ch.multiTenant === true);

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
        gatewayAdmission,
        artifactStore: loaded.artifactStore,
        voiceConfig: resolved.app.voice,
        ttsAdapter: loaded.ttsAdapter,
        billing: resolved.runtimeModeConfig.billing,
        apiKey: resolvedApiKey,
        toolAllowlist,
      };

      const resolvePublicMediaConfig = (channel: (typeof loaded.binding.channels)[number] | undefined): SignedArtifactMediaOptions | undefined => {
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
        return {
          appName: loaded.name,
          publicBaseUrl: publicMediaBaseUrl,
          signingSecret: publicMediaSigningSecret,
        };
      };

      // WhatsApp webhook: find whatsapp channel with verifyTokenEnv
      const whatsappChannel = loaded.binding.channels.find((ch) => ch.type === "whatsapp");
      if (whatsappChannel) {
        const verifyTokenEnv = whatsappChannel.verifyTokenEnv ?? "";
        const appSecretEnv = whatsappChannel.appSecretEnv ?? "";
        const publicMedia = resolvePublicMediaConfig(whatsappChannel);
        loaded.whatsappWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          gatewayAdmission,
          verifyToken: verifyTokenEnv ? process.env[verifyTokenEnv] ?? "" : "",
          appSecret: appSecretEnv ? process.env[appSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          eventBus: gatewayEventBus,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          artifactStore: loaded.artifactStore,
          voiceConfig: resolved.app.voice,
          ttsAdapter: loaded.ttsAdapter,
          ...(publicMedia ? { publicMedia } : {}),
          dedup: webhookDedup,
        };
      }

      // Instagram webhook: find instagram channel config
      const instagramChannel = loaded.binding.channels.find((ch) => ch.type === "instagram");
      if (instagramChannel) {
        // Instagram shares the same Meta App Secret as WhatsApp
        const igAppSecretEnv = instagramChannel.appSecretEnv ?? whatsappChannel?.appSecretEnv ?? "";
        const igVerifyTokenEnv = instagramChannel.verifyTokenEnv ?? "";
        const publicMedia = resolvePublicMediaConfig(instagramChannel);
        loaded.instagramWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          gatewayAdmission,
          verifyToken: igVerifyTokenEnv ? process.env[igVerifyTokenEnv] ?? "" : "",
          appSecret: igAppSecretEnv ? process.env[igAppSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          eventBus: gatewayEventBus,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          artifactStore: loaded.artifactStore,
          voiceConfig: resolved.app.voice,
          ttsAdapter: loaded.ttsAdapter,
          ...(publicMedia ? { publicMedia } : {}),
          dedup: webhookDedup,
        };
      }

      // Messenger webhook: find messenger channel config
      const messengerChannel = loaded.binding.channels.find((ch) => ch.type === "messenger");
      if (messengerChannel) {
        const msgAppSecretEnv = messengerChannel.appSecretEnv ?? whatsappChannel?.appSecretEnv ?? "";
        const msgVerifyTokenEnv = messengerChannel.verifyTokenEnv ?? "";
        const publicMedia = resolvePublicMediaConfig(messengerChannel);
        loaded.messengerWebhookConfig = {
          appName: loaded.name,
          orchestrator,
          sessionRegistry,
          tenantRegistry,
          gatewayAdmission,
          verifyToken: msgVerifyTokenEnv ? process.env[msgVerifyTokenEnv] ?? "" : "",
          appSecret: msgAppSecretEnv ? process.env[msgAppSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          eventBus: gatewayEventBus,
          memoryBasePath: resolved.memoryBasePath,
          sttAdapter: loaded.sttAdapter,
          artifactStore: loaded.artifactStore,
          voiceConfig: resolved.app.voice,
          ttsAdapter: loaded.ttsAdapter,
          ...(publicMedia ? { publicMedia } : {}),
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
          gatewayAdmission,
          webhookSecret: emailWebhookSecretEnv ? process.env[emailWebhookSecretEnv] ?? undefined : undefined,
          billing: resolved.runtimeModeConfig.billing,
          memoryBasePath: resolved.memoryBasePath,
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
        gatewayAdmission,
        artifactStore: loaded.artifactStore,
        voiceConfig: resolved.app.voice,
        ttsAdapter: loaded.ttsAdapter,
        billing: resolved.runtimeModeConfig.billing,
        systemPrompt,
        apiKey: resolvedApiKey,
        toolAllowlist,
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

  // Project-local swarm coordination is an explicit CLI development capability,
  // independent from any presentation surface.
  let swarmMemoryRepository: SqliteMemoryRepository | undefined;
  if (options?.swarmCoordination === "project-local") {
    const firstResolved = resolvedApps[0];
    if (firstResolved) {
      const devMemoryDir = join(firstResolved.memoryBasePath, "dev");
      mkdirSync(devMemoryDir, { recursive: true });
      swarmMemoryRepository = new SqliteMemoryRepository({
        dbPath: join(devMemoryDir, "swarm.db"),
      });
    }
  }

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

  const { createBunWebSocket } = await loadBunHonoAdapters();
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
    jwtVerifier,
  });

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

          // Budget enforcement
          checkBudget: async (tenantId: string, appName: string) => {
            const loaded = loadedApps.find((a) => a.name === appName);
            const billing = loaded?.tenantRuntime?.billing;
            if (!billing) return { allowed: true, remaining: -1, unit: "unknown" };
            const { checkBudget: check } = await import("./budget-middleware.js");
            return check(billing, tenantId);
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

  let modelGatewayRuntime: { close(): Promise<void> } | undefined;
  let resourcesClosed = false;
  const closeStartedResources = async (): Promise<void> => {
    if (resourcesClosed) return;
    resourcesClosed = true;
    await closeGatewayResources([
      () => triggerRegistry.stop(),
      () => credentialWatcher.stop(),
      () => webhookDedup.close(),
      () => swarmMemoryRepository?.close(),
      () => mcpServerInstance?.close(),
      () => modelGatewayRuntime?.close(),
      () => appGatewayExecution?.close?.(),
      ...ownedMcpClients.map((client) => () => client.disconnect()),
    ]);
  };

  try {
    if (gatewayConfig.modelGateway) {
      modelGatewayRuntime = await startModelGatewayListener({
        config: gatewayConfig.modelGateway,
        ...modelGatewayExecution!,
        databasePath: join(gatewayYamlDir, ".kiln", "model-gateway", "model-gateway.sqlite"),
        ...(options?.modelGatewayListener === undefined ? {} : { listen: options.modelGatewayListener }),
      });
      const surfaces = [gatewayConfig.modelGateway.surfaces.openAIResponses ? "/v1/responses" : undefined, gatewayConfig.modelGateway.surfaces.anthropicMessages ? "/v1/messages" : undefined].filter(Boolean).join(", ");
      console.log(`Model gateway: http://127.0.0.1:${gatewayConfig.modelGateway.port} (${surfaces})`);
    }

    triggerRegistry.start();
    const appNames = loadedApps.map((a) => a.name).join(", ");
    console.log(`Gateway started on port ${port} with ${loadedApps.length} apps: ${appNames}`);
    console.log(`GUI: http://localhost:${port}/gui/`);
    await serveAndWait(
      honoApp,
      port,
      closeStartedResources,
      bunWebsocket,
      options?.onReady ? () => options.onReady?.(`http://localhost:${port}/gui/`) : undefined,
      options?.supervision,
    );
  } catch (error) {
    await closeStartedResources();
    throw error;
  }
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
    case "codex-oauth": {
      const service = new CodexOAuthCredentialPoolService({
        watcher: credentialWatcher,
        observability: credentialPoolObservability,
      });
      requireModel();
      await service.createPool();
      return createMetadataOnlyProviderAdapter(config.name);
    }
    case "opencode-go":
    case "opencode-zen": {
      const service = new OpenCodeCredentialPoolService({
        watcher: credentialWatcher,
        observability: credentialPoolObservability,
      });
      const tier = config.name === "opencode-zen" ? "zen" : "go";
      requireModel();
      await service.createPool(tier);
      return createMetadataOnlyProviderAdapter(config.name);
    }
    case "anthropic":
    case "openai":
    case "deepseek":
    case "openrouter":
    case "ollama":
    case "lmstudio":
      if (!isPooledDirectProviderId(config.name)) {
        throw new KilnError("CONFIG_INVALID", `Unsupported pooled provider: ${config.name}`);
      }
      const service = new DirectProviderCredentialPoolService({
        watcher: credentialWatcher,
        observability: credentialPoolObservability,
      });
      await service.createPool(config.name);
      return createMetadataOnlyProviderAdapter(config.name);
    default:
      throw new KilnError("CONFIG_INVALID", `Unknown provider: ${config.name}`, {
        context: { provider: config.name },
      });
  }
}

/**
 * Startup builds only a provider identity for the base orchestrator. Productive
 * calls are materialized from the exact credential admitted after the durable
 * execution fence; this placeholder makes an accidental pre-admission call
 * fail closed instead of dispatching through an unbound credential pool.
 */
function createMetadataOnlyProviderAdapter(name: string): ProviderAdapter {
  const rejectDispatch = (): never => {
    throw new KilnError(
      "CONFIG_INVALID",
      `Provider '${name}' requires canonical authority admission before dispatch.`,
      { context: { provider: name } },
    );
  };
  return {
    name,
    deliberationTransport: name === "codex-oauth" || name === "anthropic" || name === "openai"
      ? "native-level"
      : "none",
    createMessage: async () => rejectDispatch(),
    streamMessage: async function* () {
      rejectDispatch();
    },
  };
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

async function serveAndWait(
  app: Hono,
  port: number,
  onShutdown?: () => void | Promise<void>,
  websocketHandler?: BunWebSocketHandler,
  onReady?: () => void,
  supervision?: StartGatewayOptions["supervision"],
): Promise<void> {
  const websocket = websocketHandler ?? (await loadBunHonoAdapters()).createBunWebSocket().websocket;

  let server: ReturnType<typeof Bun.serve>;
  let drainController: ReturnType<typeof createGatewayDrainController> | undefined;
  try {
    // idleTimeout: 255s is the uWebSockets max (uint8). Prevents Bun from killing SSE streams.
    server = Bun.serve({
      port,
      fetch: (request, bunServer) => {
        if (supervision && drainController) {
          const identity: AppGatewayRuntimeIdentity = {
            ...supervision.identity,
            lifecycle: drainController.isDraining() ? "draining" : "ready",
          };
          const control = handleAppGatewayControlRequest({
            request,
            requestAddress: bunServer.requestIP(request)?.address,
            identity,
            controlToken: supervision.controlToken,
            requestShutdown: () => { void drainController?.requestShutdown(); },
          });
          if (control) return control;
          if (drainController.isDraining()) {
            return Response.json({ error: "gateway-draining" }, { status: 503, headers: { "retry-after": "1" } });
          }
        }
        return app.fetch(request);
      },
      websocket,
      idleTimeout: 255,
    });
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && err.code === "EADDRINUSE") {
      throw new Error(`Port ${port} is already in use.`, { cause: err });
    }
    throw err;
  }

  drainController = createGatewayDrainController({
    server,
    closeResources: async () => onShutdown?.(),
    ...(supervision?.drainTimeoutMs === undefined ? {} : { timeoutMs: supervision.drainTimeoutMs }),
  });

  try {
    onReady?.();
  } catch (error) {
    await server.stop(true);
    throw error;
  }

  const shutdown = (): void => {
    console.log("\nShutting down...");
    void drainController?.requestShutdown();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  try {
    await drainController.waitForShutdown();
  } finally {
    process.off("SIGINT", shutdown);
    process.off("SIGTERM", shutdown);
  }
}
