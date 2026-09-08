import { join } from "node:path";
import { admitManagedRoute } from "@kilnai/core";
import type {
  ExecutionTargetCatalog,
  CallerAuthorityProfile,
  ManagedAgentAccess,
  RouteAdmissionDecision,
  RouteAdmissionRejection,
} from "@kilnai/core";
import { loadKilnConfig, loadKilnConfigWithGlobalAuthority } from "./config-merger.js";
import { readGlobalExecutionTargetAuthority } from "./global-config.js";
import { resolveKilnHomePath } from "./global-config/path.js";
import { discoverManagedAgentProviderModels } from "./managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "./managed-agent-routes.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import type { ManagedInvocationRouteResolution } from "./managed-agent-routes.js";
import type { SessionRegistry } from "../wrapper/session-registry.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "./managed-agent-provider-models.js";
import type { KilnAuthorityProfileConfig } from "../kiln-yaml-types.js";
import type { ProjectStateBinding } from "../application/project-state-root.js";

type ManagedAgentAdmissionConfig = (Awaited<ReturnType<typeof loadKilnConfig>> & {
  readonly executionCatalog?: ExecutionTargetCatalog;
}) | null;

export interface ManagedAgentRouteAdmissionResolver {
  resolve(agent: KilnAgentDefinition): RouteAdmissionDecision | undefined;
}

export interface CreateManagedAgentRouteAdmissionResolverOptions {
  readonly loadConfig?: typeof loadKilnConfig;
  /** Established private binding used to load the same global authority as the caller. */
  readonly projectStateBinding?: ProjectStateBinding;
  readonly createRegistry?: () => { readonly registry: SessionRegistry };
  readonly discoverProviderModels?: (
    selectedProviderIds: ReadonlySet<string>,
  ) => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
  readonly resolveRoutes?: typeof resolveManagedInvocationToolOptions;
}

/**
 * Resolves canonical admission from data-only managed routes.
 * Candidate admission deliberately excludes execution composition, adapters, and
 * account credentials; capacity-backed routes defer to their atomic reservation.
 */
export async function createManagedAgentRouteAdmissionResolver(
  projectPath: string,
  options: CreateManagedAgentRouteAdmissionResolverOptions = {},
): Promise<ManagedAgentRouteAdmissionResolver> {
  const loadConfig = options.loadConfig ?? loadManagedAgentAdmissionConfig;
  const createRegistry = options.createRegistry ?? (() => createDefaultRegistry({
    kilnHome: options.projectStateBinding?.kilnHome ?? resolveKilnHomePath(),
  }));
  const discoverProviderModels = options.discoverProviderModels ?? discoverManagedAgentProviderModels;
  const resolveRoutes = options.resolveRoutes ?? resolveManagedInvocationToolOptions;
  try {
    const config = options.projectStateBinding
      ? await loadConfig(projectPath, { projectStateBinding: options.projectStateBinding })
      : await loadConfig(projectPath);
    const providerModelEligibility = await discoverProviderModels(selectConfiguredProviderIds(config));
    const resolution = await resolveRoutes(config, {
      cwd: projectPath,
      registry: createRegistry().registry,
      surface: "operator",
      providerModelEligibility,
      includeUnavailableRoutes: true,
      compositionMode: "candidate-admission",
    });
    return {
      resolve: (agent) => resolveManagedAgentRouteAdmission(
        agent,
        resolution,
        config?.authorityProfiles,
      ),
    };
  } catch {
    return { resolve: (agent) => unresolved(agent) };
  }
}

async function loadManagedAgentAdmissionConfig(
  projectPath: string,
  options?: Parameters<typeof loadKilnConfigWithGlobalAuthority>[1],
): Promise<ManagedAgentAdmissionConfig> {
  const loaded = options
    ? await loadKilnConfigWithGlobalAuthority(projectPath, options)
    : await loadKilnConfigWithGlobalAuthority(projectPath);
  if (!loaded.kilnYaml || !loaded.globalConfig) return loaded.kilnYaml;
  const authority = options?.projectStateBinding
    ? readGlobalExecutionTargetAuthority(loaded.globalConfig, {
        globalConfigPath: join(options.projectStateBinding.kilnHome, "config.yaml"),
      })
    : readGlobalExecutionTargetAuthority(loaded.globalConfig);
  return authority
    ? { ...loaded.kilnYaml, executionCatalog: authority.executionCatalog }
    : loaded.kilnYaml;
}

function selectConfiguredProviderIds(
  config: Awaited<ReturnType<typeof loadKilnConfig>>,
): ReadonlySet<string> {
  return new Set((config?.targetCatalog?.targets ?? []).map((target) => target.providerId));
}

function resolveManagedAgentRouteAdmission(
  agent: KilnAgentDefinition,
  resolution: ManagedInvocationRouteResolution,
  authorityProfiles: readonly KilnAuthorityProfileConfig[] | undefined,
): RouteAdmissionDecision | undefined {
  if (!agent.targetId) return undefined;
  const matchingRoutes = (resolution.managedInvocation?.routes ?? []).filter(
    (candidate) => candidate.routeId === agent.targetId,
  );
  const route = matchingRoutes.length === 1 ? matchingRoutes[0] : undefined;
  if (!route) {
    if (matchingRoutes.length > 1) return unresolved(agent);
    const unavailableRoute = resolution.managedInvocation?.unavailableRoutes?.find((candidate) =>
      candidate.routeId === agent.targetId,
    );
    return unavailableRoute ? unavailable(agent) : unresolved(agent);
  }
  const access = resolveAgentAccess(agent, authorityProfiles);
  if (!access) return unresolved(agent);
  const requestedAuthority = access === "read-only" ? "read_only" : "destructive";
  const toolNames = [...(agent.tools ?? [])];
  const caller: CallerAuthorityProfile = {
    authorityCeiling: requestedAuthority,
    allowedToolNames: toolNames,
    allowsRecursion: false,
    allowsAttachments: false,
    allowsWrite: requestedAuthority === "destructive",
  };
  return admitManagedRoute({
    route: route.capability,
    work: {
      evaluatedAt: new Date().toISOString(),
      access,
      requestedAuthority,
      requiredToolNames: toolNames,
      requiresRecursion: false,
      requiresAttachments: false,
      requiresWrite: requestedAuthority === "destructive",
      minimumProof: "configured",
    },
    caller,
  });
}

function resolveAgentAccess(
  agent: KilnAgentDefinition,
  authorityProfiles: readonly KilnAuthorityProfileConfig[] | undefined,
): ManagedAgentAccess | undefined {
  if (!agent.authorityProfileId) return undefined;
  return authorityProfiles?.find((profile) => profile.id === agent.authorityProfileId)?.access;
}

function unresolved(agent: KilnAgentDefinition): RouteAdmissionDecision {
  return { status: "unresolved", routeId: agent.targetId ?? "unresolved", reasons: [{ code: "proof-unknown" }] };
}

function unavailable(
  agent: KilnAgentDefinition,
  admittedRouteId?: string,
  reason: RouteAdmissionRejection = { code: "proof-unknown" },
): RouteAdmissionDecision {
  return { status: "unavailable", routeId: admittedRouteId ?? agent.targetId ?? "unresolved", reasons: [reason] };
}
