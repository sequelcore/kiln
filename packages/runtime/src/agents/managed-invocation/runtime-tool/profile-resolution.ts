import type { ManagedAgentAdmissionProfile } from "@kilnai/core";
import type { ManagedInvocationAgentCatalogEntry, ManagedInvocationRouteProfile, ManagedInvocationToolRoute } from "./types.js";

interface ManagedInvocationAuthorityBinding {
  readonly authorityProfileId: string;
  readonly admissionProfile: ManagedAgentAdmissionProfile;
}

/**
 * Resolves the one route profile named by a configured agent binding.
 * Missing, incomplete, mismatched, and duplicate bindings all fail closed.
 */
export function resolveConfiguredManagedInvocationRouteProfile(
  route: ManagedInvocationToolRoute,
  agent: ManagedInvocationAuthorityBinding,
  requestedAdmissionProfile: ManagedAgentAdmissionProfile,
): ManagedInvocationRouteProfile | undefined {
  if (agent.admissionProfile !== requestedAdmissionProfile) {
    return undefined;
  }
  const resolved = resolveUniqueManagedInvocationRouteProfile(
    route.profiles,
    (profile) => profile.authorityProfileId === agent.authorityProfileId,
  );
  return resolved?.admissionProfile === requestedAdmissionProfile ? resolved : undefined;
}

/**
 * Resolves an ad-hoc request by admission class only when exactly one route
 * profile exposes that class. Ambiguity is an authority denial, not a default.
 */
export function resolveAdHocManagedInvocationRouteProfile(
  route: ManagedInvocationToolRoute,
  admissionProfile: ManagedAgentAdmissionProfile,
): ManagedInvocationRouteProfile | undefined {
  return resolveUniqueManagedInvocationRouteProfile(
    route.profiles,
    (profile) => profile.admissionProfile === admissionProfile,
  );
}

export function resolveManagedInvocationRouteProfile(
  route: ManagedInvocationToolRoute,
  admissionProfile: ManagedAgentAdmissionProfile,
  agent?: ManagedInvocationAgentCatalogEntry,
): ManagedInvocationRouteProfile | undefined {
  return agent
    ? resolveConfiguredManagedInvocationRouteProfile(route, agent, admissionProfile)
    : resolveAdHocManagedInvocationRouteProfile(route, admissionProfile);
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
