// Extracted from the managed-invocation runtime tool; behavior is intentionally unchanged.
// Selects and rejects economic-policy route candidates for one configured
// agent profile: collectManagedEconomicCandidates evaluates every configured
// (and unavailable) route against the policy, caller capability, and
// non-economic admission, and returns the surviving candidate set plus every
// rejection reason. This is a standalone algorithm the pre-Slice-4 taxonomy
// never had a home for - it is neither single-route admission (evidence-validation.ts)
// nor hint-based route selection (route-resolution.ts), so it gets its own
// module rather than being forced into either.
import {
  admitManagedRoute,
  digestManagedEconomicProfileAuthority,
  resolveDeliberation,
} from "@kilnai/core";
import type {
  DeliberationResolution,
  ManagedAgentAdmissionProfile,
  ManagedAgentAuthorityProfile,
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentProviderRoute,
  ManagedAgentRequestedAuthority,
  ManagedAgentRouteSource,
} from "@kilnai/core";
import { deriveManagedInvocationCallerAuthority } from "../caller-capability-policy.js";
import { MANAGED_AGENT_INVOKE_TOOL_NAME } from "../tool-names.js";
import type {
  ManagedInvocationToolRoute,
  ManagedInvocationUnavailableRoute,
} from "./types.js";
import { validateManagedInvocationRequestedAuthority } from "./input-parsing.js";
import {
  missingManagedInvocationRequiredCapabilities,
  missingManagedInvocationRequiredReadPaths,
  missingManagedInvocationRequiredTools,
} from "./evidence-validation.js";
import { resolveManagedInvocationRouteAuthority } from "./working-directory-lease.js";
import { resolveConfiguredManagedInvocationRouteProfile } from "./profile-resolution.js";
import type { ManagedInvocationRouteProfile } from "./types.js";

export interface ManagedEconomicInvocationCommand {
  readonly economicPolicyId: string;
  readonly economicPolicyRevision: string;
  readonly configuredAgentProfileId: string;
  readonly authorityProfileId: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly routeId?: string;
  readonly providerRoute?: ManagedAgentProviderRoute;
  readonly callerIdentity?: ManagedAgentCallerAttachmentIdentity;
  readonly requiredToolNames?: readonly string[];
  readonly requiredReadPaths?: readonly string[];
  readonly requestedAuthority?: ManagedAgentRequestedAuthority;
  readonly requiresNetwork?: boolean;
  readonly requiresWrite?: boolean;
  /** Exact invocation identity used to resolve dynamic worktree authority. */
  readonly invocationId?: string;
}

export type ManagedEconomicCandidateRejectionReason =
  | "not-in-policy"
  | "caller-constraint-excluded"
  | "non-economic-admission-failed"
  | "economic-capability-unverified"
  | "deliberation-denied";

export interface ManagedEconomicCandidateRejection {
  readonly stage: "managed-candidate-admission";
  readonly routeId: string;
  readonly reason: ManagedEconomicCandidateRejectionReason;
}

export interface ManagedEconomicCandidateDescriptor {
  readonly routeId: string;
  readonly routeSource: ManagedAgentRouteSource;
  readonly providerId: string;
  readonly model?: string;
  readonly accountPolicyId?: string;
  readonly surface?: string;
  readonly adapterCapabilityId: string;
  readonly adapterCapabilityVersion: string;
  readonly profileAuthorityDigest: string;
  readonly deliberationResolution?: DeliberationResolution;
}

export interface ManagedEconomicCandidateSet {
  readonly economicPolicyId: string;
  readonly economicPolicyRevision: string;
  readonly admissionProfileId: ManagedAgentAdmissionProfile;
  readonly constraints: {
    readonly routeId?: string;
    readonly providerId?: string;
    readonly model?: string;
  };
  readonly candidates: readonly ManagedEconomicCandidateDescriptor[];
  readonly rejections: readonly ManagedEconomicCandidateRejection[];
}

