import { createHash } from "node:crypto";

export type DelegationEfficiencyStrategy = "direct" | "fresh-context" | "shared-artifact";

export interface DelegationEfficiencySignals {
  readonly taskClass: string;
  readonly breadth: number;
  readonly coupling: number;
  readonly isolationNeed: number;
  readonly uncertainty: number;
  readonly directExecutionAllowed: boolean;
  readonly parentAuthority: number;
  readonly childAuthority: number;
  readonly routeIdentityComplete: boolean;
  readonly verificationContractId: string;
  readonly childVerificationContractId: string;
  readonly canonicalArtifactUris: readonly string[];
  readonly terminalEvidenceAvailable: boolean;
  readonly replayEvidenceAvailable: boolean;
  readonly recoveryEvidenceAvailable: boolean;
}

export interface DelegationEfficiencyDiagnostic {
  readonly code:
    | "authority-widening"
    | "route-identity-incomplete"
    | "verification-contract-mismatch"
    | "noncanonical-resource"
    | "terminal-evidence-missing"
    | "replay-evidence-missing"
    | "recovery-evidence-missing"
    | "direct-execution-denied";
  readonly message: string;
}

export interface DelegationEfficiencyDecision {
  readonly policyId: "delegation-efficiency-candidate-v1";
  readonly signals: DelegationEfficiencySignals;
  readonly selected?: DelegationEfficiencyStrategy;
  readonly rollbackPolicyId: "work-governance-static-v1";
  readonly diagnostics: readonly DelegationEfficiencyDiagnostic[];
}

export function selectDelegationEfficiencyCandidate(
  signals: DelegationEfficiencySignals,
): DelegationEfficiencyDecision {
  validateSignals(signals);
  const diagnostics: DelegationEfficiencyDiagnostic[] = [];
  if (signals.childAuthority > signals.parentAuthority) {
    diagnostics.push({ code: "authority-widening", message: "Child authority exceeds parent authority." });
  }
  if (!signals.routeIdentityComplete) {
    diagnostics.push({ code: "route-identity-incomplete", message: "Managed route or capability identity is incomplete." });
  }
  if (signals.childVerificationContractId !== signals.verificationContractId) {
    diagnostics.push({ code: "verification-contract-mismatch", message: "Delegation changes the required verification contract." });
  }
  if (signals.canonicalArtifactUris.some((uri) => !isCanonicalArtifactContentUri(uri))) {
    diagnostics.push({ code: "noncanonical-resource", message: "Shared context contains a noncanonical artifact resource." });
  }
  if (!signals.terminalEvidenceAvailable) {
    diagnostics.push({ code: "terminal-evidence-missing", message: "Managed terminal lifecycle evidence is unavailable." });
  }
  if (!signals.replayEvidenceAvailable) {
    diagnostics.push({ code: "replay-evidence-missing", message: "Managed replay evidence is unavailable." });
  }
  if (!signals.recoveryEvidenceAvailable) {
    diagnostics.push({ code: "recovery-evidence-missing", message: "Managed recovery evidence is unavailable." });
  }
  const delegationDenied = diagnostics.length > 0;
  let selected: DelegationEfficiencyStrategy | undefined;
  if (!delegationDenied && signals.canonicalArtifactUris.length > 0 && signals.breadth > signals.coupling) {
    selected = "shared-artifact";
  } else if (!delegationDenied && (!signals.directExecutionAllowed || signals.isolationNeed >= 0.5 || signals.breadth > signals.coupling)) {
    selected = "fresh-context";
  } else if (signals.directExecutionAllowed) {
    selected = "direct";
  } else {
    diagnostics.push({ code: "direct-execution-denied", message: "Direct execution is outside the configured governance envelope." });
  }
  return {
    policyId: "delegation-efficiency-candidate-v1",
    signals: { ...signals, canonicalArtifactUris: [...signals.canonicalArtifactUris] },
    ...(selected ? { selected } : {}),
    rollbackPolicyId: "work-governance-static-v1",
    diagnostics,
  };
}

export type DelegationEfficiencyBenchmarkPolicy = "static-baseline" | "candidate";

export interface DelegationEfficiencyObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly policy: DelegationEfficiencyBenchmarkPolicy;
  readonly verifiedSuccess: boolean;
  readonly verificationContractId: string;
  readonly childAuthorityNoWider: boolean;
  readonly terminalHandoffComplete: boolean;
  readonly recoveryEvidenceAvailable: boolean;
  readonly coordinationTokens: number;
  readonly coordinationCostUsd: number;
  readonly coordinationCostKnown: boolean;
  readonly coordinationEvidenceId: string;
}

export interface DelegationEfficiencyTaskClassComparison {
  readonly taskClass: string;
  readonly taskCount: number;
  readonly baselineSuccessRate: number;
  readonly candidateSuccessRate: number;
  readonly tokenDelta: number;
  readonly costDeltaUsd: number;
}

export interface DelegationEfficiencyPromotionReport {
  readonly policyId: "delegation-efficiency-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
  readonly taskClasses: readonly DelegationEfficiencyTaskClassComparison[];
}

interface ObservationPair {
  readonly taskId: string;
  readonly taskClass: string;
  readonly baseline: DelegationEfficiencyObservation;
  readonly candidate: DelegationEfficiencyObservation;
}

