import { basename } from "node:path";
import type {
  ArtifactResourceStore,
  ManagedAgentAdmissionProfile,
  ManagedAgentCredentialRoute,
  ManagedAgentMemoryScope,
  ModelTaskSuitability,
  ManagedAgentWorkingDirectory,
} from "@kilnai/core";
import { isDirectProviderId, ModelCapabilityRegistry } from "@kilnai/core";
import {
  ManagedCliHarnessAdapter,
  type ManagedAgentRuntimeAdapter,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolRoute,
} from "@kilnai/runtime";
import type { CliSessionFactory } from "@kilnai/runtime";
import type {
  KilnManagedAgentsConfig,
  KilnManagedAgentProfile,
  KilnManagedAgentRouteConfig,
  KilnModelTaskSuitabilityOverride,
} from "../kiln-yaml-types.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import { createManagedInvocationContextResolver } from "./managed-invocation-context-resolver.js";
import { loadAgentDefinitions } from "../application/agent-loader.js";

export type ManagedAgentOperatorSurface = "gui" | "tui" | "run" | "operator";

export interface ManagedAgentRouteHealth {
  readonly routeId: string;
  readonly kind: "harness" | "direct";
  readonly provider: string;
  readonly model?: string;
  readonly profiles: readonly ManagedAgentAdmissionProfile[];
  readonly available: boolean;
  readonly reason?: string;
}

export interface ManagedInvocationRouteResolution {
  readonly managedInvocation?: ManagedInvocationToolOptions;
  readonly routeHealth: readonly ManagedAgentRouteHealth[];
}

export interface ResolveManagedInvocationToolOptionsContext {
  readonly cwd: string;
  readonly registry: SessionRegistry;
  readonly surface: ManagedAgentOperatorSurface;
  readonly isProviderAvailable?: (provider: string) => boolean | undefined;
  readonly providerModels?: Readonly<Record<string, readonly string[] | undefined>>;
  readonly directAdapterFactory?: (route: KilnManagedAgentRouteConfig) => ManagedAgentRuntimeAdapter | Promise<ManagedAgentRuntimeAdapter | undefined> | undefined;
  readonly artifactStore?: ArtifactResourceStore;
}

export interface ManagedAgentRouteConfigSource {
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly engines?: Record<string, { readonly enabled?: boolean }>;
  readonly routing?: {
    readonly defaultWorker?: string;
    readonly routes?: readonly {
      readonly provider: string;
      readonly model?: string;
    }[];
  };
  readonly models?: {
    readonly default?: string;
    readonly [engine: string]: string | undefined;
  };
}

const SUPPORTED_HARNESS_PROVIDERS = new Set<string>(["codex", "opencode"]);
const READONLY_PROFILE: KilnManagedAgentProfile = "foundation-readonly-plan";
const DEFAULT_ALLOWED_TOOLS = ["read", "tree", "grep", "glob"] as const;
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_MODELS: Record<string, string> = {
  codex: "gpt-5.3-codex-spark",
  opencode: "opencode/minimax-m2.5-free",
};
const HARNESS_READONLY_RESULT_HANDOFF_MODELS: Record<string, readonly string[] | "*"> = {
  codex: "*",
  opencode: ["opencode/minimax-m2.5-free"],
};
const MODEL_CAPABILITIES = new ModelCapabilityRegistry();

export async function resolveManagedInvocationToolOptions(
  config: ManagedAgentRouteConfigSource | null | undefined,
  context: ResolveManagedInvocationToolOptionsContext,
): Promise<ManagedInvocationRouteResolution> {
  if (!config || config.managedAgents?.enabled === false) {
    return { routeHealth: [] };
  }

  const routeConfigs = resolveRouteConfigs(config);
  if (routeConfigs.length === 0) {
    return { routeHealth: [] };
  }

  const routes: ManagedInvocationToolRoute[] = [];
  const routeHealth: ManagedAgentRouteHealth[] = [];
  const agentCatalog = (await loadAgentDefinitions(context.cwd)).map((agent) => ({
    name: agent.name,
    ...(agent.displayName ? { displayName: agent.displayName } : {}),
    ...(agent.nicknameCandidates ? { nicknameCandidates: agent.nicknameCandidates } : {}),
    role: agent.role,
    goal: agent.goal,
    tier: agent.tier,
    ...(agent.skills ? { skills: agent.skills } : {}),
    ...(agent.routeId ? { routeId: agent.routeId } : {}),
    ...(agent.providerRoute ? { providerRoute: agent.providerRoute } : {}),
  }));

  for (const routeConfig of routeConfigs) {
    const resolved = await resolveRouteConfig(routeConfig, context, config);
    routeHealth.push(resolved.health);
    if (resolved.route) {
      routes.push(resolved.route);
    }
  }

  return {
    routeHealth,
    ...(routes.length > 0 ? {
      managedInvocation: {
        routes,
        ...(agentCatalog.length > 0 ? { agentCatalog } : {}),
        unavailableRoutes: routeHealth
          .filter((route) => !route.available)
          .map((route) => ({
            routeId: route.routeId,
            providerId: route.provider,
            ...(route.model ? { model: route.model } : {}),
            profiles: route.profiles,
            reason: route.reason ?? "Route is unavailable.",
          })),
        requestedBy: "assistant",
        requestSource: context.surface,
        ...(context.artifactStore ? { artifactStore: context.artifactStore } : {}),
        contextResolver: createManagedInvocationContextResolver(context.cwd),
      },
    } : {}),
  };
}

