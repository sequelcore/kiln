export const TRUSTED_EXECUTION_PROFILES = [
  "restricted",
  "workspace-write",
  "trusted-full-access",
] as const;
export const TRUSTED_EXECUTION_EVIDENCE_FRESHNESS = ["current", "stale", "unknown"] as const;
export const TRUSTED_EXECUTION_PROOF_STATUSES = ["proven", "inferred", "unavailable", "contradictory"] as const;
export const TRUSTED_EXECUTION_CLASSIFICATIONS = [
  "current-verified",
  "intentional-operator-override",
  "native-projection-drift",
  "runtime-policy-mismatch",
  "effective-policy-unproven",
  "unsupported-semantic-translation",
  "dangerous-unapproved-broadening",
  "stale-evidence",
  "partial-observation",
  "observation-failed",
] as const;
export const TRUSTED_EXECUTION_EVIDENCE_SOURCES = [
  "operator-local-config",
  "repository-config",
  "native-config",
  "desktop-ui-selection",
  "session-metadata",
  "runtime-observation",
  "managed-child-observation",
] as const;
export type TrustedExecutionProfile = typeof TRUSTED_EXECUTION_PROFILES[number];
export type TrustedExecutionProof = typeof TRUSTED_EXECUTION_PROOF_STATUSES[number];
export type TrustedExecutionFreshness = typeof TRUSTED_EXECUTION_EVIDENCE_FRESHNESS[number];
export type TrustedExecutionEvidenceSource = typeof TRUSTED_EXECUTION_EVIDENCE_SOURCES[number];
export type TrustedExecutionClassification =
  typeof TRUSTED_EXECUTION_CLASSIFICATIONS[number];

export interface TrustedExecutionEvidence {
  readonly profile: TrustedExecutionProfile;
  readonly source: TrustedExecutionEvidenceSource;
  readonly observedAt: string;
  readonly verifiedAt?: string;
  readonly freshness: TrustedExecutionFreshness;
  readonly proof: TrustedExecutionProof;
  readonly projectionOwnership?: "kiln-managed" | "operator-owned" | "unmanaged";
}

export interface TrustedExecutionEnforcement {
  readonly approvalControl: "enforced" | "not-enforced" | "unknown";
  readonly filesystemSandbox: "enforced" | "not-enforced" | "unknown";
  readonly networkBoundary: "enforced" | "not-enforced" | "unknown";
  readonly strength: "strong" | "rules-only" | "weak" | "none" | "unknown";
}

export interface TrustedExecutionAuthorization {
  readonly status: "authorized" | "rejected" | "narrowed" | "unavailable";
  readonly scope?: "operator-local" | "repository";
  readonly revocable: boolean;
  readonly reason?: string;
  readonly authorizedBy?: string;
  readonly authorizedAt?: string;
}

export interface TrustedExecutionClassificationInput {
  readonly harness?: "codex" | "claude-code" | "opencode";
  readonly desired: TrustedExecutionEvidence;
  readonly persistedNative?: TrustedExecutionEvidence;
  readonly sessionOverride?: TrustedExecutionEvidence;
  readonly effectiveRuntime?: TrustedExecutionEvidence;
  readonly enforcement: TrustedExecutionEnforcement;
  readonly authorization: TrustedExecutionAuthorization;
  readonly semanticLoss: readonly string[];
  /** Evidence-bound limitations retain their identity; acceptance never changes this classification. */
  readonly semanticLimitations?: readonly { readonly id: string }[];
  readonly observation: "complete" | "partial" | "failed";
}

export interface TrustedExecutionClassificationResult {
  readonly classification: TrustedExecutionClassification;
  readonly effectiveIsProven: boolean;
  readonly enforcement: TrustedExecutionEnforcement;
}

