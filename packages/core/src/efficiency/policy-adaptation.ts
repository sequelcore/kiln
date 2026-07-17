import { createHash } from "node:crypto";
import type { ContextAllocationMode } from "../context/index.js";
import type { ContextAllocationPromotionReport } from "../eval/context-allocation-benchmark.js";
import {
  replayLifecycleAttributionEvidence,
  type ReplayLifecycleAttributionEvidenceInput,
} from "../events/session-lifecycle-attribution.js";
import type { ArtifactResourceStore } from "../tools/infrastructure/artifact-resource-store.js";

export type PolicyAdaptationCohort = "replay" | "shadow" | "holdout";

export interface PolicyAdaptationContextConfiguration {
  readonly contextAllocationMode: ContextAllocationMode;
}

export interface PolicyAdaptationRareTaskRequirement {
  readonly taskClass: string;
  readonly minimumSamples: number;
}

export interface PolicyAdaptationCohortCommitment {
  readonly cohort: PolicyAdaptationCohort;
  readonly cohortId: string;
  readonly fixtureSetHash: string;
  readonly inputConfigurationHash: string;
  readonly frozenAt: string;
  readonly evidenceUri: string;
  readonly referenceTaskClassCounts: Readonly<Record<string, number>>;
  readonly requiredRareTasks: readonly PolicyAdaptationRareTaskRequirement[];
}

export interface PolicyAdaptationLedgerEvidenceInput {
  readonly replay: ReplayLifecycleAttributionEvidenceInput;
  readonly artifactUri: string;
}

export interface PolicyAdaptationLedgerEvidence {
  readonly sessionId: string;
  readonly sourceEventId: string;
  readonly sourceEventSequence: number;
  readonly policyVersion?: string;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly artifactUri: string;
}

export interface PolicyAdaptationOwningPromotionEvidence {
  readonly policyId: "context-allocation-promotion-v1";
  readonly comparisonHash: string;
  readonly reportArtifactUri: string;
}

export interface PolicyAdaptationCandidate {
  readonly version: "policy-adaptation-candidate-v1";
  readonly status: "draft";
  readonly generatedFrom: "replayed-lifecycle-ledger";
  readonly owner: "ContextGovernor";
  readonly candidateId: string;
  readonly policyFamily: "context-allocation";
  readonly basePolicyId: string;
  readonly candidatePolicyId: string;
  readonly rollbackPolicyId: string;
  readonly baseConfiguration: PolicyAdaptationContextConfiguration;
  readonly candidateConfiguration: PolicyAdaptationContextConfiguration;
  readonly baseConfigurationHash: string;
  readonly candidateConfigurationHash: string;
  readonly owningPromotion: PolicyAdaptationOwningPromotionEvidence;
  readonly committedCohorts: readonly PolicyAdaptationCohortCommitment[];
  readonly ledgerEvidence: readonly PolicyAdaptationLedgerEvidence[];
  readonly generatedAt: string;
  readonly candidateRecordHash: string;
}

export interface GeneratePolicyAdaptationCandidateInput {
  readonly candidateId: string;
  readonly policyFamily: "context-allocation";
  readonly basePolicyId: string;
  readonly candidatePolicyId: string;
  readonly rollbackPolicyId: string;
  readonly baseConfiguration: PolicyAdaptationContextConfiguration;
  readonly candidateConfiguration: PolicyAdaptationContextConfiguration;
  readonly owningPromotionReport: ContextAllocationPromotionReport;
  readonly owningPromotionArtifactUri: string;
  readonly committedCohorts: readonly PolicyAdaptationCohortCommitment[];
  readonly lifecycleEvidence: readonly PolicyAdaptationLedgerEvidenceInput[];
  readonly generatedAt: string;
}

const COHORTS: readonly PolicyAdaptationCohort[] = ["replay", "shadow", "holdout"];

