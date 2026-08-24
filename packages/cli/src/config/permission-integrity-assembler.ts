import {
  classifyTrustedExecutionIntegrity,
  readTrustedExecutionSemanticLimitationAcceptance,
  type TrustedExecutionSemanticLimitation,
} from "@kilnai/core";
import { type TrustedExecutionIntegrity, TrustedExecutionIntegritySchema } from "@kilnai/gateway-contracts";
import type { RuntimePermissionEvidencePair } from "../wrapper/runtime-permission-observation.js";
import { withoutPersistedTrustedExecutionAuthority } from "./persisted-permission-integrity.js";

export const DEFAULT_RUNTIME_PERMISSION_OBSERVATION_TTL_MS = 5 * 60 * 1_000;

export function assembleRuntimePermissionIntegrity(input: {
  readonly integrity: TrustedExecutionIntegrity;
  readonly evidence?: RuntimePermissionEvidencePair;
  readonly targetId: string;
  readonly projectionDigest: string;
  readonly projectPath?: string;
  readonly limitationAcceptanceReader?: typeof readTrustedExecutionSemanticLimitationAcceptance;
  /** Explicit semantic-limitation store selected by the established project binding. */
  readonly limitationAcceptanceBaseDir?: string;
  readonly now?: Date;
  readonly ttlMs?: number;
}): TrustedExecutionIntegrity {
  const integrity = withoutPersistedTrustedExecutionAuthority(
    input.integrity,
    input.targetId,
    "runtime permission integrity assembly",
  );
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_RUNTIME_PERMISSION_OBSERVATION_TTL_MS;
  const semanticLimitations = integrity.semanticLimitations ?? [];
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Runtime permission observation TTL must be a positive safe integer.");
  }
  const requested = input.evidence?.requested;
  const observation = input.evidence?.observed;
  const matchesBinding =
    requested?.harness === integrity.harness &&
    requested.targetId === input.targetId &&
    requested.projectionDigest === input.projectionDigest &&
    observation?.harness === requested.harness &&
    observation.sessionDigest === requested.sessionDigest &&
    observation.targetId === requested.targetId &&
    observation.projectionDigest === requested.projectionDigest &&
    observation.effectivePolicyDigest === requested.effectivePolicyDigest;
  const timestampMatches = observation?.observedAt === observation?.verifiedAt;
  const ageMs = observation ? now.getTime() - Date.parse(observation.verifiedAt) : Number.NaN;
  const isCurrent = timestampMatches && ageMs >= 0 && ageMs <= ttlMs;
  const effectiveRuntime =
    matchesBinding && observation
      ? {
          profile: observation.profile,
          source: observation.source,
          observedAt: observation.observedAt,
          verifiedAt: observation.verifiedAt,
          freshness: isCurrent ? ("current" as const) : ("stale" as const),
          proof: observation.proof,
        }
      : undefined;
  const classified = classifyTrustedExecutionIntegrity({
    harness: integrity.harness,
    desired: integrity.desired,
    persistedNative: integrity.persistedNative,
    sessionOverride: integrity.sessionOverride,
    effectiveRuntime,
    enforcement: integrity.enforcement,
    authorization: integrity.authorization,
    semanticLoss: integrity.semanticLoss,
    semanticLimitations,
    observation: "complete",
  });
  const projectPath = input.projectPath;
  const limitationAcceptanceReader =
    input.limitationAcceptanceReader ?? readTrustedExecutionSemanticLimitationAcceptance;
  const limitationAcceptances =
    projectPath === undefined
      ? []
      : semanticLimitations.flatMap((limitation) => {
          const acceptance = limitationAcceptanceReader(
            projectPath,
            limitation as TrustedExecutionSemanticLimitation,
            now.toISOString(),
            input.limitationAcceptanceBaseDir,
          );
          return acceptance ? [acceptance] : [];
        });
  const limitationsResolved =
    semanticLimitations.length > 0 && limitationAcceptances.length === semanticLimitations.length;
  return TrustedExecutionIntegritySchema.parse({
    ...integrity,
    semanticLimitations,
    ...(effectiveRuntime ? { effectiveRuntime } : {}),
    classification: classified.classification,
    limitationAcceptances,
    recommendation: limitationsResolved
      ? `OpenCode filesystem-sandbox limitation accepted until ${limitationAcceptances[0]!.reviewAfter}; review again before it expires.`
      : integrity.recommendation,
    remediationRequiresApproval: limitationsResolved ? false : integrity.remediationRequiresApproval,
    lastVerifiedAt: effectiveRuntime?.verifiedAt ?? integrity.lastVerifiedAt,
  });
}
