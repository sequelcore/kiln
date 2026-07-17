import { homedir } from "node:os";
import { basename, posix, resolve, win32 } from "node:path";
import type {
  ArtifactResourceStore,
  DefaultBuiltinToolRegistryOptions,
  ManagedAgentAdmissionProfile,
  ManagedAgentCredentialRoute,
  ManagedAgentMemoryScope,
  ManagedAgentAuthorityProfile,
  ManagedAgentRouteSource,
  ProviderModelEvidence,
  ProviderModelEvidenceObservation,
  ProviderModelEvidenceState,
  ProviderModelEvidenceValue,
  ProviderModelEligibilityDecision,
  ProviderModelEligibilityRequirements,
  ModelTaskSuitabilityEvidence,
  ManagedAgentWorkingDirectory,
} from "@kilnai/core";
import {
  createProviderModelEvidence,
  defineManagedAgentReadAuthority,
  defineManagedAgentWriteAuthority,
  defineManagedAgentWriteScope,
  deriveProviderModelEligibility,
  isDirectProviderId,
} from "@kilnai/core";
import {
  createAttachedRuntimeBuiltinToolSurface,
  ManagedCliHarnessAdapter,
  ManagedGitWorktreeLeaseManager,
  ManagedRemoteHarnessAdapter,
  ManagedRuntimeCredentialRouteLeaseManager,
  ManagedRuntimeSandboxLeaseManager,
  RuntimeManagedAgentInvocationService,
  type ManagedAgentRuntimeAdapter,
  type ManagedAgentRuntimeAuthorityObserver,
  type ManagedInvocationAgentCatalogEntry,
  type ManagedInvocationRouteProfile,
  type ManagedInvocationToolOptions,
  type ManagedInvocationToolRoute,
  type RuntimeBudgetAdmissionPort,
} from "@kilnai/runtime";
import type {
  ManagedAgentProviderModelCatalogDiagnostic,
  ManagedAgentProviderModelCatalogDiagnostics,
} from "./managed-agent-provider-models.js";
import type { CliSessionFactory } from "@kilnai/runtime";
import type {
  KilnManagedAgentsConfig,
  KilnManagedAgentProfile,
  KilnManagedAgentRouteConfig,
  KilnModelTaskSuitabilityOverride,
  KilnYamlSkillsConfig,
} from "../kiln-yaml-types.js";
import type {
  ProviderCreateConfig,
  ProviderId,
  SessionRegistry,
} from "../wrapper/session-registry.js";
import { createManagedInvocationContextResolver } from "./managed-invocation-context-resolver.js";
import { loadAgentDefinitions, type KilnAgentDefinition } from "../application/agent-loader.js";
import { readSkillCatalogStatus } from "./skill-catalog-status.js";
import { resolveConfiguredModelTaskSuitability } from "./model-task-suitability.js";

type ManagedSkillCatalogEntry = NonNullable<ManagedInvocationToolOptions["skillCatalog"]>[number];

export type ManagedAgentOperatorSurface = "gui" | "tui" | "run" | "operator";

export interface ManagedAgentRouteHealth {
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly kind: "harness" | "direct";
  readonly provider: string;
  readonly model?: string;
  readonly profiles: readonly ManagedAgentAdmissionProfile[];
  readonly available: boolean;
  readonly reason?: string;
}

export interface ManagedAgentProfileHealth {
  readonly agentName: string;
  readonly available: boolean;
  readonly routeId?: string;
  readonly reason?: string;
}

export interface ManagedInvocationRouteResolution {
  readonly managedInvocation?: ManagedInvocationToolOptions;
  readonly routeHealth: readonly ManagedAgentRouteHealth[];
  readonly agentHealth?: readonly ManagedAgentProfileHealth[];
}

export interface ManagedInvocationToolOptionsCatalog {
  readonly options: ManagedInvocationToolOptions;
  update(next: ManagedInvocationToolOptions): void;
}

export interface ResolveManagedInvocationToolOptionsContext {
  readonly cwd: string;
  readonly registry: SessionRegistry;
  readonly surface: ManagedAgentOperatorSurface;
  readonly isProviderAvailable?: (provider: string) => boolean | undefined;
  readonly providerModelEligibility?: ManagedAgentProviderModelCatalogDiagnostics;
  readonly includeUnavailableRoutes?: boolean;
  readonly directAdapterFactory?: (route: KilnManagedAgentRouteConfig) => ManagedAgentRuntimeAdapter | Promise<ManagedAgentRuntimeAdapter | undefined> | undefined;
  readonly builtinToolOptions?: BuiltinToolOptionsSource;
  readonly artifactStore?: ArtifactResourceStore;
  readonly invocationService?: RuntimeManagedAgentInvocationService;
  readonly invocationServiceKey?: string;
  readonly userHome?: string;
  readonly maxParallelChildren?: number;
  readonly orchestrationBudgetAdmission?: RuntimeBudgetAdmissionPort;
}

type BuiltinToolOptionsSource = DefaultBuiltinToolRegistryOptions | (() => DefaultBuiltinToolRegistryOptions | undefined);

interface ManagedAgentRouteConfigProjection {
  readonly routeConfig: KilnManagedAgentRouteConfig;
  readonly routeSource: ManagedAgentRouteSource;
}

