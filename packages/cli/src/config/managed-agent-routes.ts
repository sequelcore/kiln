import { basename } from "node:path";
import type {
  ArtifactResourceStore,
  ManagedAgentAdmissionProfile,
  ManagedAgentCredentialRoute,
  ManagedAgentMemoryScope,
  ManagedAgentWorkingDirectory,
} from "@kilnai/core";
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
} from "../kiln-yaml-types.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionRegistry,
} from "../wrapper/session-registry.js";

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
  readonly directAdapterFactory?: (route: KilnManagedAgentRouteConfig) => ManagedAgentRuntimeAdapter | Promise<ManagedAgentRuntimeAdapter | undefined> | undefined;
  readonly artifactStore?: ArtifactResourceStore;
}

export interface ManagedAgentRouteConfigSource {
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly engines?: Record<string, { readonly enabled?: boolean }>;
  readonly routing?: { readonly defaultWorker?: string };
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
  opencode: "openai/gpt-4o:free",
};

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
        requestedBy: "assistant",
        requestSource: context.surface,
        ...(context.artifactStore ? { artifactStore: context.artifactStore } : {}),
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
    return resolveDirectRouteConfig(routeConfig, context, baseHealth);
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