export function generatePolicyAdaptationCandidate(
  input: GeneratePolicyAdaptationCandidateInput,
): PolicyAdaptationCandidate {
  const candidateId = requireText(input.candidateId, "Policy adaptation candidate id is required.");
  const basePolicyId = requireText(input.basePolicyId, "Policy adaptation base policy id is required.");
  const candidatePolicyId = requireText(input.candidatePolicyId, "Policy adaptation candidate policy id is required.");
  const rollbackPolicyId = requireText(input.rollbackPolicyId, "Policy adaptation rollback policy id is required.");
  const generatedAt = requireTimestamp(input.generatedAt, "Policy adaptation generatedAt is invalid.");
  if (candidatePolicyId === basePolicyId) throw new Error("Policy adaptation candidate policy must differ from the base policy.");
  if (rollbackPolicyId !== basePolicyId) throw new Error("Policy adaptation rollback must restore the base policy.");
  const baseConfiguration = defineContextConfiguration(input.baseConfiguration);
  const candidateConfiguration = defineContextConfiguration(input.candidateConfiguration);
  if (stableStringify(baseConfiguration) === stableStringify(candidateConfiguration)) {
    throw new Error("Policy adaptation candidate configuration must differ from the base configuration.");
  }
  if (!input.owningPromotionReport.promotionEligible || input.owningPromotionReport.issues.length > 0) {
    throw new Error("Policy adaptation requires an eligible owning promotion report.");
  }
  const owningPromotion: PolicyAdaptationOwningPromotionEvidence = {
    policyId: input.owningPromotionReport.policyId,
    comparisonHash: requireSha256(input.owningPromotionReport.comparisonHash, "Owning promotion comparison hash"),
    reportArtifactUri: requireArtifactUri(input.owningPromotionArtifactUri),
  };
  const committedCohorts = defineCohortCommitments(input.committedCohorts, generatedAt);
  if (input.lifecycleEvidence.length === 0) throw new Error("Policy adaptation requires replayed lifecycle evidence.");
  const ledgerEvidence = input.lifecycleEvidence.map((entry) => {
    const replayed = replayLifecycleAttributionEvidence(entry.replay);
    return {
      sessionId: replayed.ledger.sessionId,
      sourceEventId: replayed.ledger.sourceEventId,
      sourceEventSequence: replayed.ledger.sourceEventSequence,
      ...(replayed.ledger.context.policyVersion ? { policyVersion: replayed.ledger.context.policyVersion } : {}),
      totalTokens: replayed.summary.totalTokens,
      totalCostUsd: replayed.summary.totalCostUsd,
      artifactUri: requireArtifactUri(entry.artifactUri),
    };
  });
  const baseConfigurationHash = hashValue(baseConfiguration);
  const candidateConfigurationHash = hashValue(candidateConfiguration);
  const record = {
    version: "policy-adaptation-candidate-v1" as const,
    status: "draft" as const,
    generatedFrom: "replayed-lifecycle-ledger" as const,
    owner: "ContextGovernor" as const,
    candidateId,
    policyFamily: input.policyFamily,
    basePolicyId,
    candidatePolicyId,
    rollbackPolicyId,
    baseConfiguration,
    candidateConfiguration,
    baseConfigurationHash,
    candidateConfigurationHash,
    owningPromotion,
    committedCohorts,
    ledgerEvidence,
    generatedAt,
  };
  return { ...record, candidateRecordHash: hashValue(record) };
}

export function hashPolicyAdaptationConfiguration(
  configuration: PolicyAdaptationContextConfiguration,
): string {
  return hashValue(defineContextConfiguration(configuration));
}

export function assertPolicyAdaptationPromotionEvidence(
  candidate: PolicyAdaptationCandidate,
  evaluation: PolicyAdaptationEvaluationReport,
): void {
  const { candidateRecordHash, ...record } = candidate;
  if (hashValue(record) !== candidateRecordHash) throw new Error("Policy adaptation candidate record hash mismatch.");
  if (hashPolicyAdaptationConfiguration(candidate.baseConfiguration) !== candidate.baseConfigurationHash
    || hashPolicyAdaptationConfiguration(candidate.candidateConfiguration) !== candidate.candidateConfigurationHash) {
    throw new Error("Policy adaptation configuration hash mismatch.");
  }
  if (evaluation.decision !== "eligible-for-operator-promotion" || evaluation.issues.length > 0) {
    throw new Error("Policy adaptation candidate is not eligible for promotion.");
  }
  if (evaluation.candidateId !== candidate.candidateId
    || evaluation.candidatePolicyId !== candidate.candidatePolicyId
    || evaluation.candidateRecordHash !== candidate.candidateRecordHash
    || evaluation.candidateConfigurationHash !== candidate.candidateConfigurationHash
    || evaluation.owningComparisonHash !== candidate.owningPromotion.comparisonHash) {
    throw new Error("Policy adaptation evaluation does not match the candidate.");
  }
  requireSha256(evaluation.evidenceHash, "Policy adaptation evaluation evidence hash");
}

export type PolicyAdaptationObservationPolicy = "baseline" | "candidate";

export interface PolicyAdaptationObservation {
  readonly cohort: PolicyAdaptationCohort;
  readonly cohortId: string;
  readonly fixtureSetHash: string;
  readonly taskId: string;
  readonly taskClass: string;
  readonly inputHash: string;
  readonly policy: PolicyAdaptationObservationPolicy;
  readonly policyId: string;
  readonly verifiedSuccess: boolean;
  readonly hardInvariantsPassed: boolean;
  readonly tokens: number;
  readonly costUsd: number;
  readonly cachePartitionHash: string;
  readonly cacheIsolationVerified: boolean;
  readonly invalidCacheReuseObserved: boolean;
  readonly cacheInvalidationTokens: number;
  readonly replayDivergenceRecorded?: boolean;
  readonly shadowUserVisible?: boolean;
  readonly shadowExternalSideEffectsSuppressed?: boolean;
  readonly evidenceUri: string;
}