function resolveRouteConfigs(
  config: ManagedAgentRouteConfigSource,
): readonly KilnManagedAgentRouteConfig[] {
  const managedAgents = config.managedAgents;
  if (managedAgents?.routes && managedAgents.routes.length > 0) {
    return managedAgents.routes;
  }
  const routingRoutes = synthesizeRoutesFromRouting(config);
  if (routingRoutes.length > 0) {
    return routingRoutes;
  }
  if (managedAgents?.enabled === true) {
    return [synthesizeDefaultRoute(managedAgents)];
  }
  const route = synthesizeRouteFromEnabledEngines(config);
  return route ? [route] : [];
}

function synthesizeDefaultRoute(
  managedAgents: KilnManagedAgentsConfig,
): KilnManagedAgentRouteConfig {
  const provider = managedAgents.defaultProvider ?? "codex";
  return synthesizeReadonlyRoute({
    provider,
    model: managedAgents.model,
    profile: managedAgents.defaultProfile,
  });
}

function synthesizeRouteFromEnabledEngines(
  config: ManagedAgentRouteConfigSource,
): KilnManagedAgentRouteConfig | undefined {
  const provider = resolveDefaultChildProvider(config);
  if (!provider) {
    return undefined;
  }
  return synthesizeReadonlyRoute({
    provider,
    model: config.models?.[provider],
    profile: READONLY_PROFILE,
  });
}

function synthesizeRoutesFromRouting(
  config: ManagedAgentRouteConfigSource,
): readonly KilnManagedAgentRouteConfig[] {
  const routes = config.routing?.routes
    ?.map((route) => synthesizeRouteFromRoutingCandidate(route, config))
    .filter((route): route is KilnManagedAgentRouteConfig => route !== undefined);
  return routes ? dedupeRouteConfigs(routes) : [];
}

function synthesizeRouteFromRoutingCandidate(
  route: { readonly provider: string; readonly model?: string },
  config: ManagedAgentRouteConfigSource,
): KilnManagedAgentRouteConfig | undefined {
  const provider = route.provider.trim();
  if (!provider) {
    return undefined;
  }
  if (!SUPPORTED_HARNESS_PROVIDERS.has(provider) && !isDirectProviderId(provider)) {
    return undefined;
  }
  return synthesizeReadonlyRoute({
    provider,
    model: route.model ?? config.models?.[provider],
    profile: READONLY_PROFILE,
  });
}

function dedupeRouteConfigs(
  routes: readonly KilnManagedAgentRouteConfig[],
): readonly KilnManagedAgentRouteConfig[] {
  const seen = new Set<string>();
  const deduped: KilnManagedAgentRouteConfig[] = [];
  for (const route of routes) {
    if (seen.has(route.id)) {
      continue;
    }
    seen.add(route.id);
    deduped.push(route);
  }
  return deduped;
}

function synthesizeReadonlyRoute(input: {
  readonly provider: string;
  readonly model?: string;
  readonly profile?: KilnManagedAgentProfile;
}): KilnManagedAgentRouteConfig {
  const { provider } = input;
  return {
    id: `${provider}-readonly`,
    kind: SUPPORTED_HARNESS_PROVIDERS.has(provider) ? "harness" : "direct",
    provider,
    model: input.model ?? DEFAULT_MODELS[provider],
    profiles: [input.profile ?? READONLY_PROFILE],
    workingDirectory: "project",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    tools: {
      allowed: DEFAULT_ALLOWED_TOOLS,
      network: false,
      writes: false,
    },
    memory: { access: "read-only" },
    credentials: { mode: "runtime-selected" },
  };
}

