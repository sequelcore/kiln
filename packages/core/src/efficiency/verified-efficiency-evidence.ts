import type {
  ReplayLifecycleAttributionEvidenceInput,
  SessionLifecycleAttributionRecord,
} from "../events/session-lifecycle-attribution.js";
import { replayLifecycleAttributionEvidence } from "../events/session-lifecycle-attribution.js";

export type VerifiedEfficiencyActionKind =
  | "cache"
  | "context_allocation"
  | "delegation"
  | "memory"
  | "output_allocation"
  | "progressive_loading"
  | "routing"
  | "verification_allocation";

export type VerifiedEfficiencyVerificationStatus = "passed" | "failed" | "not_run" | "unknown";

export interface VerifiedEfficiencyPolicyIdentity {
  readonly owner: string;
  readonly policyId: string;
  readonly configurationHash: string;
}

export interface VerifiedEfficiencyActionEvidence {
  readonly actionId: string;
  readonly kind: VerifiedEfficiencyActionKind;
  readonly decision: string;
  readonly evidenceUris: readonly string[];
}

export interface VerifiedEfficiencyVerificationResult {
  readonly verificationResultId: string;
  readonly status: Exclude<VerifiedEfficiencyVerificationStatus, "not_run">;
  readonly method: string;
  readonly evidenceUris: readonly string[];
}

export interface VerifiedEfficiencyAvoidedComparison {
  readonly savingId: string;
  readonly actionId: string;
  readonly verificationResultId: string;
  readonly baselineTokens: number;
  readonly candidateTokens: number;
  readonly baselineCostUsd?: number;
  readonly candidateCostUsd?: number;
  readonly comparisonHash: string;
  readonly evidenceUris: readonly string[];
}

export interface VerifiedEfficiencySavingEvidence {
  readonly savingId: string;
  readonly actionId: string;
  readonly verificationResultId: string;
  readonly tokens: number;
  readonly costUsd: number;
  readonly comparisonHash: string;
  readonly evidenceUris: readonly string[];
}

export interface VerifiedEfficiencyVolume {
  readonly tokens: number;
  readonly costUsd: number;
}

export interface VerifiedEfficiencyEvidenceProjection {
  readonly schemaVersion: "verified-efficiency-evidence-v1";
  readonly sessionId: string;
  readonly turnId?: string;
  readonly observedAt: string;
  readonly provider: {
    readonly providerId: string;
    readonly modelId: string;
    readonly billingMode: string;
  };
  readonly policy: VerifiedEfficiencyPolicyIdentity;
  readonly totals: {
    readonly providerTotalTokens: number;
    readonly providerTotalCostUsd: number;
    readonly measured: VerifiedEfficiencyVolume;
    readonly estimated: VerifiedEfficiencyVolume;
    readonly cached: VerifiedEfficiencyVolume;
    readonly unknown: VerifiedEfficiencyVolume;
    readonly cacheWritten: VerifiedEfficiencyVolume;
    /** Paired-comparison evidence only. Never part of provider totals. */
    readonly avoided: VerifiedEfficiencyVolume;
  };
  readonly outcome: "succeeded" | "failed" | "unknown";
  readonly verification: {
    readonly status: VerifiedEfficiencyVerificationStatus;
    readonly results: readonly VerifiedEfficiencyVerificationResult[];
  };
  readonly actions: readonly VerifiedEfficiencyActionEvidence[];
  readonly savings: readonly VerifiedEfficiencySavingEvidence[];
  readonly evidenceUris: readonly string[];
}

export interface ProjectVerifiedEfficiencyEvidenceInput {
  readonly lifecycleEvidence: ReplayLifecycleAttributionEvidenceInput;
  readonly observedAt: string;
  readonly policy: VerifiedEfficiencyPolicyIdentity;
  readonly actions?: readonly VerifiedEfficiencyActionEvidence[];
  readonly verificationResults?: readonly VerifiedEfficiencyVerificationResult[];
  readonly avoidedComparisons?: readonly VerifiedEfficiencyAvoidedComparison[];
  readonly outcome?: VerifiedEfficiencyEvidenceProjection["outcome"];
}