export interface PolicyAdaptationCohortEvaluation {
  readonly cohort: PolicyAdaptationCohort;
  readonly sampleSize: number;
  readonly verifiedSuccessDelta: number;
  readonly verifiedSuccessLowerBound: number;
  readonly tokenDelta: number;
  readonly costDeltaUsd: number;
  readonly cacheInvalidationTokenDelta: number;
}

export interface PolicyAdaptationEvaluationReport {
  readonly version: "policy-adaptation-evaluation-v1";
  readonly candidateId: string;
  readonly candidatePolicyId: string;
  readonly candidateRecordHash: string;
  readonly candidateConfigurationHash: string;
  readonly owningComparisonHash: string;
  readonly decision: "eligible-for-operator-promotion" | "blocked";
  readonly confidenceLevel: 0.9 | 0.95 | 0.99;
  readonly nonInferiorityMargin: number;
  readonly minimumSampleSize: number;
  readonly sampleSizeByCohort: Record<PolicyAdaptationCohort, number>;
  readonly cohorts: readonly PolicyAdaptationCohortEvaluation[];
  readonly holdoutDistributionShift: number;
  readonly issues: readonly string[];
  readonly evidenceHash: string;
}

export interface EvaluatePolicyAdaptationCandidateInput {
  readonly candidate: PolicyAdaptationCandidate;
  readonly observations: readonly PolicyAdaptationObservation[];
  readonly minimumSampleSize: number;
  readonly confidenceLevel: 0.9 | 0.95 | 0.99;
  readonly nonInferiorityMargin: number;
  readonly maximumDistributionShift: number;
  readonly maximumCacheInvalidationTokenIncrease: number;
}

interface ObservationPair {
  readonly cohort: PolicyAdaptationCohort;
  readonly taskId: string;
  readonly baseline: PolicyAdaptationObservation;
  readonly candidate: PolicyAdaptationObservation;
}

export function evaluatePolicyAdaptationCandidate(
  input: EvaluatePolicyAdaptationCandidateInput,
): PolicyAdaptationEvaluationReport {
  if (!Number.isSafeInteger(input.minimumSampleSize) || input.minimumSampleSize < 5) {
    throw new Error("Policy adaptation minimum sample size must be an integer of at least five.");
  }
  requireUnit(input.nonInferiorityMargin, "Policy adaptation non-inferiority margin");
  requireUnit(input.maximumDistributionShift, "Policy adaptation maximum distribution shift");
  requireNonNegative(input.maximumCacheInvalidationTokenIncrease, "Policy adaptation cache invalidation tolerance", true);
  const issues: string[] = [];
  const pairs = pairObservations(input.observations, input.candidate, issues);
  const cohorts = COHORTS.map((cohort) => evaluateCohort(cohort, pairs, input, issues));
  validateCohortSemantics(pairs, issues);
  validateRareTasks(input.candidate, pairs, issues);
  const holdoutDistributionShift = calculateHoldoutDistributionShift(input.candidate, pairs);
  if (holdoutDistributionShift > input.maximumDistributionShift) {
    issues.push(`holdout distribution shift ${holdoutDistributionShift} exceeds ${input.maximumDistributionShift}`);
  }
  const holdout = cohorts.find((cohort) => cohort.cohort === "holdout")!;
  if (holdout.tokenDelta >= 0) issues.push("fixed holdout did not reduce model-facing tokens");
  if (holdout.costDeltaUsd > 0) issues.push("fixed holdout increased cost");

  const sampleSizeByCohort = Object.fromEntries(cohorts.map((cohort) => [cohort.cohort, cohort.sampleSize])) as Record<PolicyAdaptationCohort, number>;
  const normalizedIssues = [...new Set(issues)];
  const evidenceInput = {
    candidateRecordHash: input.candidate.candidateRecordHash,
    owningComparisonHash: input.candidate.owningPromotion.comparisonHash,
    observations: [...input.observations].sort(compareObservations),
    minimumSampleSize: input.minimumSampleSize,
    confidenceLevel: input.confidenceLevel,
    nonInferiorityMargin: input.nonInferiorityMargin,
    maximumDistributionShift: input.maximumDistributionShift,
    maximumCacheInvalidationTokenIncrease: input.maximumCacheInvalidationTokenIncrease,
  };
  return {
    version: "policy-adaptation-evaluation-v1",
    candidateId: input.candidate.candidateId,
    candidatePolicyId: input.candidate.candidatePolicyId,
    candidateRecordHash: input.candidate.candidateRecordHash,
    candidateConfigurationHash: input.candidate.candidateConfigurationHash,
    owningComparisonHash: input.candidate.owningPromotion.comparisonHash,
    decision: normalizedIssues.length === 0 ? "eligible-for-operator-promotion" : "blocked",
    confidenceLevel: input.confidenceLevel,
    nonInferiorityMargin: input.nonInferiorityMargin,
    minimumSampleSize: input.minimumSampleSize,
    sampleSizeByCohort,
    cohorts,
    holdoutDistributionShift,
    issues: normalizedIssues,
    evidenceHash: hashValue(evidenceInput),
  };
}

