import { admitManagedRoute } from "@kilnai/core";
import type {
  CallerAuthorityProfile,
  ManagedAgentAdmissionProfile,
  RouteAdmissionDecision,
  RouteAdmissionRejection,
} from "@kilnai/core";
import { loadKilnConfig } from "./config-merger.js";
import { discoverManagedAgentProviderModels } from "./managed-agent-provider-models.js";
import { resolveManagedInvocationToolOptions } from "./managed-agent-routes.js";
import { createDefaultRegistry } from "../wrapper/session-registry.js";
import type { KilnAgentDefinition } from "../application/agent-loader.js";
import type { ManagedInvocationRouteResolution } from "./managed-agent-routes.js";
import type { SessionRegistry } from "../wrapper/session-registry.js";
import type { ManagedAgentProviderModelCatalogDiagnostics } from "./managed-agent-provider-models.js";

export interface NativeAgentRouteAdmissionResolver {
  resolve(agent: KilnAgentDefinition): RouteAdmissionDecision | undefined;
}

export interface CreateNativeAgentRouteAdmissionResolverOptions {
  readonly loadConfig?: typeof loadKilnConfig;
  readonly createRegistry?: () => { readonly registry: SessionRegistry };
  readonly discoverProviderModels?: () => Promise<ManagedAgentProviderModelCatalogDiagnostics>;
  readonly resolveRoutes?: typeof resolveManagedInvocationToolOptions;
}

/**
 * Resolves native projection admission from canonical, data-only managed routes.
 * Candidate admission deliberately excludes execution composition, adapters, and
 * account credentials; capacity-backed routes defer to their atomic reservation.
 */
export async function createNativeAgentRouteAdmissionResolver(
  projectPath: string,
  options: CreateNativeAgentRouteAdmissionResolverOptions = {},
): Promise<NativeAgentRouteAdmissionResolver> {
  const loadConfig = options.loadConfig ?? loadKilnConfig;
  const createRegistry = options.createRegistry ?? (() => createDefaultRegistry());
  const discoverProviderModels = options.discoverProviderModels ?? discoverManagedAgentProviderModels;
  const resolveRoutes = options.resolveRoutes ?? resolveManagedInvocationToolOptions;
  try {
    const [config, providerModelEligibility] = await Promise.all([loadConfig(projectPath), discoverProviderModels()]);
    const resolution = await resolveRoutes(config, {
      cwd: projectPath,
      registry: createRegistry().registry,
      surface: "operator",
      providerModelEligibility,
      includeUnavailableRoutes: true,
      compositionMode: "candidate-admission",
    });
    return { resolve: (agent) => resolveNativeAgentRouteAdmission(agent, resolution) };
  } catch {
    return { resolve: (agent) => unresolved(agent) };
  }
}

function resolveNativeAgentRouteAdmission(
  agent: KilnAgentDefinition,
  resolution: ManagedInvocationRouteResolution,
): RouteAdmissionDecision | undefined {
  if (!agent.providerRoute) return undefined;
  const providerId = agent.providerRoute.providerId;
  const modelId = agent.providerRoute.model?.trim();
  if (!modelId) return unavailable(agent);
  const matchingRoutes = (resolution.managedInvocation?.routes ?? []).filter((candidate) =>
    candidate.providerId === providerId
    && candidate.model === modelId
    && (agent.routeId === undefined || candidate.routeId === agent.routeId),
  );
  const route = matchingRoutes.length === 1 ? matchingRoutes[0] : undefined;
  if (!route) {
    if (agent.routeId === undefined || matchingRoutes.length > 1) return unresolved(agent);
    const unavailableRoute = resolution.managedInvocation?.unavailableRoutes?.find((candidate) =>
      candidate.routeId === agent.routeId
      && candidate.providerId === providerId
      && candidate.model === modelId,
    );
    return unavailableRoute ? unavailable(agent) : unresolved(agent);
  }
  if (route.capability.capacity.kind !== "accountless") {
    return unavailable(agent, route.routeId, { code: "capacity-policy-mismatch" });
  }
  const profile = (agent.authorityProfile ?? "foundation-readonly-plan") as ManagedAgentAdmissionProfile;
  const requestedAuthority = profile === "foundation-readonly-plan" ? "read_only" : "destructive";
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
      profile,
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

function unresolved(agent: KilnAgentDefinition): RouteAdmissionDecision {
  return { status: "unresolved", routeId: agent.routeId ?? routeId(agent), reasons: [{ code: "proof-unknown" }] };
}

function unavailable(
  agent: KilnAgentDefinition,
  admittedRouteId?: string,
  reason: RouteAdmissionRejection = { code: "proof-insufficient", requiredProof: "configured" },
): RouteAdmissionDecision {
  return { status: "unavailable", routeId: admittedRouteId ?? agent.routeId ?? routeId(agent), reasons: [reason] };
}

function routeId(agent: KilnAgentDefinition): string {
  return `${agent.providerRoute?.providerId ?? "unresolved"}:${agent.providerRoute?.model?.trim() || "unresolved"}`;
}