export function evaluateDelegationEfficiencyPromotion(
  observations: readonly DelegationEfficiencyObservation[],
  minimumTaskCount = 5,
): DelegationEfficiencyPromotionReport {
  const { pairs, issues: pairingIssues } = pairObservations(observations);
  const taskClasses = compareTaskClasses(pairs);
  const issues = [
    ...pairingIssues,
    ...(pairs.length >= minimumTaskCount
      ? []
      : [`requires at least ${minimumTaskCount} paired tasks; received ${pairs.length}`]),
    ...taskClasses
      .filter((comparison) => comparison.candidateSuccessRate < comparison.baselineSuccessRate)
      .map((comparison) => `candidate verified success regressed for task class ${comparison.taskClass}`),
    ...(taskClasses.some((comparison) => comparison.tokenDelta < 0 || comparison.costDeltaUsd < 0)
      ? []
      : ["candidate did not reduce coordination cost for any task class"]),
    ...pairs
      .filter((pair) => pair.baseline.verificationContractId !== pair.candidate.verificationContractId)
      .map((pair) => `verification contract changed for task ${pair.taskId}`),
    ...pairs
      .filter((pair) => !pair.candidate.childAuthorityNoWider)
      .map((pair) => `candidate widened child authority for task ${pair.taskId}`),
    ...pairs
      .filter((pair) => !pair.candidate.terminalHandoffComplete)
      .map((pair) => `candidate produced an incomplete terminal handoff for task ${pair.taskId}`),
    ...pairs
      .filter((pair) => !pair.candidate.recoveryEvidenceAvailable)
      .map((pair) => `candidate is missing recovery evidence for task ${pair.taskId}`),
    ...pairs.flatMap((pair) => [pair.baseline, pair.candidate]
      .filter((observation) => !observation.coordinationCostKnown)
      .map((observation) => `coordination cost is unknown for task ${pair.taskId} under ${observation.policy}`)),
    ...pairs.flatMap((pair) => [pair.baseline, pair.candidate]
      .filter((observation) => observation.coordinationEvidenceId.trim().length === 0)
      .map((observation) => `missing coordination evidence for task ${pair.taskId} under ${observation.policy}`)),
  ];
  return {
    policyId: "delegation-efficiency-promotion-v1",
    comparisonHash: `sha256:${createHash("sha256").update(JSON.stringify(pairs)).digest("hex")}`,
    taskCount: pairs.length,
    promotionEligible: issues.length === 0,
    issues,
    taskClasses,
  };
}

export function isCanonicalArtifactContentUri(uri: string): boolean {
  return /^kiln:\/\/artifacts\/[^/]+\/[^/]+\/content$/u.test(uri);
}

function validateSignals(signals: DelegationEfficiencySignals): void {
  if (!signals.taskClass.trim() || !signals.verificationContractId.trim() || !signals.childVerificationContractId.trim()) {
    throw new Error("Delegation efficiency signals require task class and verification contracts.");
  }
  for (const value of [signals.breadth, signals.coupling, signals.isolationNeed, signals.uncertainty]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error("Delegation efficiency normalized signals must be between 0 and 1.");
    }
  }
  for (const value of [signals.parentAuthority, signals.childAuthority]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("Delegation efficiency authority levels must be non-negative safe integers.");
    }
  }
}

function pairObservations(observations: readonly DelegationEfficiencyObservation[]): {
  readonly pairs: readonly ObservationPair[];
  readonly issues: readonly string[];
} {
  const byTask = new Map<string, Map<DelegationEfficiencyBenchmarkPolicy, DelegationEfficiencyObservation>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateObservation(observation);
    const taskId = observation.taskId.trim();
    const policies = byTask.get(taskId) ?? new Map();
    if (policies.has(observation.policy)) issues.push(`duplicate ${observation.policy} observation for task ${taskId}`);
    else policies.set(observation.policy, { ...observation, taskId, taskClass: observation.taskClass.trim() });
    byTask.set(taskId, policies);
  }
  const pairs: ObservationPair[] = [];
  for (const [taskId, policies] of [...byTask.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const baseline = policies.get("static-baseline");
    const candidate = policies.get("candidate");
    if (!baseline || !candidate) {
      issues.push(`task ${taskId} is missing its ${baseline ? "candidate" : "static-baseline"} observation`);
      continue;
    }
    if (baseline.taskClass !== candidate.taskClass) {
      issues.push(`task ${taskId} changes task class between policies`);
      continue;
    }
    pairs.push({ taskId, taskClass: baseline.taskClass, baseline, candidate });
  }
  return { pairs, issues };
}

function validateObservation(observation: DelegationEfficiencyObservation): void {
  if (!observation.taskId.trim() || !observation.taskClass.trim() || !observation.verificationContractId.trim()) {
    throw new Error("Delegation efficiency observations require task, class, and verification contract identity.");
  }
  if (!Number.isSafeInteger(observation.coordinationTokens) || observation.coordinationTokens < 0) {
    throw new Error("Delegation coordination tokens must be a non-negative safe integer.");
  }
  if (!Number.isFinite(observation.coordinationCostUsd) || observation.coordinationCostUsd < 0) {
    throw new Error("Delegation coordination cost must be a non-negative finite number.");
  }
}

function compareTaskClasses(pairs: readonly ObservationPair[]): readonly DelegationEfficiencyTaskClassComparison[] {
  return [...new Set(pairs.map((pair) => pair.taskClass))].sort().map((taskClass) => {
    const cohort = pairs.filter((pair) => pair.taskClass === taskClass);
    return {
      taskClass,
      taskCount: cohort.length,
      baselineSuccessRate: cohort.filter((pair) => pair.baseline.verifiedSuccess).length / cohort.length,
      candidateSuccessRate: cohort.filter((pair) => pair.candidate.verifiedSuccess).length / cohort.length,
      tokenDelta: cohort.reduce((total, pair) =>
        total + pair.candidate.coordinationTokens - pair.baseline.coordinationTokens, 0),
      costDeltaUsd: Number(cohort.reduce((total, pair) =>
        total + pair.candidate.coordinationCostUsd - pair.baseline.coordinationCostUsd, 0).toFixed(12)),
    };
  });
}