function pairObservations(
  observations: readonly PolicyAdaptationObservation[],
  candidate: PolicyAdaptationCandidate,
  issues: string[],
): readonly ObservationPair[] {
  const commitments = new Map(candidate.committedCohorts.map((commitment) => [commitment.cohort, commitment]));
  const taskCohorts = new Map<string, PolicyAdaptationCohort>();
  const byKey = new Map<string, Partial<Record<PolicyAdaptationObservationPolicy, PolicyAdaptationObservation>>>();
  for (const observation of observations) {
    validateObservation(observation);
    const commitment = commitments.get(observation.cohort)!;
    if (observation.cohortId !== commitment.cohortId || observation.fixtureSetHash !== commitment.fixtureSetHash) {
      issues.push(`${observation.cohort} task ${observation.taskId} cohort commitment mismatch`);
    }
    const previousCohort = taskCohorts.get(observation.taskId);
    if (previousCohort && previousCohort !== observation.cohort) {
      issues.push(`task ${observation.taskId} appears in multiple adaptation cohorts`);
    }
    taskCohorts.set(observation.taskId, observation.cohort);
    const expectedPolicyId = observation.policy === "baseline" ? candidate.basePolicyId : candidate.candidatePolicyId;
    if (observation.policyId !== expectedPolicyId) issues.push(`${observation.cohort} task ${observation.taskId} policy identity mismatch`);
    const key = `${observation.cohort}\0${observation.taskId}`;
    const pair = byKey.get(key) ?? {};
    if (pair[observation.policy]) issues.push(`duplicate ${observation.policy} evidence for ${observation.cohort} task ${observation.taskId}`);
    pair[observation.policy] = observation;
    byKey.set(key, pair);
  }
  return [...byKey.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([key, pair]) => {
    const [cohort, taskId] = key.split("\0") as [PolicyAdaptationCohort, string];
    if (!pair.baseline || !pair.candidate) {
      issues.push(`${cohort} task ${taskId} is missing paired baseline or candidate evidence`);
      return [];
    }
    if (pair.baseline.taskClass !== pair.candidate.taskClass || pair.baseline.inputHash !== pair.candidate.inputHash) {
      issues.push(`${cohort} task ${taskId} changed class or canonical input`);
    }
    return [{ cohort, taskId, baseline: pair.baseline, candidate: pair.candidate }];
  });
}

function evaluateCohort(
  cohort: PolicyAdaptationCohort,
  allPairs: readonly ObservationPair[],
  input: EvaluatePolicyAdaptationCandidateInput,
  issues: string[],
): PolicyAdaptationCohortEvaluation {
  const pairs = allPairs.filter((pair) => pair.cohort === cohort);
  if (pairs.length < input.minimumSampleSize) {
    issues.push(`${cohort} cohort requires at least ${input.minimumSampleSize} paired samples; received ${pairs.length}`);
  }
  const deltas = pairs.map((pair) => Number(pair.candidate.verifiedSuccess) - Number(pair.baseline.verifiedSuccess));
  const successDelta = mean(deltas);
  const confidencePenalty = pairs.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.sqrt(Math.log(1 / (1 - input.confidenceLevel)) / (2 * pairs.length));
  const lowerBound = successDelta - confidencePenalty;
  if (lowerBound < -input.nonInferiorityMargin) {
    issues.push(`${cohort} paired success confidence bound ${round(lowerBound)} violates non-inferiority`);
  }
  const cacheInvalidationTokenDelta = sum(pairs.map((pair) =>
    pair.candidate.cacheInvalidationTokens - pair.baseline.cacheInvalidationTokens));
  if (cacheInvalidationTokenDelta > input.maximumCacheInvalidationTokenIncrease) {
    issues.push(`${cohort} cache invalidation increased by ${cacheInvalidationTokenDelta} tokens`);
  }
  return {
    cohort,
    sampleSize: pairs.length,
    verifiedSuccessDelta: round(successDelta),
    verifiedSuccessLowerBound: round(lowerBound),
    tokenDelta: sum(pairs.map((pair) => pair.candidate.tokens - pair.baseline.tokens)),
    costDeltaUsd: round(sum(pairs.map((pair) => pair.candidate.costUsd - pair.baseline.costUsd))),
    cacheInvalidationTokenDelta,
  };
}