function resolveDefaultChildProvider(
  config: ManagedAgentRouteConfigSource,
): string | undefined {
  const defaultWorker = config.routing?.defaultWorker;
  if (defaultWorker && isEnabledSupportedChildEngine(config, defaultWorker)) {
    return defaultWorker;
  }
  return Array.from(SUPPORTED_HARNESS_PROVIDERS)
    .find((provider) => isEnabledSupportedChildEngine(config, provider));
}

function isEnabledSupportedChildEngine(
  config: ManagedAgentRouteConfigSource,
  provider: string,
): boolean {
  return SUPPORTED_HARNESS_PROVIDERS.has(provider)
    && config.engines?.[provider]?.enabled === true;
}

async function resolveRouteConfig(
  routeConfig: KilnManagedAgentRouteConfig,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  const profiles = normalizeProfiles(routeConfig.profiles);
  const baseHealth = {
    routeId: routeConfig.id,
    kind: routeConfig.kind,
    provider: routeConfig.provider,
    ...(routeConfig.model ? { model: routeConfig.model } : {}),
    profiles,
  };

  if (profiles.some((profile) => profile !== READONLY_PROFILE) || routeConfig.tools?.writes === true) {
    return unhealthy(baseHealth, "Write-capable managed invocation routes require explicit write authority and live-proven adapter support.");
  }

  if (config.engines?.[routeConfig.provider]?.enabled === false) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is disabled in engine config.`);
  }

  if (routeConfig.kind !== "harness" && routeConfig.kind !== "direct") {
    return unhealthy(baseHealth, `Unsupported managed invocation route kind '${routeConfig.kind}'.`);
  }

  if (routeConfig.kind === "direct") {
    return resolveDirectRouteConfig(routeConfig, context, config, baseHealth);
  }

  if (!SUPPORTED_HARNESS_PROVIDERS.has(routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' does not have a live-proven managed harness adapter.`);
  }

  if (!isProviderAvailable(context, routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is unavailable.`);
  }

  const model = routeConfig.model ?? DEFAULT_MODELS[routeConfig.provider];
  if (!model) {
    return unhealthy(baseHealth, `Managed invocation route '${routeConfig.id}' requires a model.`);
  }
  const advertisedModels = context.providerModels?.[routeConfig.provider];
  if (advertisedModels && advertisedModels.length === 0) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' did not advertise any models.`);
  }
  if (advertisedModels && !advertisedModels.includes(model)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' does not advertise model '${model}'.`);
  }
  if (!supportsReadonlyResultHandoff(routeConfig.provider, model)) {
    return unhealthy(
      baseHealth,
      `Provider '${routeConfig.provider}' model '${model}' does not have live-proven read-only managed result handoff support for foundation-readonly-plan.`,
    );
  }

  const adapter = new ManagedCliHarnessAdapter({
    providerId: routeConfig.provider,
    model,
    factory: createHarnessSessionFactory(routeConfig.provider as ProviderId, model, context),
  });
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    providerId: routeConfig.provider,
    model,
    adapter,
    surface: "cli-harness",
    taskSuitability: resolveTaskSuitability(routeConfig.provider, model, config.modelTaskSuitability),
    profiles: {
      [READONLY_PROFILE]: buildReadonlyProfile(routeConfig, context.cwd),
    },
  };

  return {
    health: {
      ...baseHealth,
      model,
      available: true,
    },
    route,
  };
}

function supportsReadonlyResultHandoff(provider: string, model: string): boolean {
  const supportedModels = HARNESS_READONLY_RESULT_HANDOFF_MODELS[provider];
  return supportedModels === "*" || supportedModels?.includes(model) === true;
}

function buildReadonlyProfile(routeConfig: KilnManagedAgentRouteConfig, cwd: string) {
  return {
    authorityProfileId: `authority:${routeConfig.id}:${READONLY_PROFILE}`,
    permissionProfile: "read-only",
    allowedToolNames: routeConfig.tools?.allowed ?? DEFAULT_ALLOWED_TOOLS,
    writeAllowed: false,
    networkAllowed: routeConfig.tools?.network === true,
    workingDirectory: resolveWorkingDirectory(routeConfig, cwd),
    timeoutMs: routeConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    credentialRoute: resolveCredentialRoute(routeConfig),
    memoryScope: resolveMemoryScope(routeConfig, cwd),
  };
}

