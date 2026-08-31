import { admitManagedRoute } from "@kilnai/core";
import type {
  CallerAuthorityProfile,
  ManagedAgentAccess,
  RouteAdmissionDecision,
  RouteAdmissionRejection,
} from "@kilnai/core";
import { loadKilnConfig } from "./config-merger.js";
import { resolveKilnHomePath } from "./global-config/path.js";
import { discoverManagedAgentProviderModels } from "./managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "./managed-agent-routes.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import type { ManagedInvocationRouteResolution } from "./managed-agent-routes.js";
import type { SessionRegistry } from "../wrapper/session-registry.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "./managed-agent-provider-models.js";
import type { KilnAuthorityProfileConfig } from "../kiln-yaml-types.js";

export interface ManagedAgentRouteAdmissionResolver {
  resolve(agent: KilnAgentDefinition): RouteAdmissionDecision | undefined;
}

export interface CreateManagedAgentRouteAdmissionResolverOptions {
  readonly loadConfig?: typeof loadKilnConfig;
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
  const loadConfig = options.loadConfig ?? loadKilnConfig;
  const createRegistry = options.createRegistry ?? (() => createDefaultRegistry({ kilnHome: resolveKilnHomePath() }));
  const discoverProviderModels = options.discoverProviderModels ?? discoverManagedAgentProviderModels;
  const resolveRoutes = options.resolveRoutes ?? resolveManagedInvocationToolOptions;
  try {
    const config = await loadConfig(projectPath);
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
  reason: RouteAdmissionRejection = { code: "proof-insufficient", requiredProof: "configured" },
): RouteAdmissionDecision {
  return { status: "unavailable", routeId: admittedRouteId ?? agent.targetId ?? "unresolved", reasons: [reason] };
}