function validateCohortSemantics(pairs: readonly ObservationPair[], issues: string[]): void {
  for (const pair of pairs) {
    if (!pair.candidate.hardInvariantsPassed) issues.push(`hard invariant failed for ${pair.cohort} task ${pair.taskId}`);
    if (!pair.candidate.cacheIsolationVerified) issues.push(`cache partition isolation is unverified for ${pair.cohort} task ${pair.taskId}`);
    if (pair.baseline.cachePartitionHash === pair.candidate.cachePartitionHash) {
      issues.push(`cache partition collision for ${pair.cohort} task ${pair.taskId}`);
    }
    if (pair.baseline.invalidCacheReuseObserved || pair.candidate.invalidCacheReuseObserved) {
      issues.push(`invalid cache reuse was observed for ${pair.cohort} task ${pair.taskId}`);
    }
    if (pair.cohort === "replay" && pair.candidate.replayDivergenceRecorded !== true) {
      issues.push(`replay divergence evidence is missing for task ${pair.taskId}`);
    }
    if (pair.cohort === "shadow"
      && (pair.candidate.shadowUserVisible !== false || pair.candidate.shadowExternalSideEffectsSuppressed !== true)) {
      issues.push(`shadow isolation failed for task ${pair.taskId}`);
    }
  }
}

function validateRareTasks(
  candidate: PolicyAdaptationCandidate,
  pairs: readonly ObservationPair[],
  issues: string[],
): void {
  for (const commitment of candidate.committedCohorts) {
    const cohortPairs = pairs.filter((pair) => pair.cohort === commitment.cohort);
    for (const requirement of commitment.requiredRareTasks) {
      const rarePairs = cohortPairs.filter((pair) => pair.candidate.taskClass === requirement.taskClass);
      if (rarePairs.length < requirement.minimumSamples) {
        issues.push(`${commitment.cohort} rare task class ${requirement.taskClass} requires ${requirement.minimumSamples} samples; received ${rarePairs.length}`);
      }
      if (rarePairs.some((pair) => pair.baseline.verifiedSuccess && !pair.candidate.verifiedSuccess)) {
        issues.push(`${commitment.cohort} rare task regression for class ${requirement.taskClass}`);
      }
    }
  }
}

function calculateHoldoutDistributionShift(
  candidate: PolicyAdaptationCandidate,
  pairs: readonly ObservationPair[],
): number {
  const holdout = candidate.committedCohorts.find((commitment) => commitment.cohort === "holdout")!;
  const holdoutPairs = pairs.filter((pair) => pair.cohort === "holdout");
  const observedCounts = countTaskClasses(holdoutPairs.map((pair) => pair.candidate.taskClass));
  const classes = new Set([...Object.keys(holdout.referenceTaskClassCounts), ...Object.keys(observedCounts)]);
  const referenceTotal = sum(Object.values(holdout.referenceTaskClassCounts));
  const observedTotal = sum(Object.values(observedCounts));
  if (observedTotal === 0) return 1;
  return round([...classes].reduce((distance, taskClass) => distance
    + Math.abs((holdout.referenceTaskClassCounts[taskClass] ?? 0) / referenceTotal
      - (observedCounts[taskClass] ?? 0) / observedTotal), 0) / 2);
}

export interface PolicyAdaptationMonitorObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly verifiedSuccess: boolean;
  readonly hardInvariantsPassed: boolean;
  readonly invalidCacheReuseObserved: boolean;
  readonly evidenceUri: string;
}

export interface PolicyAdaptationMonitorReport {
  readonly version: "policy-adaptation-monitor-v1";
  readonly candidateId: string;
  readonly status: "stable" | "freeze-recommended";
  readonly distributionShift: number;
  readonly issues: readonly string[];
  readonly evidenceHash: string;
}