export function projectVerifiedEfficiencyEvidence(
  input: ProjectVerifiedEfficiencyEvidenceInput,
): VerifiedEfficiencyEvidenceProjection {
  const reconciled = replayLifecycleAttributionEvidence(input.lifecycleEvidence);
  validateTimestamp(input.observedAt);
  validatePolicy(input.policy);
  const actions = [...(input.actions ?? [])];
  const verificationResults = [...(input.verificationResults ?? [])];
  validateActions(actions);
  validateVerificationResults(verificationResults);
  const savings = (input.avoidedComparisons ?? []).map((comparison) => projectSaving(
    comparison,
    actions,
    verificationResults,
  ));
  const volumes = summarizeVolumes(reconciled.ledger.records);
  const avoided = savings.reduce<VerifiedEfficiencyVolume>((total, saving) => ({
    tokens: total.tokens + saving.tokens,
    costUsd: normalizeUsd(total.costUsd + saving.costUsd),
  }), { tokens: 0, costUsd: 0 });

  return {
    schemaVersion: "verified-efficiency-evidence-v1",
    sessionId: reconciled.ledger.sessionId,
    ...(reconciled.ledger.turnId ? { turnId: reconciled.ledger.turnId } : {}),
    observedAt: input.observedAt,
    provider: {
      providerId: reconciled.ledger.provider.provider,
      modelId: reconciled.ledger.provider.canonicalModel ?? reconciled.ledger.provider.model,
      billingMode: reconciled.ledger.provider.billingMode ?? "unknown",
    },
    policy: { ...input.policy },
    totals: {
      providerTotalTokens: reconciled.summary.totalTokens,
      providerTotalCostUsd: reconciled.summary.totalCostUsd,
      ...volumes,
      avoided,
    },
    outcome: input.outcome ?? "unknown",
    verification: {
      status: summarizeVerification(verificationResults),
      results: verificationResults,
    },
    actions,
    savings,
    evidenceUris: uniqueSortedUris([
      ...reconciled.ledger.records.flatMap((record) => record.evidenceUris),
      ...actions.flatMap((action) => action.evidenceUris),
      ...verificationResults.flatMap((result) => result.evidenceUris),
      ...savings.flatMap((saving) => saving.evidenceUris),
    ]),
  };
}

function summarizeVolumes(records: readonly SessionLifecycleAttributionRecord[]): {
  readonly measured: VerifiedEfficiencyVolume;
  readonly estimated: VerifiedEfficiencyVolume;
  readonly cached: VerifiedEfficiencyVolume;
  readonly unknown: VerifiedEfficiencyVolume;
  readonly cacheWritten: VerifiedEfficiencyVolume;
} {
  const volumes: Record<"measured" | "estimated" | "cached" | "unknown" | "cacheWritten", VerifiedEfficiencyVolume> = {
    measured: { tokens: 0, costUsd: 0 },
    estimated: { tokens: 0, costUsd: 0 },
    cached: { tokens: 0, costUsd: 0 },
    unknown: { tokens: 0, costUsd: 0 },
    cacheWritten: { tokens: 0, costUsd: 0 },
  };
  for (const record of records) {
    const bucket = record.tokenClass === "cached"
      ? "cached"
      : record.tokenClass === "cache_written"
        ? "cacheWritten"
        : record.quality === "provider_reported"
          ? "measured"
          : record.quality === "estimated"
            ? "estimated"
            : "unknown";
    const current = volumes[bucket];
    volumes[bucket] = {
      tokens: current.tokens + record.tokens,
      costUsd: normalizeUsd(current.costUsd + record.cost.deltaUsd),
    };
  }
  return volumes;
}