export function classifyTrustedExecutionIntegrity(
  input: TrustedExecutionClassificationInput,
): TrustedExecutionClassificationResult {
  const evidence = [input.desired, input.persistedNative, input.sessionOverride, input.effectiveRuntime]
    .filter((item): item is TrustedExecutionEvidence => item !== undefined);
  const effectiveIsProven = input.effectiveRuntime?.proof === "proven"
    && input.effectiveRuntime.freshness === "current"
    && input.effectiveRuntime.verifiedAt !== undefined
    && ["runtime-observation", "managed-child-observation"].includes(input.effectiveRuntime.source);
  const anyEvidenceFreshnessUnknown = evidence.some((item) => item.freshness === "unknown");
  const uiEvidencePresentedAsProof = evidence.some((item) => item.source === "desktop-ui-selection" && item.proof === "proven");
  const profileAuthority: Readonly<Record<TrustedExecutionProfile, number>> = {
    restricted: 0,
    "workspace-write": 1,
    "trusted-full-access": 2,
  };
  const persistedBroadening = input.persistedNative !== undefined
    && profileAuthority[input.persistedNative.profile] > profileAuthority[input.desired.profile];
  const trustedAuthorization = input.authorization.status === "authorized"
    && input.authorization.scope === "operator-local"
    && input.authorization.authorizedBy !== undefined
    && input.authorization.authorizedAt !== undefined
    && input.authorization.revocable;

  let classification: TrustedExecutionClassification;
  if (persistedBroadening && !trustedAuthorization) {
    classification = "dangerous-unapproved-broadening";
  } else if (input.observation === "failed") {
    classification = "observation-failed";
  } else if (input.observation === "partial") {
    classification = "partial-observation";
  } else if (evidence.some((item) => item.freshness === "stale")) {
    classification = "stale-evidence";
  } else if (input.semanticLoss.length > 0 || (input.semanticLimitations?.length ?? 0) > 0) {
    classification = "unsupported-semantic-translation";
  } else if (input.effectiveRuntime?.proof === "contradictory"
    || (effectiveIsProven && input.effectiveRuntime?.profile !== input.desired.profile)) {
    classification = "runtime-policy-mismatch";
  } else if (!effectiveIsProven
    || input.desired.proof !== "proven"
    || input.desired.freshness !== "current"
    || input.desired.verifiedAt === undefined
    || input.desired.source === "desktop-ui-selection"
    || anyEvidenceFreshnessUnknown
    || uiEvidencePresentedAsProof
    || (input.desired.profile === "trusted-full-access" && !trustedAuthorization)) {
    classification = "effective-policy-unproven";
  } else if (input.persistedNative?.profile !== input.desired.profile) {
    classification = input.persistedNative?.projectionOwnership === "operator-owned" && trustedAuthorization
      ? "intentional-operator-override"
      : "native-projection-drift";
  } else {
    classification = "current-verified";
  }

  return { classification, effectiveIsProven, enforcement: input.enforcement };
}

export interface TrustedExecutionIntentRequest {
  readonly source: "operator-local" | "repository";
  readonly currentProfile?: TrustedExecutionProfile;
  readonly requestedProfile: TrustedExecutionProfile;
  readonly operatorApproved: boolean;
  readonly revocable: boolean;
  readonly operatorId?: string;
  readonly authorizedAt?: string;
}

const PROFILE_AUTHORITY: Readonly<Record<TrustedExecutionProfile, number>> = {
  restricted: 0,
  "workspace-write": 1,
  "trusted-full-access": 2,
};

export function authorizeTrustedExecutionIntent(
  request: TrustedExecutionIntentRequest,
): TrustedExecutionAuthorization {
  if (request.source === "repository") {
    const broadens = request.currentProfile === undefined
      || PROFILE_AUTHORITY[request.requestedProfile] > PROFILE_AUTHORITY[request.currentProfile];
    if (broadens) {
      return {
        status: "rejected",
        scope: "repository",
        revocable: request.revocable,
        reason: "repository-cannot-broaden-operator-authority",
      };
    }
    return { status: "narrowed", scope: "repository", revocable: request.revocable };
  }

  const currentAuthority = request.currentProfile === undefined ? 0 : PROFILE_AUTHORITY[request.currentProfile];
  const broadens = PROFILE_AUTHORITY[request.requestedProfile] > currentAuthority;
  if (!broadens) {
    return { status: "narrowed", scope: "operator-local", revocable: request.revocable };
  }

  if (!request.operatorApproved || !request.revocable || request.operatorId === undefined || request.authorizedAt === undefined) {
    return {
      status: "rejected",
      scope: "operator-local",
      revocable: request.revocable,
      reason: !request.operatorApproved
        ? "operator-approval-required"
        : !request.revocable
          ? "trusted-authority-must-be-revocable"
          : "operator-authorization-provenance-required",
    };
  }
  return {
    status: "authorized",
    scope: "operator-local",
    revocable: true,
    authorizedBy: request.operatorId,
    authorizedAt: request.authorizedAt,
  };
}