export interface ManagedAgentRouteConfigSource {
  readonly managedAgents?: KilnManagedAgentsConfig;
  readonly modelTaskSuitability?: readonly KilnModelTaskSuitabilityOverride[];
  readonly skills?: KilnYamlSkillsConfig;
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
const WRITE_PROFILES = new Set<KilnManagedAgentProfile>([
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
]);
const DEFAULT_ALLOWED_TOOLS = ["read", "tree", "grep", "glob"] as const;
const DEFAULT_WRITE_ALLOWED_TOOLS = ["read", "tree", "grep", "glob", "write", "edit", "apply-patch"] as const;
const DEFAULT_MANAGED_WORKSPACE_DENIED_ENTRIES = [".git", "node_modules", ".kiln"] as const;
const DEFAULT_TIMEOUT_MS = 300000;
const DEFAULT_MODELS: Record<string, string> = {
  codex: "gpt-5.3-codex-spark",
  opencode: "opencode/minimax-m2.5-free",
};
const LIVE_PROVEN_WRITE_HARNESS_PROVIDERS = new Set<string>(["codex", "opencode"]);
const LIVE_PROVEN_HARNESS_WRITE_AUTHORITY = {
  proposalSupported: true,
  approvedApplySupported: true,
  memoryProposalSupported: true,
  rollbackEvidence: true,
  cleanupEvidence: true,
  scopeReduction: true,
} as const;
const HARNESS_READONLY_RESULT_HANDOFF_MODELS: Record<string, readonly string[] | "*"> = {
  codex: "*",
  opencode: ["opencode/minimax-m2.5-free"],
};

export async function resolveManagedInvocationToolOptions(
  config: ManagedAgentRouteConfigSource | null | undefined,
  context: ResolveManagedInvocationToolOptionsContext,
): Promise<ManagedInvocationRouteResolution> {
  const mark = createManagedRouteResolutionStartupMarker();
  mark("managed-route-resolution-entered");
  if (!config || config.managedAgents?.enabled === false) {
    return { routeHealth: [] };
  }

  const routeConfigs = resolveRouteConfigs(config);
  mark("managed-route-configs-resolved", { count: routeConfigs.length });
  if (routeConfigs.length === 0) {
    return { routeHealth: [] };
  }

  const routes: ManagedInvocationToolRoute[] = [];
  const routeHealth: ManagedAgentRouteHealth[] = [];
  const agentDefinitions = await loadAgentDefinitions(context.cwd);
  mark("managed-route-agents-loaded", { count: agentDefinitions.length });
  const userHome = context.userHome ?? homedir();
  const skillCatalog = loadManagedInvocationSkillCatalog(context.cwd, userHome, config.skills);
  mark("managed-route-skills-loaded", { count: skillCatalog.length });

  let routeIndex = 0;
  for (const routeConfig of routeConfigs) {
    routeIndex += 1;
    mark("managed-route-resolve-started", { routeIndex, routeId: routeConfig.routeConfig.id });
    const resolved = await resolveRouteConfig(routeConfig, context, config);
    mark("managed-route-resolve-finished", { routeIndex, routeId: routeConfig.routeConfig.id });
    routeHealth.push(resolved.health);
    if (resolved.route) {
      routes.push(resolved.route);
    }
  }
  const agentProjections = agentDefinitions.map((agent) => projectManagedAgentCatalogEntry(agent, routes));
  const agentCatalog = agentProjections.flatMap((projection) => projection.entry ? [projection.entry] : []);
  const agentHealth = agentProjections.flatMap((projection) => projection.health ? [projection.health] : []);

  const unavailableRoutes = routeHealth
    .filter((route) => !route.available)
    .map((route) => ({
      routeId: route.routeId,
      routeSource: route.routeSource,
      providerId: route.provider,
      ...(route.model ? { model: route.model } : {}),
      profiles: route.profiles,
      reason: route.reason ?? "Route is unavailable.",
    }));
  const shouldExposeManagedInvocation = routes.length > 0
    || (context.includeUnavailableRoutes === true && unavailableRoutes.length > 0);
  const invocationService = createManagedInvocationService(
    config,
    context.cwd,
    context.invocationService,
    context.invocationServiceKey,
  );
  const invocationServiceKey = managedInvocationServiceKey(config, context.cwd);

  return {
    routeHealth,
    ...(agentHealth.length > 0 ? { agentHealth } : {}),
    ...(shouldExposeManagedInvocation ? {
      managedInvocation: {
        routes,
        maxParallelChildren: context.maxParallelChildren ?? 1,
        ...(context.orchestrationBudgetAdmission
          ? { orchestrationBudgetAdmission: context.orchestrationBudgetAdmission }
          : {}),
        ...(agentCatalog.length > 0 ? { agentCatalog } : {}),
        ...(skillCatalog.length > 0 ? { skillCatalog } : {}),
        ...(unavailableRoutes.length > 0 ? { unavailableRoutes } : {}),
        requestedBy: "assistant",
        requestSource: context.surface,
        ...(context.artifactStore ? { artifactStore: context.artifactStore } : {}),
        ...(invocationService ? { invocationService } : {}),
        ...(invocationService && invocationServiceKey ? { invocationServiceKey } : {}),
        contextResolver: createManagedInvocationContextResolver(context.cwd, userHome, {
          skillConfig: config.skills,
          modelTaskSuitability: config.modelTaskSuitability,
        }),
      },
    } : {}),
  };
}

function createManagedRouteResolutionStartupMarker(): (phase: string, detail?: Record<string, unknown>) => void {
  const startedAt = performance.now();
  return (phase, detail) => {
    if (process.env.KILN_STARTUP_PROFILE !== "1") {
      return;
    }
    process.stderr.write(`KILN_STARTUP_PROFILE ${JSON.stringify({
      type: "kiln_startup_profile",
      surface: "managed-agent-route-resolution",
      phase,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...(detail ? { detail } : {}),
    })}\n`);
  };
}

function projectManagedAgentCatalogEntry(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): { readonly entry?: ManagedInvocationAgentCatalogEntry; readonly health?: ManagedAgentProfileHealth } {
  const explicitRouteHealth = validateExplicitAgentRoute(agent, routes);
  if (explicitRouteHealth) {
    return { health: explicitRouteHealth };
  }
  const routeHint = resolveAgentRouteHint(agent, routes);
  return {
    entry: {
      name: agent.name,
      ...(agent.displayName ? { displayName: agent.displayName } : {}),
      ...(agent.nicknameCandidates ? { nicknameCandidates: agent.nicknameCandidates } : {}),
      role: agent.role,
      goal: agent.goal,
      tier: agent.tier,
      ...(agent.authorityProfile ? { authorityProfile: agent.authorityProfile } : {}),
      ...(agent.skills ? { skills: agent.skills } : {}),
      ...(agent.taskAffinity ? { taskAffinity: agent.taskAffinity } : {}),
      ...(routeHint?.routeId ? { routeId: routeHint.routeId } : {}),
      ...(routeHint?.providerRoute ? { providerRoute: routeHint.providerRoute } : {}),
      ...(agent.voiceProfile ? { voiceProfile: agent.voiceProfile } : {}),
    },
  };
}

function validateExplicitAgentRoute(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): ManagedAgentProfileHealth | undefined {
  if (!agent.routeId && !agent.providerRoute) {
    return undefined;
  }
  const route = routeFromExplicitAgentHint(agent, routes);
  if (!route) {
    const routeDescription = agent.routeId
      ? `route '${agent.routeId}'`
      : `provider '${agent.providerRoute?.providerId}'${agent.providerRoute?.model ? ` model '${agent.providerRoute.model}'` : ""}`;
    return {
      agentName: agent.name,
      available: false,
      ...(agent.routeId ? { routeId: agent.routeId } : {}),
      reason: `Agent references unavailable managed ${routeDescription}.`,
    };
  }
  if (agent.providerRoute?.providerId && agent.providerRoute.providerId !== route.providerId) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent provider '${agent.providerRoute.providerId}' does not match route provider '${route.providerId}'.`,
    };
  }
  if (agent.providerRoute?.model && agent.providerRoute.model !== route.model) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent model '${agent.providerRoute.model}' does not match route model '${route.model ?? "unspecified"}'.`,
    };
  }
  if (agent.authorityProfile && !route.profiles[agent.authorityProfile]) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent authority profile '${agent.authorityProfile}' is not admitted by route '${route.routeId}'.`,
    };
  }
  const routeTools = new Set(Object.values(route.profiles).flatMap((profile) => profile?.allowedToolNames ?? []));
  const missingTools = (agent.tools ?? []).filter((tool) => !routeTools.has(tool));
  if (missingTools.length > 0) {
    return {
      agentName: agent.name,
      available: false,
      routeId: route.routeId,
      reason: `Agent tools are not admitted by route '${route.routeId}': ${missingTools.join(", ")}.`,
    };
  }
  return undefined;
}

function resolveAgentRouteHint(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): Pick<ManagedInvocationAgentCatalogEntry, "routeId" | "providerRoute"> | undefined {
  const explicit = routeFromExplicitAgentHint(agent, routes);
  if (explicit) {
    return routeHint(explicit, agent);
  }
  const scored = routes
    .map((route, index) => ({
      route,
      index,
      score: scoreAgentRoute(agent, route),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = scored[0]?.route;
  return selected ? routeHint(selected, agent) : undefined;
}

function routeFromExplicitAgentHint(
  agent: KilnAgentDefinition,
  routes: readonly ManagedInvocationToolRoute[],
): ManagedInvocationToolRoute | undefined {
  if (agent.routeId) {
    return routes.find((route) => route.routeId === agent.routeId);
  }
  if (agent.providerRoute) {
    return routes.find((route) =>
      route.providerId === agent.providerRoute?.providerId
      && (!agent.providerRoute.model || route.model === agent.providerRoute.model)
    );
  }
  return undefined;
}

function routeHint(
  route: ManagedInvocationToolRoute,
  agent: KilnAgentDefinition,
): Pick<ManagedInvocationAgentCatalogEntry, "routeId" | "providerRoute"> {
  return {
    routeId: route.routeId,
    providerRoute: {
      providerId: route.providerId,
      ...(route.model ? { model: route.model } : {}),
      ...(agent.providerRoute?.reasoningEffort ? { reasoningEffort: agent.providerRoute.reasoningEffort } : {}),
    },
  };
}

function scoreAgentRoute(agent: KilnAgentDefinition, route: ManagedInvocationToolRoute): number {
  let score = 0;
  const normalizedRouteId = route.routeId.toLowerCase();
  const normalizedAgentName = agent.name.toLowerCase();
  if (normalizedRouteId.includes(normalizedAgentName)) {
    score += 100;
  }
  for (const alias of [agent.displayName, ...(agent.nicknameCandidates ?? [])]) {
    if (alias && normalizedRouteId.includes(alias.toLowerCase())) {
      score += 60;
    }
  }
  for (const affinity of agent.taskAffinity ?? []) {
    const suitability = route.taskSuitability?.find((entry) => entry.task === affinity);
    if (!suitability) {
      continue;
    }
    if (suitability.level === "preferred") {
      score += 30;
    } else if (suitability.level === "capable") {
      score += 20;
    } else if (suitability.level === "limited") {
      score += 5;
    }
  }
  return score;
}

export function createManagedInvocationToolOptionsCatalog(
  initial: ManagedInvocationToolOptions,
): ManagedInvocationToolOptionsCatalog {
  let current = initial;
  return {
    options: {
      get routes() {
        return current.routes;
      },
      get unavailableRoutes() {
        return current.unavailableRoutes;
      },
      get agentCatalog() {
        return current.agentCatalog;
      },
      get skillCatalog() {
        return current.skillCatalog;
      },
      get requestedBy() {
        return current.requestedBy;
      },
      get requestSource() {
        return current.requestSource;
      },
      get artifactStore() {
        return current.artifactStore;
      },
      get invocationService() {
        return current.invocationService;
      },
      get invocationServiceKey() {
        return current.invocationServiceKey;
      },
      get sessionEventSink() {
        return current.sessionEventSink;
      },
      get contextResolver() {
        return current.contextResolver;
      },
      get maxParallelChildren() {
        return current.maxParallelChildren;
      },
      get orchestrationBudgetAdmission() {
        return current.orchestrationBudgetAdmission;
      },
    },
    update(next: ManagedInvocationToolOptions) {
      current = next;
    },
  };
}

function loadManagedInvocationSkillCatalog(
  projectPath: string,
  userHome: string,
  skillConfig: KilnYamlSkillsConfig | undefined,
): readonly ManagedSkillCatalogEntry[] {
  const catalog = readSkillCatalogStatus({ projectPath, userHome, skillConfig });
  return catalog.entries
    .map((skill): ManagedSkillCatalogEntry => ({
      name: skill.name,
      description: skill.description,
      origin: skill.origin,
      configured: skill.configured,
      builtIn: skill.builtIn,
      sourcePath: skill.sourcePath,
      admission: skill.admission,
      projections: skill.projections.map((projection) => ({
        target: projection.target,
        status: projection.status,
        path: projection.path,
      })),
      ...(skill.omissionReason ? { omissionReason: skill.omissionReason } : {}),
      ...(skill.tags && skill.tags.length > 0 ? { tags: skill.tags } : {}),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function resolveRouteConfigs(
  config: ManagedAgentRouteConfigSource,
): readonly ManagedAgentRouteConfigProjection[] {
  const managedAgents = config.managedAgents;
  const routingRoutes = synthesizeRoutesFromRouting(config)
    .map((routeConfig) => projectedRoute(routeConfig, "ordered-routing"));
  const explicitRoutes = (managedAgents?.routes ?? [])
    .map((routeConfig) => projectedRoute(routeConfig, "explicit-managed-route"));
  if (routingRoutes.length > 0 || explicitRoutes.length > 0) {
    return mergeDerivedAndExplicitRoutes(routingRoutes, explicitRoutes);
  }
  if (managedAgents?.enabled === true) {
    return [projectedRoute(synthesizeDefaultRoute(managedAgents), "managed-default-route")];
  }
  const route = synthesizeRouteFromEnabledEngines(config);
  return route ? [projectedRoute(route, "enabled-engine-fallback")] : [];
}

function projectedRoute(
  routeConfig: KilnManagedAgentRouteConfig,
  routeSource: ManagedAgentRouteSource,
): ManagedAgentRouteConfigProjection {
  return { routeConfig, routeSource };
}

function managedAgentVoiceProfile(
  routeConfig: KilnManagedAgentRouteConfig,
  config: ManagedAgentRouteConfigSource,
): string | undefined {
  return routeConfig.voiceProfile ?? config.managedAgents?.defaultVoiceProfile;
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
  const routingRoutes = config.routing?.routes;
  if (!routingRoutes) {
    return [];
  }
  const providerCounts = countRoutingProviders(routingRoutes);
  const routes = routingRoutes
    .map((route) => synthesizeRouteFromRoutingCandidate(route, config, providerCounts))
    .filter((route): route is KilnManagedAgentRouteConfig => route !== undefined);
  return dedupeRouteConfigs(routes);
}

function synthesizeRouteFromRoutingCandidate(
  route: { readonly provider: string; readonly model?: string },
  config: ManagedAgentRouteConfigSource,
  providerCounts: ReadonlyMap<string, number>,
): KilnManagedAgentRouteConfig | undefined {
  const provider = route.provider.trim();
  if (!provider) {
    return undefined;
  }
  if (!SUPPORTED_HARNESS_PROVIDERS.has(provider) && !isDirectProviderId(provider)) {
    return undefined;
  }
  const model = route.model ?? config.models?.[provider];
  return synthesizeReadonlyRoute({
    provider,
    model,
    profile: READONLY_PROFILE,
    routeId: providerCounts.get(provider) && providerCounts.get(provider)! > 1 && model
      ? `${provider}-${slugRouteIdSegment(model)}-readonly`
      : undefined,
  });
}

function countRoutingProviders(
  routes: readonly { readonly provider: string }[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const route of routes) {
    const provider = route.provider.trim();
    if (!provider) {
      continue;
    }
    counts.set(provider, (counts.get(provider) ?? 0) + 1);
  }
  return counts;
}

function mergeDerivedAndExplicitRoutes(
  derivedRoutes: readonly ManagedAgentRouteConfigProjection[],
  explicitRoutes: readonly ManagedAgentRouteConfigProjection[],
): readonly ManagedAgentRouteConfigProjection[] {
  if (explicitRoutes.length === 0) {
    return derivedRoutes;
  }
  if (derivedRoutes.length === 0) {
    return explicitRoutes;
  }
  const explicitRouteIds = new Set(explicitRoutes.map((route) => route.routeConfig.id));
  return [
    ...derivedRoutes.filter((route) => !explicitRouteIds.has(route.routeConfig.id)),
    ...explicitRoutes,
  ];
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
  readonly routeId?: string;
}): KilnManagedAgentRouteConfig {
  const { provider } = input;
  return {
    id: input.routeId ?? `${provider}-readonly`,
    kind: SUPPORTED_HARNESS_PROVIDERS.has(provider) ? "harness" : "direct",
    provider,
    model: input.model ?? DEFAULT_MODELS[provider],
    profiles: [input.profile ?? READONLY_PROFILE],
    workingDirectory: "project",
    tools: {
      allowed: DEFAULT_ALLOWED_TOOLS,
      network: false,
      writes: false,
    },
    memory: { access: "read-only" },
    credentials: { mode: "runtime-selected" },
  };
}

function slugRouteIdSegment(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "model";
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
  projection: ManagedAgentRouteConfigProjection,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  const { routeConfig, routeSource } = projection;
  const profiles = normalizeProfiles(routeConfig.profiles);
  const baseHealth = {
    routeId: routeConfig.id,
    routeSource,
    kind: routeConfig.kind,
    provider: routeConfig.provider,
    ...(routeConfig.model ? { model: routeConfig.model } : {}),
    profiles,
  };

  const writeRequired = routeRequiresWriteAuthority(routeConfig, profiles);
  if (writeRequired && routeConfig.writeAuthority === undefined) {
    return unhealthy(baseHealth, "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.");
  }

  if (config.engines?.[routeConfig.provider]?.enabled === false) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is disabled in engine config.`);
  }

  if (routeConfig.kind !== "harness" && routeConfig.kind !== "direct") {
    return unhealthy(baseHealth, `Unsupported managed invocation route kind '${routeConfig.kind}'.`);
  }

  if (routeConfig.kind === "direct") {
    return resolveDirectRouteConfig(routeConfig, context, config, baseHealth, writeRequired);
  }

  if (routeConfig.remoteHarness !== undefined) {
    return resolveRemoteHarnessRouteConfig(routeConfig, context, config, baseHealth, writeRequired);
  }

  if (routeConfig.workingDirectory === "sandbox") {
    return unhealthy(baseHealth, "Harness sandbox working-directory routes require live-proven sandbox enforcement.");
  }

  if (!SUPPORTED_HARNESS_PROVIDERS.has(routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' does not have a live-proven managed harness adapter.`);
  }
  if (writeRequired && !LIVE_PROVEN_WRITE_HARNESS_PROVIDERS.has(routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' does not have live-proven write evidence support.`);
  }

  if (!isProviderAvailable(context, routeConfig.provider)) {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' is unavailable.`);
  }

  const model = routeConfig.model ?? DEFAULT_MODELS[routeConfig.provider];
  if (!model) {
    return unhealthy(baseHealth, `Managed invocation route '${routeConfig.id}' requires a model.`);
  }
  const catalogEntry = resolveManagedProviderModelCatalogEntry(context, routeConfig.provider, model);
  if (catalogEntry.status === "pending") {
    return unhealthy(baseHealth, `Provider '${routeConfig.provider}' model eligibility evidence is pending.`);
  }
  if (catalogEntry.status === "ineligible") {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, undefined));
  }
  if (!supportsReadonlyResultHandoff(routeConfig.provider, model)) {
    return unhealthy(
      baseHealth,
      `Provider '${routeConfig.provider}' model '${model}' does not have live-proven read-only managed result handoff support for foundation-readonly-plan.`,
    );
  }
  const canonicalAdmission = deriveCanonicalManagedRouteAdmission(catalogEntry.entry, routeConfig, model);
  if (!canonicalAdmission.eligible) {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, canonicalAdmission));
  }

  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, profiles, config.managedAgents?.worktreeLease);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const builtinToolsProvider = createManagedRouteBuiltinToolsProvider(context);
  const adapter = new ManagedCliHarnessAdapter({
    providerId: routeConfig.provider,
    model,
    factory: createHarnessSessionFactory(routeConfig.provider as ProviderId, model, context),
    ...(writeRequired ? { writeAuthority: LIVE_PROVEN_HARNESS_WRITE_AUTHORITY } : {}),
    ...(builtinToolsProvider ? { builtinToolsProvider } : {}),
  });
  const voiceProfile = managedAgentVoiceProfile(routeConfig, config);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    adapter,
    surface: "cli-harness",
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      liveProofEvidence(routeConfig.provider, model, profiles),
    ),
    profiles: profileResolution.profiles,
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