async function resolveDirectRouteConfig(
  routeConfig: KilnManagedAgentRouteConfig,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  if (!isProviderAvailable(context, routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is unavailable.`);
  }
  const model = routeConfig.model;
  if (!model) {
    return unhealthy(baseHealth, `Direct managed invocation route '${routeConfig.id}' requires a model.`);
  }
  let adapter: ManagedAgentRuntimeAdapter | undefined;
  try {
    adapter = await context.directAdapterFactory?.(routeConfig);
  } catch (err) {
    return unhealthy(baseHealth, err instanceof Error ? err.message : String(err));
  }
  if (!adapter) {
    return unhealthy(baseHealth, "Direct managed invocation routes require the direct provider managed runtime adapter.");
  }
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    providerId: routeConfig.provider,
    model,
    adapter,
    surface: "direct-provider",
    taskSuitability: resolveTaskSuitability(routeConfig.provider, model, config.modelTaskSuitability),
    profiles: {
      [READONLY_PROFILE]: buildReadonlyProfile(routeConfig, context.cwd),
    },
  };
  return {
    health: {
      ...baseHealth,
      model,
      available: true,
    },
    route,
  };
}

function resolveTaskSuitability(
  provider: string,
  model: string,
  overrides: readonly KilnModelTaskSuitabilityOverride[] | undefined,
): readonly ModelTaskSuitability[] {
  const merged = new Map<string, ModelTaskSuitability>();
  for (const entry of MODEL_CAPABILITIES.taskSuitability(provider, model)) {
    merged.set(entry.task, entry);
  }
  for (const override of overrides ?? []) {
    if (override.provider !== provider || override.model !== model) {
      continue;
    }
    merged.set(override.task, {
      task: override.task,
      level: override.level,
      source: "operator-override",
      reason: override.reason,
    });
  }
  return [...merged.values()];
}

function normalizeProfiles(
  profiles: readonly ManagedAgentAdmissionProfile[] | undefined,
): readonly ManagedAgentAdmissionProfile[] {
  return profiles && profiles.length > 0 ? profiles : [READONLY_PROFILE];
}

function unhealthy(
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  reason: string,
): {
  readonly health: ManagedAgentRouteHealth;
} {
  return {
    health: {
      ...baseHealth,
      available: false,
      reason,
    },
  };
}

function isProviderAvailable(
  context: ResolveManagedInvocationToolOptionsContext,
  provider: string,
): boolean {
  if (context.isProviderAvailable?.(provider) === false) {
    return false;
  }
  const descriptor = context.registry.list().find((entry) => entry.id === provider);
  if (!descriptor || descriptor.health === "suppressed") {
    return false;
  }
  try {
    return descriptor.isAvailable?.() !== false;
  } catch {
    return false;
  }
}

function createHarnessSessionFactory(
  provider: ProviderId,
  model: string,
  context: ResolveManagedInvocationToolOptionsContext,
): CliSessionFactory {
  return (systemPrompt, cwd, factoryContext) => {
    const config: ProviderCreateConfig = {
      task: systemPrompt,
      systemPrompt,
      cwd,
      permissionPolicy: {
        approval: "on-request",
        sandbox: "read-only",
      },
      model,
      sessionLedgerOwner: "host",
      ...(factoryContext?.operatorSurface ? { operatorSurface: factoryContext.operatorSurface } : {}),
    };
    return context.registry.createSession(provider, config);
  };
}

function resolveWorkingDirectory(
  _routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
): ManagedAgentWorkingDirectory {
  return {
    path: cwd,
    mode: "read-only",
  };
}

function resolveCredentialRoute(
  routeConfig: KilnManagedAgentRouteConfig,
): ManagedAgentCredentialRoute {
  if (routeConfig.credentials?.mode === "credentialless") {
    return { mode: "credentialless" };
  }
  return {
    mode: "runtime-selected",
    routeId: routeConfig.credentials?.mode === "runtime-selected" && routeConfig.credentials.routeId
      ? routeConfig.credentials.routeId
      : `credential-route:${routeConfig.provider}:runtime-selected`,
  };
}

function resolveMemoryScope(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
): ManagedAgentMemoryScope {
  return {
    scope: {
      kind: "project",
      id: basename(cwd.replace(/\\/g, "/")) || "project",
    },
    access: routeConfig.memory?.access ?? "read-only",
  };
}
