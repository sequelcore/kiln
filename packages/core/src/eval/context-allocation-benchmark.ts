import { createHash } from "node:crypto";

export type ContextAllocationBenchmarkPolicy = "whole-block-baseline" | "candidate";

export interface ContextAllocationObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly policy: ContextAllocationBenchmarkPolicy;
  readonly verifiedSuccess: boolean;
  readonly modelFacingTokens: number;
  readonly requiredContextPreserved: boolean;
  readonly auditEvidenceId: string;
}

export interface ContextAllocationTaskClassComparison {
  readonly taskClass: string;
  readonly taskCount: number;
  readonly baselineSuccessRate: number;
  readonly candidateSuccessRate: number;
  readonly baselineTokens: number;
  readonly candidateTokens: number;
  readonly tokenDelta: number;
}

export interface ContextAllocationPromotionReport {
  readonly policyId: "context-allocation-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
  readonly taskClasses: readonly ContextAllocationTaskClassComparison[];
}

interface ContextAllocationPair {
  readonly taskId: string;
  readonly taskClass: string;
  readonly baseline: ContextAllocationObservation;
  readonly candidate: ContextAllocationObservation;
}

export function evaluateContextAllocationPromotion(
  observations: readonly ContextAllocationObservation[],
  minimumTaskCount = 5,
): ContextAllocationPromotionReport {
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
    ...(taskClasses.some((comparison) =>
      comparison.candidateSuccessRate >= comparison.baselineSuccessRate && comparison.tokenDelta < 0)
      ? []
      : ["candidate did not reduce model-facing tokens for any non-inferior task class"]),
    ...pairs
      .filter((pair) => !pair.candidate.requiredContextPreserved)
      .map((pair) => `candidate violated required context for task ${pair.taskId}`),
    ...pairs.flatMap((pair) => [pair.baseline, pair.candidate]
      .filter((observation) => observation.auditEvidenceId.trim().length === 0)
      .map((observation) =>
        `missing allocation audit evidence for task ${pair.taskId} under ${observation.policy} policy`)),
  ];

  return {
    policyId: "context-allocation-promotion-v1",
    comparisonHash: `sha256:${createHash("sha256").update(JSON.stringify(pairs)).digest("hex")}`,
    taskCount: pairs.length,
    promotionEligible: issues.length === 0,
    issues,
    taskClasses,
  };
}

function pairObservations(observations: readonly ContextAllocationObservation[]): {
  readonly pairs: readonly ContextAllocationPair[];
  readonly issues: readonly string[];
} {
  const byTask = new Map<string, Map<ContextAllocationBenchmarkPolicy, ContextAllocationObservation>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateObservation(observation);
    const taskId = observation.taskId.trim();
    const policies = byTask.get(taskId) ?? new Map();
    if (policies.has(observation.policy)) issues.push(`duplicate ${observation.policy} observation for task ${taskId}`);
    else policies.set(observation.policy, { ...observation, taskId, taskClass: observation.taskClass.trim() });
    byTask.set(taskId, policies);
  }
  const pairs: ContextAllocationPair[] = [];
  for (const [taskId, policies] of [...byTask.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const baseline = policies.get("whole-block-baseline");
    const candidate = policies.get("candidate");
    if (!baseline || !candidate) {
      issues.push(`task ${taskId} is missing its ${baseline ? "candidate" : "whole-block-baseline"} observation`);
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

function validateObservation(observation: ContextAllocationObservation): void {
  if (observation.taskId.trim().length === 0 || observation.taskClass.trim().length === 0) {
    throw new Error("Context allocation observations require taskId and taskClass.");
  }
  if (!Number.isSafeInteger(observation.modelFacingTokens) || observation.modelFacingTokens < 0) {
    throw new Error("Context allocation modelFacingTokens must be a non-negative safe integer.");
  }
}

function compareTaskClasses(
  pairs: readonly ContextAllocationPair[],
): readonly ContextAllocationTaskClassComparison[] {
  const taskClasses = [...new Set(pairs.map((pair) => pair.taskClass))].sort();
  return taskClasses.map((taskClass) => {
    const cohort = pairs.filter((pair) => pair.taskClass === taskClass);
    const baselineTokens = cohort.reduce((total, pair) => total + pair.baseline.modelFacingTokens, 0);
    const candidateTokens = cohort.reduce((total, pair) => total + pair.candidate.modelFacingTokens, 0);
    return {
      taskClass,
      taskCount: cohort.length,
      baselineSuccessRate: cohort.filter((pair) => pair.baseline.verifiedSuccess).length / cohort.length,
      candidateSuccessRate: cohort.filter((pair) => pair.candidate.verifiedSuccess).length / cohort.length,
      baselineTokens,
      candidateTokens,
      tokenDelta: candidateTokens - baselineTokens,
    };
  });
}