async function resolveRemoteHarnessRouteConfig(
  routeConfig: KilnManagedAgentRouteConfig,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  writeRequired: boolean,
): Promise<{
  readonly health: ManagedAgentRouteHealth;
  readonly route?: ManagedInvocationToolRoute;
}> {
  if (writeRequired) {
    return unhealthy(baseHealth, "Remote harness managed invocation routes currently support foundation-readonly-plan only.");
  }
  const remoteHarness = routeConfig.remoteHarness;
  if (remoteHarness === undefined) {
    return unhealthy(baseHealth, "Remote harness route requires remoteHarness endpoint config.");
  }
  const model = routeConfig.model;
  if (!model) {
    return unhealthy(baseHealth, `Remote harness managed invocation route '${routeConfig.id}' requires a model.`);
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, normalizeProfiles(routeConfig.profiles), config.managedAgents?.worktreeLease);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const adapter = new ManagedRemoteHarnessAdapter({
    providerId: routeConfig.provider,
    model,
    invokeUrl: remoteHarness.invokeUrl,
    cancelUrl: remoteHarness.cancelUrl,
    ...(remoteHarness.authTokenEnv ? { authTokenEnv: remoteHarness.authTokenEnv } : {}),
    ...(remoteHarness.limitations ? { limitations: remoteHarness.limitations } : {}),
  });
  const voiceProfile = managedAgentVoiceProfile(routeConfig, config);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    routeSource: baseHealth.routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    adapter,
    surface: "remote-harness",
    providerModelProof: {
      status: "configured",
      source: "remote-harness-config",
      requiresToolCalls: false,
    },
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      remoteHarnessEvidence(routeConfig.provider, model, normalizeProfiles(routeConfig.profiles)),
    ),
    profiles: profileResolution.profiles,
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