export function evaluatePolicyAdaptationMonitor(input: {
  readonly candidate: PolicyAdaptationCandidate;
  readonly observations: readonly PolicyAdaptationMonitorObservation[];
  readonly minimumSampleSize: number;
  readonly maximumDistributionShift: number;
}): PolicyAdaptationMonitorReport {
  if (!Number.isSafeInteger(input.minimumSampleSize) || input.minimumSampleSize < 1) throw new Error("Adaptation monitor sample size must be positive.");
  requireUnit(input.maximumDistributionShift, "Adaptation monitor maximum distribution shift");
  const issues: string[] = [];
  for (const observation of input.observations) {
    requireText(observation.taskId, "Adaptation monitor task id is required.");
    requireText(observation.taskClass, "Adaptation monitor task class is required.");
    requireArtifactUri(observation.evidenceUri);
    if (!observation.verifiedSuccess) issues.push(`post-promotion verification failed for task ${observation.taskId}`);
    if (!observation.hardInvariantsPassed) issues.push(`post-promotion invariant failed for task ${observation.taskId}`);
    if (observation.invalidCacheReuseObserved) issues.push(`post-promotion invalid cache reuse for task ${observation.taskId}`);
  }
  if (input.observations.length < input.minimumSampleSize) issues.push("post-promotion monitor sample is incomplete");
  const holdout = input.candidate.committedCohorts.find((commitment) => commitment.cohort === "holdout")!;
  const referenceTotal = sum(Object.values(holdout.referenceTaskClassCounts));
  const observedCounts = countTaskClasses(input.observations.map((observation) => observation.taskClass));
  const observedTotal = sum(Object.values(observedCounts));
  const classes = new Set([...Object.keys(holdout.referenceTaskClassCounts), ...Object.keys(observedCounts)]);
  const distributionShift = observedTotal === 0 ? 1 : round([...classes].reduce((distance, taskClass) => distance
    + Math.abs((holdout.referenceTaskClassCounts[taskClass] ?? 0) / referenceTotal
      - (observedCounts[taskClass] ?? 0) / observedTotal), 0) / 2);
  if (distributionShift > input.maximumDistributionShift) issues.push("post-promotion distribution shift exceeded the declared bound");
  const normalizedIssues = [...new Set(issues)];
  return {
    version: "policy-adaptation-monitor-v1",
    candidateId: input.candidate.candidateId,
    status: normalizedIssues.length === 0 ? "stable" : "freeze-recommended",
    distributionShift,
    issues: normalizedIssues,
    evidenceHash: hashValue({ candidate: input.candidate.candidateRecordHash, observations: input.observations, maximumDistributionShift: input.maximumDistributionShift }),
  };
}

export interface PolicyAdaptationSelection {
  readonly policyId: string;
  readonly configurationHash: string;
}

export interface PolicyAdaptationActor {
  readonly kind: "operator" | "agent" | "system";
  readonly id: string;
}

export interface PolicyAdaptationTransition {
  readonly sequence: number;
  readonly action: "promote" | "rollback" | "freeze" | "unfreeze";
  readonly requestedBy: PolicyAdaptationActor;
  readonly from: PolicyAdaptationSelection;
  readonly to: PolicyAdaptationSelection;
  readonly approvalId?: string;
  readonly evidenceUris: readonly string[];
  readonly evidenceHashes: readonly string[];
  readonly reason?: string;
}

export interface PolicyAdaptationState {
  readonly version: "policy-adaptation-state-v1";
  readonly revision: number;
  readonly active: PolicyAdaptationSelection;
  readonly frozen: boolean;
  readonly freezeReason?: string;
  readonly transitions: readonly PolicyAdaptationTransition[];
}

export interface TrustedPolicyAdaptationApproval {
  readonly approvalId: string;
  readonly proposalHash: string;
  readonly candidateRecordHash: string;
  readonly evaluationEvidenceHash: string;
  readonly approvedBy: string;
  readonly surface: string;
}

export type PolicyAdaptationControl =
  | { readonly action: "promote"; readonly expectedRevision: number; readonly requestedBy: PolicyAdaptationActor; readonly candidate: PolicyAdaptationCandidate; readonly evaluation: PolicyAdaptationEvaluationReport; readonly approval: TrustedPolicyAdaptationApproval; readonly evidenceUris: readonly string[] }
  | { readonly action: "rollback"; readonly expectedRevision: number; readonly requestedBy: PolicyAdaptationActor; readonly target: PolicyAdaptationSelection; readonly dataMigrationRequired: boolean; readonly approvalId: string; readonly approvalHash: string; readonly evidenceUris: readonly string[] }
  | { readonly action: "freeze"; readonly expectedRevision: number; readonly requestedBy: PolicyAdaptationActor; readonly reason: string; readonly approvalId: string; readonly approvalHash: string; readonly evidenceUris: readonly string[] }
  | { readonly action: "unfreeze"; readonly expectedRevision: number; readonly requestedBy: PolicyAdaptationActor; readonly approvalId: string; readonly approvalHash: string; readonly evidenceUris: readonly string[] };

export function createPolicyAdaptationState(active: PolicyAdaptationSelection): PolicyAdaptationState {
  return { version: "policy-adaptation-state-v1", revision: 0, active: defineSelection(active), frozen: false, transitions: [] };
}

