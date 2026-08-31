import type { ManagedAgentAccess } from "@kilnai/core";
import type { ManagedInvocationAgentCatalogEntry, ManagedInvocationRouteProfile, ManagedInvocationToolRoute } from "./types.js";

interface ManagedInvocationAuthorityBinding {
  readonly authorityProfileId: string;
  readonly access: ManagedAgentAccess;
}

/**
 * Resolves the one route profile named by a configured agent binding.
 * Missing, incomplete, mismatched, and duplicate bindings all fail closed.
 */
export function resolveConfiguredManagedInvocationRouteProfile(
  route: ManagedInvocationToolRoute,
  agent: ManagedInvocationAuthorityBinding,
  requestedAccess: ManagedAgentAccess,
): ManagedInvocationRouteProfile | undefined {
  if (agent.access !== requestedAccess) {
    return undefined;
  }
  const resolved = resolveUniqueManagedInvocationRouteProfile(
    route.profiles,
    (profile) => profile.authorityProfileId === agent.authorityProfileId,
  );
  return resolved?.access === requestedAccess ? resolved : undefined;
}

/**
 * Resolves an ad-hoc request by admission class only when exactly one route
 * profile exposes that class. Ambiguity is an authority denial, not a default.
 */
export function resolveAdHocManagedInvocationRouteProfile(
  route: ManagedInvocationToolRoute,
  access: ManagedAgentAccess,
): ManagedInvocationRouteProfile | undefined {
  return resolveUniqueManagedInvocationRouteProfile(
    route.profiles,
    (profile) => profile.access === access,
  );
}

export function resolveManagedInvocationRouteProfile(
  route: ManagedInvocationToolRoute,
  access: ManagedAgentAccess,
  agent?: ManagedInvocationAgentCatalogEntry,
): ManagedInvocationRouteProfile | undefined {
  return agent
    ? resolveConfiguredManagedInvocationRouteProfile(route, agent, access)
    : resolveAdHocManagedInvocationRouteProfile(route, access);
}

function resolveUniqueManagedInvocationRouteProfile(
  profiles: readonly ManagedInvocationRouteProfile[],
  predicate: (profile: ManagedInvocationRouteProfile) => boolean,
): ManagedInvocationRouteProfile | undefined {
  let resolved: ManagedInvocationRouteProfile | undefined;
  for (const profile of profiles) {
    if (!predicate(profile)) continue;
    if (resolved) return undefined;
    resolved = profile;
  }
  return resolved;
}