function routeRequiresWriteAuthority(
  routeConfig: KilnManagedAgentRouteConfig,
  profiles: readonly ManagedAgentAdmissionProfile[],
): boolean {
  return routeConfig.tools?.writes === true
    || profiles.some((profile) => WRITE_PROFILES.has(profile as KilnManagedAgentProfile));
}

function buildRouteProfiles(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  profiles: readonly ManagedAgentAdmissionProfile[],
  worktreeLeaseConfig: KilnManagedAgentsConfig["worktreeLease"] | undefined,
): {
  readonly ok: true;
  readonly profiles: ManagedInvocationToolRoute["profiles"];
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const workingDirectoryLease = resolveWorkingDirectoryLease(routeConfig, cwd, worktreeLeaseConfig);
  if (!workingDirectoryLease.ok) {
    return workingDirectoryLease;
  }
  const resolved: ManagedInvocationToolRoute["profiles"] = {};
  for (const profile of profiles) {
    if (profile === READONLY_PROFILE) {
      resolved[profile] = buildReadonlyProfile(routeConfig, cwd, workingDirectoryLease.lease);
      continue;
    }
    if (profile === "foundation-propose-writes" || profile === "foundation-apply-approved-writes" || profile === "foundation-memory-write-proposals") {
      const writeProfile = buildWriteProfile(routeConfig, cwd, profile, workingDirectoryLease.lease);
      if (!writeProfile.ok) {
        return writeProfile;
      }
      resolved[profile] = writeProfile.profile;
      continue;
    }
    return {
      ok: false,
      reason: `Managed invocation profile '${profile}' is not supported by route projection.`,
    };
  }
  return { ok: true, profiles: resolved };
}