function projectSaving(
  comparison: VerifiedEfficiencyAvoidedComparison,
  actions: readonly VerifiedEfficiencyActionEvidence[],
  verificationResults: readonly VerifiedEfficiencyVerificationResult[],
): VerifiedEfficiencySavingEvidence {
  requireNonEmpty(comparison.savingId, "saving id");
  requireHash(comparison.comparisonHash, "comparison hash");
  requireCanonicalUris(comparison.evidenceUris, "avoided comparison");
  if (!Number.isInteger(comparison.baselineTokens) || !Number.isInteger(comparison.candidateTokens)
    || comparison.baselineTokens < 0 || comparison.candidateTokens < 0
    || comparison.candidateTokens > comparison.baselineTokens) {
    throw new Error("Avoided comparison requires non-negative paired token totals with candidate <= baseline");
  }
  const action = actions.find((candidate) => candidate.actionId === comparison.actionId);
  const verification = verificationResults.find(
    (candidate) => candidate.verificationResultId === comparison.verificationResultId,
  );
  if (!action || verification?.status !== "passed") {
    throw new Error("Avoided savings require an existing action and passing linked verification");
  }
  const baselineCostUsd = comparison.baselineCostUsd ?? 0;
  const candidateCostUsd = comparison.candidateCostUsd ?? 0;
  if (!isNonNegativeFinite(baselineCostUsd) || !isNonNegativeFinite(candidateCostUsd)
    || candidateCostUsd > baselineCostUsd) {
    throw new Error("Avoided comparison cost requires candidate <= baseline");
  }
  return {
    savingId: comparison.savingId,
    actionId: action.actionId,
    verificationResultId: verification.verificationResultId,
    tokens: comparison.baselineTokens - comparison.candidateTokens,
    costUsd: normalizeUsd(baselineCostUsd - candidateCostUsd),
    comparisonHash: comparison.comparisonHash,
    evidenceUris: [...comparison.evidenceUris],
  };
}

function validatePolicy(policy: VerifiedEfficiencyPolicyIdentity): void {
  requireNonEmpty(policy.owner, "policy owner");
  requireNonEmpty(policy.policyId, "policy id");
  requireHash(policy.configurationHash, "policy configuration hash");
}

function validateActions(actions: readonly VerifiedEfficiencyActionEvidence[]): void {
  requireUnique(actions.map((action) => action.actionId), "action id");
  for (const action of actions) {
    requireNonEmpty(action.actionId, "action id");
    requireNonEmpty(action.decision, "action decision");
    requireKilnUris(action.evidenceUris, "action");
  }
}

function validateVerificationResults(results: readonly VerifiedEfficiencyVerificationResult[]): void {
  requireUnique(results.map((result) => result.verificationResultId), "verification result id");
  for (const result of results) {
    requireNonEmpty(result.verificationResultId, "verification result id");
    requireNonEmpty(result.method, "verification method");
    requireKilnUris(result.evidenceUris, "verification result");
  }
}

function summarizeVerification(
  results: readonly VerifiedEfficiencyVerificationResult[],
): VerifiedEfficiencyVerificationStatus {
  if (results.length === 0) return "not_run";
  if (results.some((result) => result.status === "failed")) return "failed";
  if (results.some((result) => result.status === "unknown")) return "unknown";
  return "passed";
}

function requireCanonicalUris(uris: readonly string[], label: string): void {
  if (uris.length === 0 || uris.some((uri) => !/^kiln:\/\/(artifacts|memory)\//u.test(uri))) {
    throw new Error(`${label} requires canonical evidence URIs`);
  }
}

function requireKilnUris(uris: readonly string[], label: string): void {
  if (uris.length === 0 || uris.some((uri) => !/^kiln:\/\//u.test(uri))) {
    throw new Error(`${label} requires Kiln evidence URIs`);
  }
}

function uniqueSortedUris(uris: readonly string[]): readonly string[] {
  return [...new Set(uris)].sort();
}

function requireUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`Duplicate ${label}`);
  }
}

function requireNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`Missing ${label}`);
}

function requireHash(value: string, label: string): void {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new Error(`Invalid ${label}`);
}

function validateTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new Error("Invalid efficiency evidence timestamp");
}

function isNonNegativeFinite(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function normalizeUsd(value: number): number {
  return Math.round(value * 1e12) / 1e12;
}
