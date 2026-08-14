import { classifyTrustedExecutionIntegrity, type TrustedExecutionAuthorizationRecord, type TrustedExecutionSemanticLimitation } from "@kilnai/core";
import { type TrustedExecutionIntegrity, TrustedExecutionIntegritySchema } from "@kilnai/gateway-contracts";
import type { KilnPermissionPolicy } from "../../wrapper/session.js";
import type { BackendConfig } from "../../wrapper/session-registry.js";

export const PERMISSION_PROJECTION_TARGET_IDS = {
  claude: "claude-settings",
  codex: "codex-config",
  opencode: "opencode-config",
} as const;

export interface PermissionProjection {
  readonly targetId: string;
  readonly document: Record<string, unknown>;
  readonly managedFields: readonly string[];
  readonly integrity: TrustedExecutionIntegrity;
}

export interface PermissionProjectionIntegrityInput {
  readonly harness: TrustedExecutionIntegrity["harness"];
  readonly policy: KilnPermissionPolicy;
  readonly translated: BackendConfig;
  readonly semanticLoss?: readonly string[];
  readonly semanticLimitations?: readonly TrustedExecutionSemanticLimitation[];
  readonly enforcement: TrustedExecutionIntegrity["enforcement"];
  readonly recommendation?: string;
  readonly now?: Date;
  readonly storedAuthorization?: TrustedExecutionAuthorizationRecord;
}

export interface PermissionSyncMetadata {
  readonly backend: string;
  readonly representableRules: readonly unknown[];
  readonly unsupportedRules: readonly unknown[];
  readonly constraintInstructions: readonly string[];
  readonly warnings: readonly string[];
  readonly nativeRules: unknown;
}

export function toPermissionSyncMetadata(translated: BackendConfig): PermissionSyncMetadata {
  return {
    backend: translated.backend,
    representableRules: translated.representableRules.map((rule) => ({ ...rule })),
    unsupportedRules: translated.unsupportedRules.map((rule) => ({ ...rule })),
    constraintInstructions: [...translated.constraintInstructions],
    warnings: [...translated.warnings],
    nativeRules: translated.nativeRules,
  };
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

export function createPermissionProjection(input: {
  readonly targetId: string;
  readonly document: Record<string, unknown>;
  readonly managedFields: readonly string[];
  readonly integrity: PermissionProjectionIntegrityInput;
}): PermissionProjection {
  return {
    targetId: input.targetId,
    document: input.document,
    managedFields: input.managedFields,
    integrity: createPermissionProjectionIntegrity(input.integrity),
  };
}

export function createPermissionProjectionIntegrity(
  input: PermissionProjectionIntegrityInput,
): TrustedExecutionIntegrity {
  const observedAt = (input.now ?? new Date()).toISOString();
  const profile = trustedExecutionProfileFromPolicy(input.policy);
  const semanticLoss = [
    ...input.translated.unsupportedRules.map(
      (rule) =>
        `Unsupported granular permission rule for ${input.translated.backend}: [${rule.category}] ${rule.action} ${rule.selector}.`,
    ),
    ...(input.semanticLoss ?? []),
  ];
  const authorization =
    profile === "trusted-full-access" && input.storedAuthorization?.profile === "trusted-full-access"
      ? input.storedAuthorization.authorization
      : {
          status: "unavailable" as const,
          revocable: true,
          reason:
            profile === "trusted-full-access"
              ? "operator-local-trusted-authorization-not-attached-to-native-projection"
              : "authorization-not-required-for-narrower-policy",
        };
  const desired = {
    profile,
    source: "operator-local-config" as const,
    observedAt,
    verifiedAt: observedAt,
    freshness: "current" as const,
    proof: "proven" as const,
  };
  const persistedNative = {
    profile,
    source: "native-config" as const,
    observedAt,
    verifiedAt: observedAt,
    freshness: "current" as const,
    proof: "proven" as const,
    projectionOwnership: "kiln-managed" as const,
  };
  const classification = classifyTrustedExecutionIntegrity({
    harness: input.harness,
    desired,
    persistedNative,
    enforcement: input.enforcement,
    authorization,
    semanticLoss,
    semanticLimitations: input.semanticLimitations,
    observation: "complete",
  }).classification;

  return TrustedExecutionIntegritySchema.parse({
    harness: input.harness,
    desired,
    persistedNative,
    enforcement: input.enforcement,
    authorization,
    semanticLoss,
    semanticLimitations: input.semanticLimitations ?? [],
    limitationAcceptances: [],
    classification,
    recommendation: input.recommendation ?? defaultProjectionRecommendation(input.translated, semanticLoss),
    remediationRequiresApproval: profile === "trusted-full-access" || semanticLoss.length > 0 || (input.semanticLimitations?.length ?? 0) > 0,
    lastVerifiedAt: observedAt,
  });
}

function trustedExecutionProfileFromPolicy(
  policy: KilnPermissionPolicy,
): TrustedExecutionIntegrity["desired"]["profile"] {
  if (policy.approval === "never" && policy.sandbox === "danger-full-access") {
    return "trusted-full-access";
  }
  if (policy.sandbox === "workspace-write" || policy.approval === "never") {
    return "workspace-write";
  }
  return "restricted";
}

function defaultProjectionRecommendation(translated: BackendConfig, semanticLoss: readonly string[]): string {
  if (semanticLoss.length > 0) {
    return `Review unsupported ${translated.backend} permission semantics before relying on unattended trusted execution.`;
  }
  return "Verify effective runtime authority before treating the projected native policy as active.";
}