function resolveRouteTimeout(routeConfig: KilnManagedAgentRouteConfig): {
  readonly timeoutMs: number;
  readonly source: NonNullable<ManagedAgentAuthorityProfile["timeoutSource"]>;
} {
  return {
    timeoutMs: routeConfig.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    source: routeConfig.timeoutMs === undefined ? "default" : "explicit-route",
  };
}

function buildReadonlyProfile(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedInvocationRouteProfile {
  const timeout = resolveRouteTimeout(routeConfig);
  return {
    authorityProfileId: `authority:${routeConfig.id}:${READONLY_PROFILE}`,
    permissionProfile: "read-only",
    allowedToolNames: routeConfig.tools?.allowed ?? DEFAULT_ALLOWED_TOOLS,
    writeAllowed: false,
    networkAllowed: routeConfig.tools?.network === true,
    workingDirectory: resolveWorkingDirectory(routeConfig, cwd, workingDirectoryLease),
    ...(workingDirectoryLease ? { workingDirectoryLease } : {}),
    timeoutMs: timeout.timeoutMs,
    timeoutSource: timeout.source,
    credentialRoute: resolveCredentialRoute(routeConfig),
    memoryScope: resolveMemoryScope(routeConfig, cwd),
    ...(routeConfig.readAuthority
      ? { readAuthority: buildReadAuthority(routeConfig, cwd) }
      : {}),
  };
}

function buildReadAuthority(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
): ManagedAgentAuthorityProfile["readAuthority"] {
  const allowedPaths = normalizeManagedRoutePaths(routeConfig.readAuthority?.workspace?.allowedPaths ?? [], cwd);
  return defineManagedAgentReadAuthority({
    workspace: {
      allowedPaths,
      deniedPaths: uniqueStrings([
        ...normalizeManagedRoutePaths(routeConfig.readAuthority?.workspace?.deniedPaths ?? [], cwd),
        ...defaultManagedWorkspaceDeniedPaths(cwd, allowedPaths),
      ]),
    },
  });
}

function buildWriteProfile(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  profile: Exclude<KilnManagedAgentProfile, "foundation-readonly-plan">,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): {
  readonly ok: true;
  readonly profile: ManagedInvocationRouteProfile;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const networkEnabled = (routeConfig.tools as { readonly network?: boolean } | undefined)?.network === true;
  if (networkEnabled) {
    return {
      ok: false,
      reason: `${profile} routes cannot enable tools.network. Use a separate foundation-readonly-plan route for web, browser, computer-use, or visual-reference research phases.`,
    };
  }
  const writeAuthority = buildWriteAuthority(routeConfig, cwd, profile);
  if (!writeAuthority.ok) {
    return writeAuthority;
  }
  const applyApproved = profile === "foundation-apply-approved-writes";
  const timeout = resolveRouteTimeout(routeConfig);
  return {
    ok: true,
    profile: {
      authorityProfileId: `authority:${routeConfig.id}:${profile}`,
      permissionProfile: applyApproved ? "apply-approved-writes" : "propose-writes",
      allowedToolNames: routeConfig.tools?.allowed ?? (applyApproved ? DEFAULT_WRITE_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
      writeAllowed: applyApproved,
      networkAllowed: routeConfig.tools?.network === true,
      workingDirectory: resolveWriteWorkingDirectory(routeConfig, cwd, applyApproved, workingDirectoryLease),
      ...(workingDirectoryLease ? { workingDirectoryLease } : {}),
      timeoutMs: timeout.timeoutMs,
      timeoutSource: timeout.source,
      credentialRoute: resolveCredentialRoute(routeConfig),
      memoryScope: resolveMemoryScope(routeConfig, cwd, writeAuthority.authority.scope.memory.mode === "propose" ? "write-proposals" : undefined),
      writeAuthority: writeAuthority.authority,
    },
  };
}

function buildWriteAuthority(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  profile: Exclude<KilnManagedAgentProfile, "foundation-readonly-plan">,
): {
  readonly ok: true;
  readonly authority: NonNullable<ManagedAgentAuthorityProfile["writeAuthority"]>;
} | {
  readonly ok: false;
  readonly reason: string;
} {
  const config = routeConfig.writeAuthority;
  if (!config) {
    return {
      ok: false,
      reason: "Write-capable managed invocation routes require explicit writeAuthority scope and approval config.",
    };
  }
  const applyApproved = profile === "foundation-apply-approved-writes";
  const memoryOnly = profile === "foundation-memory-write-proposals";
  const configuredWorkspaceMode = config.workspace?.mode;
  const workspaceMode = memoryOnly
    ? "none"
    : applyApproved
      ? "apply-approved"
      : configuredWorkspaceMode ?? "propose";
  if (applyApproved && configuredWorkspaceMode !== undefined && configuredWorkspaceMode !== "apply-approved") {
    return {
      ok: false,
      reason: "foundation-apply-approved-writes routes require writeAuthority.workspace.mode apply-approved.",
    };
  }
  if (!applyApproved && configuredWorkspaceMode === "apply-approved") {
    return {
      ok: false,
      reason: `${profile} routes cannot use writeAuthority.workspace.mode apply-approved.`,
    };
  }
  const allowedWorkspacePaths = normalizeManagedRoutePaths(config.workspace?.allowedPaths ?? [], cwd);
  if (workspaceMode !== "none" && allowedWorkspacePaths.length === 0) {
    return {
      ok: false,
      reason: "Workspace write-capable managed invocation routes require at least one writeAuthority.workspace.allowedPaths entry.",
    };
  }
  if (
    routeConfig.workingDirectory === "isolated-worktree"
    && allowedWorkspacePaths.some((path) => !isPathWithinOrEqual(cwd, path))
  ) {
    return {
      ok: false,
      reason: "isolated-worktree write routes require writeAuthority.workspace.allowedPaths to stay inside the repository root.",
    };
  }
  const memoryMode = profile === "foundation-memory-write-proposals"
    ? "propose"
    : config.memory?.mode ?? "none";
  if (profile === "foundation-memory-write-proposals" && config.memory?.mode !== undefined && config.memory.mode !== "propose") {
    return {
      ok: false,
      reason: "foundation-memory-write-proposals routes require writeAuthority.memory.mode propose.",
    };
  }
  const artifactMode = config.artifacts?.mode ?? "none";
  if (!config.approval || (config.approval.mode !== "required-before-apply" && config.approval.mode !== "policy-approved")) {
    return {
      ok: false,
      reason: "Write-capable managed invocation routes require approval.mode required-before-apply or policy-approved.",
    };
  }

  return {
    ok: true,
    authority: defineManagedAgentWriteAuthority({
      profile,
      scope: defineManagedAgentWriteScope({
        workspace: {
          mode: workspaceMode,
          allowedPaths: workspaceMode === "none" ? [] : allowedWorkspacePaths,
          deniedPaths: workspaceMode === "none"
            ? []
            : uniqueStrings([
              ...normalizeManagedRoutePaths(config.workspace?.deniedPaths ?? [], cwd),
              ...defaultManagedWorkspaceDeniedPaths(cwd, allowedWorkspacePaths),
            ]),
        },
        memory: {
          mode: memoryMode,
          ...(memoryMode === "propose" ? { scope: { kind: "project" as const, id: basename(cwd.replace(/\\/g, "/")) || "project" } } : {}),
          operations: memoryMode === "propose" ? config.memory?.operations ?? ["create", "update"] : [],
        },
        artifacts: {
          mode: artifactMode,
          resourceUris: artifactMode === "none" ? [] : config.artifacts?.resourceUris ?? [],
          retention: config.artifacts?.retention ?? "none",
        },
        tools: {
          allowedToolNames: config.tools?.allowed ?? routeConfig.tools?.allowed ?? (applyApproved ? DEFAULT_WRITE_ALLOWED_TOOLS : DEFAULT_ALLOWED_TOOLS),
          deniedToolNames: config.tools?.denied ?? [],
        },
      }),
      approval: {
        mode: config.approval.mode,
        evidenceRequired: true,
        ...(config.approval.approver ? { approver: config.approval.approver } : {}),
        ...(config.approval.evidenceUris ? { evidenceUris: config.approval.evidenceUris } : {}),
      },
    }),
  };
}

function createManagedRouteBuiltinToolsProvider(
  context: ResolveManagedInvocationToolOptionsContext,
): (() => ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>["callBuiltinTools"]) | undefined {
  const source = context.builtinToolOptions;
  if (!source) {
    return undefined;
  }
  return () => {
    const builtinToolOptions = resolveBuiltinToolOptions(source);
    return createAttachedRuntimeBuiltinToolSurface(
      builtinToolOptions ? { builtinToolOptions } : {},
    ).callBuiltinTools;
  };
}

function resolveBuiltinToolOptions(
  source: BuiltinToolOptionsSource,
): DefaultBuiltinToolRegistryOptions | undefined {
  return typeof source === "function" ? source() : source;
}

async function resolveDirectRouteConfig(
  routeConfig: KilnManagedAgentRouteConfig,
  context: ResolveManagedInvocationToolOptionsContext,
  config: ManagedAgentRouteConfigSource,
  baseHealth: Omit<ManagedAgentRouteHealth, "available" | "reason">,
  writeRequired: boolean,
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
  const catalogEntry = resolveManagedProviderModelCatalogEntry(context, routeConfig.provider, model);
  if (catalogEntry.status === "pending") {
    return unhealthy(baseHealth, `Provider/model eligibility evidence is pending for direct managed invocation route '${routeConfig.id}'.`);
  }
  if (catalogEntry.status === "ineligible") {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, undefined));
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
  if (writeRequired) {
    const writeSupport = validateDirectAdapterWriteSupport(adapter, normalizeProfiles(routeConfig.profiles));
    if (!writeSupport.ok) {
      return unhealthy(baseHealth, writeSupport.reason);
    }
  }
  const canonicalAdmission = deriveCanonicalManagedRouteAdmission(catalogEntry.entry, routeConfig, model);
  if (!canonicalAdmission.eligible) {
    return unhealthy(baseHealth, managedEligibilityUnavailableReason(routeConfig.provider, model, canonicalAdmission));
  }
  const profileResolution = buildRouteProfiles(routeConfig, context.cwd, normalizeProfiles(routeConfig.profiles), config.managedAgents?.worktreeLease);
  if (!profileResolution.ok) {
    return unhealthy(baseHealth, profileResolution.reason);
  }
  const voiceProfile = managedAgentVoiceProfile(routeConfig, config);
  const route: ManagedInvocationToolRoute = {
    routeId: routeConfig.id,
    routeSource: baseHealth.routeSource,
    providerId: routeConfig.provider,
    model,
    ...(voiceProfile ? { voiceProfile } : {}),
    adapter,
    surface: "direct-provider",
    taskSuitability: resolveTaskSuitability(
      routeConfig.provider,
      model,
      config.modelTaskSuitability,
      liveProofEvidence(routeConfig.provider, model, normalizeProfiles(routeConfig.profiles)),
    ),
    profiles: profileResolution.profiles,
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

function validateDirectAdapterWriteSupport(
  adapter: ManagedAgentRuntimeAdapter,
  profiles: readonly ManagedAgentAdmissionProfile[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const unsupportedProfile = profiles.find((profile) => !adapter.descriptor.supportedProfiles.includes(profile));
  if (unsupportedProfile !== undefined) {
    return {
      ok: false,
      reason: `Direct managed invocation adapter does not support profile '${unsupportedProfile}'.`,
    };
  }

  const writeAuthority = adapter.descriptor.writeAuthority;
  if (
    writeAuthority?.proposalSupported !== true
    || writeAuthority.approvedApplySupported !== true
    || writeAuthority.memoryProposalSupported !== true
    || writeAuthority.rollbackEvidence !== true
    || writeAuthority.cleanupEvidence !== true
    || writeAuthority.scopeReduction !== true
  ) {
    return {
      ok: false,
      reason: "Direct managed invocation adapter does not have live-proven write evidence support.",
    };
  }

  return { ok: true };
}

function resolveTaskSuitability(
  provider: string,
  model: string,
  overrides: readonly KilnModelTaskSuitabilityOverride[] | undefined,
  liveProof: ModelTaskSuitabilityEvidence | undefined,
): ReturnType<typeof resolveConfiguredModelTaskSuitability> {
  return resolveConfiguredModelTaskSuitability({
    provider,
    model,
    overrides,
    liveProof,
  });
}

function liveProofEvidence(
  provider: string,
  model: string,
  profiles: readonly ManagedAgentAdmissionProfile[],
): ModelTaskSuitabilityEvidence {
  return {
    source: "live-proof",
    status: "observed",
    summary: `Managed invocation route for ${provider}/${model} is available with live-proven profiles: ${profiles.join(", ")}.`,
  };
}

function remoteHarnessEvidence(
  provider: string,
  model: string,
  profiles: readonly ManagedAgentAdmissionProfile[],
): ModelTaskSuitabilityEvidence {
  return {
    source: "configured-route",
    status: "declared",
    summary: `Remote harness managed invocation route for ${provider}/${model} is endpoint-configured with admitted profiles: ${profiles.join(", ")}.`,
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

function resolveManagedProviderModelCatalogEntry(
  context: ResolveManagedInvocationToolOptionsContext,
  providerId: string,
  model: string,
): {
  readonly status: "available";
  readonly entry: ManagedAgentProviderModelCatalogDiagnostic;
} | {
  readonly status: "ineligible";
} | {
  readonly status: "pending";
} {
  if (!context.providerModelEligibility) {
    return { status: "pending" };
  }
  const providerEligibility = context.providerModelEligibility?.[providerId];
  if (providerEligibility === undefined) {
    return { status: "pending" };
  }
  const entry = providerEligibility?.[model];
  if (!entry) {
    return { status: "ineligible" };
  }
  return { status: "available", entry };
}

function deriveCanonicalManagedRouteAdmission(
  entry: ManagedAgentProviderModelCatalogDiagnostic,
  routeConfig: KilnManagedAgentRouteConfig,
  model: string,
): ProviderModelEligibilityDecision {
  return deriveProviderModelEligibility(
    managedRouteEvidence(entry.catalogDiagnosticEvidence, routeConfig, model),
    managedRouteEligibilityRequirements(new Date().toISOString()),
    [],
  );
}

function managedEligibilityUnavailableReason(
  providerId: string,
  model: string,
  decision: ProviderModelEligibilityDecision | undefined,
): string {
  if (!decision) {
    return `Provider '${providerId}' has no eligible managed-agent decision for model '${model}'.`;
  }
  const reasons = decision.reasons.length > 0 ? decision.reasons.join(", ") : "unknown";
  return `Provider '${providerId}' model '${model}' is not eligible for managed invocation: ${reasons}.`;
}

function managedRouteEligibilityRequirements(evaluatedAt: string): ProviderModelEligibilityRequirements {
  return {
    use: "managed-agent",
    evaluatedAt,
    requiredStates: [
      "discovered",
      "configured",
      "authenticated",
      "capabilityCompatible",
      "policyAdmitted",
      "routeHealthy",
    ],
    requiredCapabilities: [],
    minimumCapabilityAuthority: "harness-reported",
    minimumStateAuthority: "harness-reported",
    requireProbe: false,
  };
}

function managedRouteEvidence(
  catalogDiagnosticEvidence: ProviderModelEvidence,
  routeConfig: KilnManagedAgentRouteConfig,
  model: string,
): ProviderModelEvidence {
  const observedAt = new Date().toISOString();
  const routeObservations = [
    managedRouteObservation("configured", "confirmed", "operator-declared", routeConfig.id, observedAt),
    managedRouteObservation("authenticated", "confirmed", "runtime-observed", routeConfig.provider, observedAt),
    managedRouteObservation("capabilityCompatible", "confirmed", "runtime-observed", routeConfig.id, observedAt),
    managedRouteObservation("policyAdmitted", "confirmed", "operator-declared", routeConfig.id, observedAt),
    managedRouteObservation("routeHealthy", "confirmed", "runtime-observed", routeConfig.id, observedAt),
  ];
  return createProviderModelEvidence({
    identity: {
      ...catalogDiagnosticEvidence.identity,
      route: {
        providerId: routeConfig.provider,
        providerModelId: model,
        scope: catalogDiagnosticEvidence.identity.route.scope,
      },
    },
    aliases: catalogDiagnosticEvidence.aliases,
    states: {
      ...catalogDiagnosticEvidence.states,
      configured: "confirmed",
      authenticated: "confirmed",
      capabilityCompatible: "confirmed",
      policyAdmitted: "confirmed",
      routeHealthy: "confirmed",
    },
    observations: [
      ...catalogDiagnosticEvidence.observations,
      ...routeObservations,
    ],
    failures: catalogDiagnosticEvidence.failures,
  });
}

function managedRouteObservation(
  state: ProviderModelEvidenceState,
  value: ProviderModelEvidenceValue,
  authority: ProviderModelEvidenceObservation["authority"],
  id: string,
  observedAt: string,
): ProviderModelEvidenceObservation {
  return {
    state,
    value,
    provenance: `managed-agent-route:${state}`,
    authority,
    source: {
      kind: "managed-agent-route",
      id,
    },
    observedAt,
    freshness: "fresh",
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
      permissionPolicy: factoryContext?.permissionPolicy ?? {
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

function createManagedInvocationService(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
  existingService: RuntimeManagedAgentInvocationService | undefined,
  existingServiceKey: string | undefined,
): RuntimeManagedAgentInvocationService | undefined {
  const serviceKey = managedInvocationServiceKey(config, cwd);
  if (!serviceKey) {
    return undefined;
  }
  if (existingService && existingServiceKey === serviceKey) {
    return existingService;
  }
  const leaseConfig = config.managedAgents?.worktreeLease;
  const routeConfigs = resolveRouteConfigs(config).map((route) => route.routeConfig);
  const needsWorktreeLease = leaseConfig !== undefined && routeConfigs.some((route) => route.workingDirectory === "isolated-worktree");
  const needsSandboxLease = routeConfigs.some(routeUsesRuntimeSandboxLease);
  const credentialRouteIds = collectRuntimeCredentialRouteIds(routeConfigs);

  return new RuntimeManagedAgentInvocationService({
    authorityObserver: createCliManagedRuntimeAuthorityObserver(),
    ...(needsWorktreeLease && leaseConfig ? {
      worktreeLeaseManager: new ManagedGitWorktreeLeaseManager({
        repositoryPath: cwd,
        worktreeRootPath: normalizeManagedRoutePath(leaseConfig.rootPath, cwd),
        ...(leaseConfig.ref ? { ref: leaseConfig.ref } : {}),
        ...(leaseConfig.gitBinary ? { gitBinary: leaseConfig.gitBinary } : {}),
      }),
    } : {}),
    ...(needsSandboxLease ? {
      sandboxLeaseManager: new ManagedRuntimeSandboxLeaseManager(),
    } : {}),
    ...(credentialRouteIds.length > 0 ? {
      credentialRouteLeaseManager: new ManagedRuntimeCredentialRouteLeaseManager({
        allowedRouteIds: credentialRouteIds,
      }),
    } : {}),
  });
}

function createCliManagedRuntimeAuthorityObserver(): ManagedAgentRuntimeAuthorityObserver {
  return {
    observe: async ({ request }) => {
      const observedAt = new Date();
      const validUntil = new Date(observedAt.getTime() + 60000);
      return {
        approval: observedApprovalForManagedAuthority(request.authority),
        sandbox: observedSandboxForManagedAuthority(request.authority),
        source: "runtime-observation",
        proof: "proven",
        observedAt: observedAt.toISOString(),
        validUntil: validUntil.toISOString(),
        reason: "CLI managed route was admitted by Kiln route resolution with live-proven managed invocation capability.",
      };
    },
  };
}

function observedApprovalForManagedAuthority(
  authority: ManagedAgentAuthorityProfile,
): "never" | "on-request" {
  const profile = authority.permissionProfile.toLowerCase();
  return profile.includes("trusted")
    || profile.includes("full-access")
    || profile.includes("danger-full-access")
    ? "never"
    : "on-request";
}

function observedSandboxForManagedAuthority(
  authority: ManagedAgentAuthorityProfile,
): "read-only" | "workspace-write" {
  return authority.toolAuthority.writeAllowed === true && authority.workingDirectory.mode !== "read-only"
    ? "workspace-write"
    : "read-only";
}

function managedInvocationServiceKey(
  config: ManagedAgentRouteConfigSource,
  cwd: string,
): string | undefined {
  const routeConfigs = resolveRouteConfigs(config).map((route) => route.routeConfig);
  const leaseConfig = config.managedAgents?.worktreeLease;
  const needsWorktreeLease = leaseConfig !== undefined && routeConfigs.some((route) => route.workingDirectory === "isolated-worktree");
  const needsSandboxLease = routeConfigs.some(routeUsesRuntimeSandboxLease);
  const credentialRouteIds = collectRuntimeCredentialRouteIds(routeConfigs);
  if (!needsWorktreeLease && !needsSandboxLease && credentialRouteIds.length === 0) {
    return undefined;
  }
  return JSON.stringify({
    ...(needsWorktreeLease && leaseConfig ? {
      worktreeLease: {
        mode: leaseConfig.mode,
        repositoryPath: normalizeManagedRoutePath(cwd, cwd),
        rootPath: normalizeManagedRoutePath(leaseConfig.rootPath, cwd),
        ref: leaseConfig.ref ?? "HEAD",
        gitBinary: leaseConfig.gitBinary ?? "git",
      },
    } : {}),
    ...(needsSandboxLease ? {
      sandboxPolicy: {
        mode: "kiln-tool-policy",
        rootPath: normalizeManagedRoutePath(cwd, cwd),
      },
    } : {}),
    ...(credentialRouteIds.length > 0 ? { credentialRouteIds } : {}),
  });
}

function routeUsesRuntimeSandboxLease(route: KilnManagedAgentRouteConfig): boolean {
  return route.workingDirectory === "sandbox"
    && (route.kind === "direct" || route.remoteHarness !== undefined);
}

function collectRuntimeCredentialRouteIds(
  routeConfigs: readonly KilnManagedAgentRouteConfig[],
): readonly string[] {
  const routeIds = new Set<string>();
  for (const routeConfig of routeConfigs) {
    const credentialRoute = resolveCredentialRoute(routeConfig);
    if (credentialRoute.mode === "runtime-selected") {
      routeIds.add(credentialRoute.routeId);
    }
  }
  return [...routeIds].sort((left, right) => left.localeCompare(right));
}

function resolveWorkingDirectory(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedAgentWorkingDirectory {
  if (routeConfig.workingDirectory === "isolated-worktree" && workingDirectoryLease) {
    return {
      path: workingDirectoryLease.rootPath,
      mode: "isolated-worktree",
    };
  }
  if (routeConfig.workingDirectory === "sandbox") {
    return {
      path: cwd,
      mode: "sandbox",
    };
  }
  return {
    path: cwd,
    mode: "read-only",
  };
}

function resolveWriteWorkingDirectory(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  applyApproved: boolean,
  workingDirectoryLease: ManagedInvocationRouteProfile["workingDirectoryLease"] | undefined,
): ManagedAgentWorkingDirectory {
  if (routeConfig.workingDirectory === "isolated-worktree" && workingDirectoryLease) {
    return {
      path: workingDirectoryLease.rootPath,
      mode: "isolated-worktree",
    };
  }
  if (routeConfig.workingDirectory === "sandbox") {
    return {
      path: cwd,
      mode: "sandbox",
    };
  }
  return {
    path: cwd,
    mode: applyApproved ? "workspace-write" : "read-only",
  };
}

function resolveWorkingDirectoryLease(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  config: KilnManagedAgentsConfig["worktreeLease"] | undefined,
): {
  readonly ok: true;
  readonly lease?: ManagedInvocationRouteProfile["workingDirectoryLease"];
} | {
  readonly ok: false;
  readonly reason: string;
} {
  if (routeConfig.workingDirectory !== "isolated-worktree") {
    return { ok: true };
  }
  if (!config) {
    return {
      ok: false,
      reason: "isolated-worktree managed invocation routes require managedAgents.worktreeLease.rootPath.",
    };
  }
  return {
    ok: true,
    lease: {
      mode: "git-worktree",
      sourcePath: cwd,
      rootPath: normalizeManagedRoutePath(config.rootPath, cwd),
    },
  };
}

function normalizeManagedRoutePaths(paths: readonly string[], cwd: string): readonly string[] {
  return paths.map((path) => normalizeManagedRoutePath(path, cwd));
}

function defaultManagedWorkspaceDeniedPaths(cwd: string, allowedPaths: readonly string[]): readonly string[] {
  return uniqueStrings([cwd, ...allowedPaths].flatMap((rootPath) =>
    DEFAULT_MANAGED_WORKSPACE_DENIED_ENTRIES.map((entry) => normalizeManagedRoutePath(joinManagedRoutePath(rootPath, entry), cwd))
  ));
}

function joinManagedRoutePath(rootPath: string, childPath: string): string {
  if (win32.isAbsolute(rootPath)) {
    return win32.join(rootPath, childPath);
  }
  if (posix.isAbsolute(rootPath)) {
    return posix.join(rootPath, childPath);
  }
  return resolve(rootPath, childPath);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}

function normalizeManagedRoutePath(path: string, cwd: string): string {
  if (win32.isAbsolute(path)) {
    return win32.normalize(path);
  }
  if (posix.isAbsolute(path)) {
    return posix.normalize(path);
  }
  if (win32.isAbsolute(cwd)) {
    return win32.resolve(cwd, path);
  }
  if (posix.isAbsolute(cwd)) {
    return posix.resolve(cwd, path);
  }
  return resolve(cwd, path);
}

function isPathWithinOrEqual(rootPath: string, candidatePath: string): boolean {
  const caseInsensitive = isCaseInsensitivePath(rootPath) || isCaseInsensitivePath(candidatePath);
  const root = normalizeComparablePath(rootPath, caseInsensitive);
  const candidate = normalizeComparablePath(candidatePath, caseInsensitive);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function normalizeComparablePath(path: string, caseInsensitive: boolean): string {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  return caseInsensitive ? normalized.toLowerCase() : normalized;
}

function isCaseInsensitivePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

function resolveCredentialRoute(
  routeConfig: KilnManagedAgentRouteConfig,
): ManagedAgentCredentialRoute {
  if (routeConfig.credentials?.mode === "credentialless") {
    return { mode: "credentialless" };
  }
  const configuredRouteId = routeConfig.credentials?.mode === "runtime-selected"
    ? routeConfig.credentials.routeId?.trim()
    : undefined;
  return {
    mode: "runtime-selected",
    routeId: configuredRouteId
      ? configuredRouteId
      : `credential-route:${routeConfig.provider}:runtime-selected`,
  };
}

function resolveMemoryScope(
  routeConfig: KilnManagedAgentRouteConfig,
  cwd: string,
  accessOverride?: ManagedAgentMemoryScope["access"],
): ManagedAgentMemoryScope {
  return {
    scope: {
      kind: "project",
      id: basename(cwd.replace(/\\/g, "/")) || "project",
    },
    access: accessOverride ?? routeConfig.memory?.access ?? "read-only",
  };
}