export function collectManagedEconomicCandidates(
  command: ManagedEconomicInvocationCommand,
  routes: readonly ManagedInvocationToolRoute[],
  unavailableRoutes: readonly ManagedInvocationUnavailableRoute[] = [],
): ManagedEconomicCandidateSet {
  const policyRouteIds = new Set(
    routes
      .filter((route) => route.economicPolicyIds?.includes(command.economicPolicyId))
      .map((route) => route.routeId),
  );
  const candidates: ManagedEconomicCandidateDescriptor[] = [];
  const rejections: ManagedEconomicCandidateRejection[] = [];

  for (const route of unavailableRoutes) {
    rejections.push({
      stage: "managed-candidate-admission",
      routeId: route.routeId,
      reason: route.economicPolicyIds?.includes(command.economicPolicyId)
        ? "non-economic-admission-failed"
        : "not-in-policy",
    });
  }

  for (const route of routes) {
    const profile = resolveConfiguredManagedInvocationRouteProfile(route, {
      authorityProfileId: command.authorityProfileId,
      admissionProfile: command.admissionProfileId,
    }, command.admissionProfileId);
    const nonEconomicAdmissionFailed = (
      !profile
      || missingManagedInvocationRequiredTools(
        command.requiredToolNames ?? [],
        profile.allowedToolNames,
      ).length > 0
      || missingManagedInvocationRequiredCapabilities(
        command.requiredToolNames ?? [],
        profile,
      ).length > 0
      || missingManagedInvocationRequiredReadPaths(
        command.requiredReadPaths ?? [],
        profile,
      ).length > 0
      || (command.requiresNetwork === true && profile.networkAllowed !== true)
      || (command.requiresWrite === true && profile.writeAllowed !== true)
      || (
        command.requestedAuthority !== undefined
        && !validateManagedInvocationRequestedAuthority(
          command.requestedAuthority,
          command.admissionProfileId,
          MANAGED_AGENT_INVOKE_TOOL_NAME,
        ).ok
      )
      || (command.callerIdentity !== undefined && admitManagedRoute({
        route: route.capability,
        work: {
          evaluatedAt: new Date().toISOString(), profile: command.admissionProfileId,
          requestedAuthority: command.requestedAuthority === undefined || command.requestedAuthority === "auto" ? "read_only" : command.requestedAuthority,
          requiredToolNames: command.requiredToolNames ?? [], requiresRecursion: false, requiresAttachments: false,
          requiresWrite: command.requiresWrite === true, minimumProof: "configured",
        },
        caller: deriveManagedInvocationCallerAuthority({ callerIdentity: command.callerIdentity, routeAllowedToolNames: profile.allowedToolNames }),
      }).status !== "admitted")
    );
    if (nonEconomicAdmissionFailed) {
      rejections.push({
        stage: "managed-candidate-admission",
        routeId: route.routeId,
        reason: "non-economic-admission-failed",
      });
      continue;
    }
    const economicCapability = route.economicCapability;
    if (economicCapability?.status !== "verified") {
      rejections.push({
        stage: "managed-candidate-admission",
        routeId: route.routeId,
        reason: "economic-capability-unverified",
      });
      continue;
    }
    let reason: ManagedEconomicCandidateRejectionReason | undefined;
    if (!policyRouteIds.has(route.routeId)) {
      reason = "not-in-policy";
    } else if (
      (command.routeId && route.routeId !== command.routeId)
      || (command.providerRoute?.providerId && route.providerId !== command.providerRoute.providerId)
      || (command.providerRoute?.model && route.model !== command.providerRoute.model)
    ) {
      reason = "caller-constraint-excluded";
    }

    if (reason) {
      rejections.push({
        stage: "managed-candidate-admission",
        routeId: route.routeId,
        reason,
      });
      continue;
    }
    const deliberationResolution = command.providerRoute?.deliberationIntent
      ? resolveDeliberation({
          intent: command.providerRoute.deliberationIntent,
          source: "route",
          capabilities: route.deliberationCapabilities,
        })
      : undefined;
    if (deliberationResolution?.status === "denied") {
      rejections.push({
        stage: "managed-candidate-admission",
        routeId: route.routeId,
        reason: "deliberation-denied",
      });
      continue;
    }
    candidates.push({
      routeId: route.routeId,
      routeSource: route.routeSource,
      providerId: route.providerId,
      ...(route.model ? { model: route.model } : {}),
      ...(route.capability.capacity.kind === "policy-bound"
        ? { accountPolicyId: route.capability.capacity.accountPolicyId }
        : {}),
      ...(route.surface ? { surface: route.surface } : {}),
      adapterCapabilityId: economicCapability.adapterCapabilityId,
      adapterCapabilityVersion: economicCapability.adapterCapabilityVersion,
      profileAuthorityDigest: digestManagedEconomicCandidateProfileAuthority(profile, command.invocationId),
      ...(deliberationResolution ? { deliberationResolution } : {}),
    });
  }

  return {
    economicPolicyId: command.economicPolicyId,
    economicPolicyRevision: command.economicPolicyRevision,
    admissionProfileId: command.admissionProfileId,
    constraints: {
      ...(command.routeId ? { routeId: command.routeId } : {}),
      ...(command.providerRoute?.providerId ? { providerId: command.providerRoute.providerId } : {}),
      ...(command.providerRoute?.model ? { model: command.providerRoute.model } : {}),
    },
    candidates,
    rejections,
  };
}

export function digestManagedEconomicCandidateProfileAuthority(
  profile: ManagedInvocationRouteProfile,
  invocationId?: string,
): string {
  return digestManagedEconomicProfileAuthority(managedEconomicCandidateAuthority(profile, invocationId));
}

function managedEconomicCandidateAuthority(
  profile: ManagedInvocationRouteProfile,
  invocationId: string | undefined,
): ManagedAgentAuthorityProfile {
  const resolved = invocationId
    ? resolveManagedInvocationRouteAuthority(profile, invocationId)
    : {
        workingDirectory: profile.workingDirectory,
        writeAuthority: profile.writeAuthority,
      };
  return {
    authorityProfileId: profile.authorityProfileId,
    permissionProfile: profile.permissionProfile,
    toolAuthority: {
      allowedToolNames: profile.allowedToolNames,
      writeAllowed: profile.writeAllowed === true,
      networkAllowed: profile.networkAllowed === true,
    },
    workingDirectory: resolved.workingDirectory,
    timeoutMs: profile.timeoutMs,
    ...(profile.timeoutSource !== undefined ? { timeoutSource: profile.timeoutSource } : {}),
    credentialRoute: profile.credentialRoute.mode === "credentialless"
      ? profile.credentialRoute
      : { ...profile.credentialRoute, routeId: profile.credentialRoute.routeId.trim() },
    memoryScope: profile.memoryScope,
    ...(profile.readAuthority !== undefined ? { readAuthority: profile.readAuthority } : {}),
    ...(resolved.writeAuthority !== undefined ? { writeAuthority: resolved.writeAuthority } : {}),
  };
}