export function applyPolicyAdaptationControl(state: PolicyAdaptationState, control: PolicyAdaptationControl): PolicyAdaptationState {
  if (control.expectedRevision !== state.revision) throw new Error("Policy adaptation state revision is stale.");
  if (control.requestedBy.kind !== "operator") throw new Error("Policy adaptation controls require a trusted operator approval boundary.");
  const requestedBy = { ...control.requestedBy, id: requireText(control.requestedBy.id, "Policy adaptation operator id is required.") };
  const evidenceUris = control.evidenceUris.map(requireArtifactUri);
  const base = { sequence: state.revision + 1, requestedBy, from: state.active, evidenceUris };
  if (control.action === "freeze" || control.action === "unfreeze") {
    const approvalHash = requireSha256(control.approvalHash, "Policy adaptation approval hash");
    const reason = control.action === "freeze" ? requireText(control.reason, "Policy adaptation freeze reason is required.") : undefined;
    return {
      ...state,
      revision: state.revision + 1,
      frozen: control.action === "freeze",
      freezeReason: reason,
      transitions: [...state.transitions, { ...base, action: control.action, to: state.active, approvalId: requireText(control.approvalId, "Approval id is required."), evidenceHashes: [approvalHash], ...(reason ? { reason } : {}) }],
    };
  }
  if (control.action === "promote") {
    if (state.frozen) throw new Error("Policy adaptation is frozen.");
    assertPolicyAdaptationPromotionEvidence(control.candidate, control.evaluation);
    if (control.candidate.basePolicyId !== state.active.policyId || control.candidate.baseConfigurationHash !== state.active.configurationHash) throw new Error("Policy adaptation candidate base selection mismatch.");
    if (control.evaluation.candidateRecordHash !== control.candidate.candidateRecordHash
      || control.evaluation.candidateConfigurationHash !== control.candidate.candidateConfigurationHash
      || control.evaluation.owningComparisonHash !== control.candidate.owningPromotion.comparisonHash) throw new Error("Policy adaptation evaluation does not match the candidate.");
    if (control.approval.candidateRecordHash !== control.candidate.candidateRecordHash
      || control.approval.evaluationEvidenceHash !== control.evaluation.evidenceHash) throw new Error("Policy adaptation approval does not match candidate evidence.");
    const to = { policyId: control.candidate.candidatePolicyId, configurationHash: control.candidate.candidateConfigurationHash };
    return {
      ...state,
      revision: state.revision + 1,
      active: to,
      transitions: [...state.transitions, { ...base, action: "promote", to, approvalId: requireText(control.approval.approvalId, "Approval id is required."), evidenceHashes: [requireSha256(control.approval.proposalHash, "Approval proposal hash"), control.evaluation.evidenceHash] }],
    };
  }
  if (control.dataMigrationRequired) throw new Error("Policy adaptation rollback cannot require data migration.");
  const target = defineSelection(control.target);
  const lastPromotion = [...state.transitions].reverse().find((transition) => transition.action === "promote");
  if (!lastPromotion || stableStringify(lastPromotion.from) !== stableStringify(target) || stableStringify(lastPromotion.to) !== stableStringify(state.active)) throw new Error("Policy adaptation rollback target is not the exact prior selection.");
  return {
    ...state,
    revision: state.revision + 1,
    active: target,
    transitions: [...state.transitions, { ...base, action: "rollback", to: target, approvalId: requireText(control.approvalId, "Approval id is required."), evidenceHashes: [requireSha256(control.approvalHash, "Policy adaptation approval hash")] }],
  };
}

export class PolicyAdaptationEvidenceService {
  constructor(private readonly store: ArtifactResourceStore, private readonly namespace = "policy-adaptation") {}

  persist(kind: "candidate" | "evaluation" | "monitor" | "cohort", value: unknown): { readonly artifactUri: string; readonly evidenceHash: string } {
    const evidenceHash = hashValue(value);
    const metadata = this.store.put({
      namespace: this.namespace,
      title: `Policy adaptation ${kind} evidence`,
      mimeType: "application/json",
      content: { type: "json", value: { kind, evidenceHash, value } },
      producer: { kind: "policy", name: "controlled-adaptation" },
      retention: { scope: "verification" },
    });
    return { artifactUri: `kiln://artifacts/${metadata.namespace}/${metadata.id}/content`, evidenceHash };
  }
}

function defineContextConfiguration(input: PolicyAdaptationContextConfiguration): PolicyAdaptationContextConfiguration {
  if (input.contextAllocationMode !== "whole-block" && input.contextAllocationMode !== "segmented" && input.contextAllocationMode !== "retrieval-on-demand") throw new Error("Policy adaptation context allocation mode is unsupported.");
  return { contextAllocationMode: input.contextAllocationMode };
}

