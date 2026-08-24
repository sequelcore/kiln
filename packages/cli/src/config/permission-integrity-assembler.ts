import {
  classifyTrustedExecutionIntegrity,
  readTrustedExecutionSemanticLimitationAcceptance,
  type TrustedExecutionSemanticLimitation,
} from "@kilnai/core";
import { type TrustedExecutionIntegrity, TrustedExecutionIntegritySchema } from "@kilnai/gateway-contracts";
import type { RuntimePermissionEvidencePair } from "../wrapper/runtime-permission-observation.js";

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
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_RUNTIME_PERMISSION_OBSERVATION_TTL_MS;
  const semanticLimitations = input.integrity.semanticLimitations ?? [];
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
    throw new Error("Runtime permission observation TTL must be a positive safe integer.");
  }
  const requested = input.evidence?.requested;
  const observation = input.evidence?.observed;
  const matchesBinding = requested?.harness === input.integrity.harness
    && requested.targetId === input.targetId
    && requested.projectionDigest === input.projectionDigest
    && observation?.harness === requested.harness
    && observation.sessionDigest === requested.sessionDigest
    && observation.targetId === requested.targetId
    && observation.projectionDigest === requested.projectionDigest
    && observation.effectivePolicyDigest === requested.effectivePolicyDigest;
  const timestampMatches = observation?.observedAt === observation?.verifiedAt;
  const ageMs = observation ? now.getTime() - Date.parse(observation.verifiedAt) : Number.NaN;
  const isCurrent = timestampMatches && ageMs >= 0 && ageMs <= ttlMs;
  const effectiveRuntime = matchesBinding && observation
    ? {
        profile: observation.profile,
        source: observation.source,
        observedAt: observation.observedAt,
        verifiedAt: observation.verifiedAt,
        freshness: isCurrent ? "current" as const : "stale" as const,
        proof: observation.proof,
      }
    : undefined;
  const classified = classifyTrustedExecutionIntegrity({
    harness: input.integrity.harness,
    desired: input.integrity.desired,
    persistedNative: input.integrity.persistedNative,
    sessionOverride: input.integrity.sessionOverride,
    effectiveRuntime,
    enforcement: input.integrity.enforcement,
    authorization: input.integrity.authorization,
    semanticLoss: input.integrity.semanticLoss,
    semanticLimitations,
    observation: "complete",
  });
  const projectPath = input.projectPath;
  const limitationAcceptanceReader = input.limitationAcceptanceReader ?? readTrustedExecutionSemanticLimitationAcceptance;
  const limitationAcceptances = projectPath === undefined ? [] : semanticLimitations.flatMap((limitation) => {
    const acceptance = limitationAcceptanceReader(
      projectPath,
      limitation as TrustedExecutionSemanticLimitation,
      now.toISOString(),
      input.limitationAcceptanceBaseDir,
    );
    return acceptance ? [acceptance] : [];
  });
  const limitationsResolved = semanticLimitations.length > 0
    && limitationAcceptances.length === semanticLimitations.length;
  return TrustedExecutionIntegritySchema.parse({
    ...input.integrity,
    semanticLimitations,
    ...(effectiveRuntime ? { effectiveRuntime } : {}),
    classification: classified.classification,
    limitationAcceptances,
    recommendation: limitationsResolved
      ? `OpenCode filesystem-sandbox limitation accepted until ${limitationAcceptances[0]!.reviewAfter}; review again before it expires.`
      : input.integrity.recommendation,
    remediationRequiresApproval: limitationsResolved ? false : input.integrity.remediationRequiresApproval,
    lastVerifiedAt: effectiveRuntime?.verifiedAt ?? input.integrity.lastVerifiedAt,
  });
}