function defineCohortCommitments(input: readonly PolicyAdaptationCohortCommitment[], generatedAt: string): readonly PolicyAdaptationCohortCommitment[] {
  const byCohort = new Map<PolicyAdaptationCohort, PolicyAdaptationCohortCommitment>();
  const fixtureHashes = new Set<string>();
  for (const commitment of input) {
    if (byCohort.has(commitment.cohort)) throw new Error(`Duplicate ${commitment.cohort} cohort commitment.`);
    const frozenAt = requireTimestamp(commitment.frozenAt, "Policy adaptation cohort frozenAt is invalid.");
    if (Date.parse(frozenAt) > Date.parse(generatedAt)) throw new Error("Policy adaptation cohort must be committed before candidate generation.");
    const fixtureSetHash = requireSha256(commitment.fixtureSetHash, "Policy adaptation fixture set hash");
    if (fixtureHashes.has(fixtureSetHash)) throw new Error("Policy adaptation cohort fixture sets must be disjoint.");
    fixtureHashes.add(fixtureSetHash);
    const counts = Object.fromEntries(Object.entries(commitment.referenceTaskClassCounts).map(([taskClass, count]) => {
      requireText(taskClass, "Policy adaptation task class is required.");
      requireNonNegative(count, "Policy adaptation task class count", true);
      if (count === 0) throw new Error("Policy adaptation task class counts must be positive.");
      return [taskClass, count];
    }));
    if (Object.keys(counts).length === 0) throw new Error("Policy adaptation cohort requires task class counts.");
    const rare = commitment.requiredRareTasks.map((requirement) => ({ taskClass: requireText(requirement.taskClass, "Rare task class is required."), minimumSamples: requirePositiveInteger(requirement.minimumSamples, "Rare task minimum samples") }));
    byCohort.set(commitment.cohort, { ...commitment, cohortId: requireText(commitment.cohortId, "Policy adaptation cohort id is required."), fixtureSetHash, inputConfigurationHash: requireSha256(commitment.inputConfigurationHash, "Policy adaptation cohort input configuration hash"), frozenAt, evidenceUri: requireArtifactUri(commitment.evidenceUri), referenceTaskClassCounts: counts, requiredRareTasks: rare });
  }
  for (const cohort of COHORTS) if (!byCohort.has(cohort)) throw new Error(`Policy adaptation requires a committed ${cohort} cohort.`);
  return COHORTS.map((cohort) => byCohort.get(cohort)!);
}

function validateObservation(observation: PolicyAdaptationObservation): void {
  requireText(observation.cohortId, "Policy adaptation observation cohort id is required.");
  requireSha256(observation.fixtureSetHash, "Policy adaptation observation fixture set hash");
  requireText(observation.taskId, "Policy adaptation task id is required.");
  requireText(observation.taskClass, "Policy adaptation task class is required.");
  requireSha256(observation.inputHash, "Policy adaptation input hash");
  requireText(observation.policyId, "Policy adaptation observation policy id is required.");
  requireNonNegative(observation.tokens, "Policy adaptation tokens", true);
  requireNonNegative(observation.costUsd, "Policy adaptation cost");
  requireSha256(observation.cachePartitionHash, "Policy adaptation cache partition hash");
  requireNonNegative(observation.cacheInvalidationTokens, "Policy adaptation cache invalidation tokens", true);
  requireArtifactUri(observation.evidenceUri);
}

function defineSelection(selection: PolicyAdaptationSelection): PolicyAdaptationSelection {
  return { policyId: requireText(selection.policyId, "Policy selection id is required."), configurationHash: requireSha256(selection.configurationHash, "Policy selection configuration hash") };
}

function countTaskClasses(classes: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const taskClass of classes) counts[taskClass] = (counts[taskClass] ?? 0) + 1;
  return counts;
}

function compareObservations(left: PolicyAdaptationObservation, right: PolicyAdaptationObservation): number {
  return `${left.cohort}\0${left.taskId}\0${left.policy}`.localeCompare(`${right.cohort}\0${right.taskId}\0${right.policy}`);
}

function mean(values: readonly number[]): number { return values.length === 0 ? 0 : sum(values) / values.length; }
function sum(values: readonly number[]): number { return values.reduce((total, value) => total + value, 0); }
function round(value: number): number { return Number(value.toFixed(12)); }
function hashValue(value: unknown): string { return `sha256:${createHash("sha256").update(stableStringify(value)).digest("hex")}`; }
function requireText(value: string, message: string): string { const text = value?.trim(); if (!text) throw new Error(message); return text; }
function requireTimestamp(value: string, message: string): string { if (!Number.isFinite(Date.parse(value))) throw new Error(message); return value; }
function requireSha256(value: string, label: string): string { if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be sha256 evidence.`); return value; }
function requireArtifactUri(value: string): string { const uri = requireText(value, "Policy adaptation artifact URI is required."); if (!/^kiln:\/\/artifacts\/[^/]+\/[^/]+\/content$/u.test(uri)) throw new Error("Policy adaptation evidence must use a canonical artifact content URI."); return uri; }
function requireUnit(value: number, label: string): void { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${label} must be between zero and one.`); }
function requireNonNegative(value: number, label: string, integer = false): void { if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) throw new Error(`${label} must be non-negative${integer ? " integer" : ""}.`); }
function requirePositiveInteger(value: number, label: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`); return value; }
function stableStringify(value: unknown): string { if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, entry]) => entry !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`; return JSON.stringify(value); }
