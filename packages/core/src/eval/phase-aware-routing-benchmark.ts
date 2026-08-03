import { createHash } from "node:crypto";

export type PhaseAwareRouteBenchmarkPolicy = "static-baseline" | "phase-aware-candidate";

export interface PhaseAwareRouteObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly policy: PhaseAwareRouteBenchmarkPolicy;
  readonly verifiedSuccess: boolean;
  readonly verificationContractId: string;
  readonly costUsd: number;
  readonly modelFacingTokens: number;
  readonly latencyMs: number;
  readonly routeEvidenceId: string;
}

export interface PhaseAwareRouteTaskClassComparison {
  readonly taskClass: string;
  readonly taskCount: number;
  readonly baselineSuccessRate: number;
  readonly candidateSuccessRate: number;
  readonly costDeltaUsd: number;
  readonly tokenDelta: number;
  readonly latencyDeltaMs: number;
  readonly verificationContractPreserved: boolean;
  readonly paretoStatus: "dominates" | "noninferior" | "tradeoff" | "regressed";
}

export interface PhaseAwareRoutePromotionReport {
  readonly policyId: "phase-aware-route-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
  readonly taskClasses: readonly PhaseAwareRouteTaskClassComparison[];
}

interface RoutePair {
  readonly taskId: string;
  readonly taskClass: string;
  readonly baseline: PhaseAwareRouteObservation;
  readonly candidate: PhaseAwareRouteObservation;
}

export function evaluatePhaseAwareRoutePromotion(
  observations: readonly PhaseAwareRouteObservation[],
  minimumTaskCount = 5,
): PhaseAwareRoutePromotionReport {
  const { pairs, issues: pairingIssues } = pairRouteObservations(observations);
  const taskClasses = compareRouteTaskClasses(pairs);
  const issues = [
    ...pairingIssues,
    ...(pairs.length >= minimumTaskCount
      ? []
      : [`requires at least ${minimumTaskCount} paired tasks; received ${pairs.length}`]),
    ...taskClasses
      .filter((comparison) => comparison.candidateSuccessRate < comparison.baselineSuccessRate)
      .map((comparison) => `candidate verified success regressed for task class ${comparison.taskClass}`),
    ...pairs
      .filter((pair) => pair.baseline.verificationContractId !== pair.candidate.verificationContractId)
      .map((pair) => `verification contract changed for task ${pair.taskId}`),
    ...pairs.flatMap((pair) => [pair.baseline, pair.candidate]
      .filter((observation) => observation.routeEvidenceId.trim().length === 0)
      .map((observation) => `missing route evidence for task ${pair.taskId} under ${observation.policy}`)),
    ...(taskClasses.some((comparison) => comparison.paretoStatus === "dominates")
      ? []
      : ["phase-aware routing did not dominate the static baseline for any task class"]),
  ];
  return {
    policyId: "phase-aware-route-promotion-v1",
    comparisonHash: comparisonHash(pairs),
    taskCount: pairs.length,
    promotionEligible: issues.length === 0,
    issues,
    taskClasses,
  };
}

export type DeliberationBenchmarkLevel = "high" | "xhigh";

export interface DeliberationObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly level: DeliberationBenchmarkLevel;
  readonly verifiedSuccess: boolean;
  readonly modelFacingTokens: number;
  readonly costUsd: number;
  readonly budgetUsd: number;
  readonly deliberationEvidenceId: string;
}

export interface DeliberationTaskClassComparison {
  readonly taskClass: string;
  readonly taskCount: number;
  readonly highSuccessRate: number;
  readonly xhighSuccessRate: number;
  readonly highValuePerToken: number;
  readonly xhighValuePerToken: number;
  readonly highCostUsd: number;
  readonly xhighCostUsd: number;
}

export interface DeliberationPromotionReport {
  readonly policyId: "deliberation-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
  readonly taskClasses: readonly DeliberationTaskClassComparison[];
}

interface DeliberationPair {
  readonly taskId: string;
  readonly taskClass: string;
  readonly high: DeliberationObservation;
  readonly xhigh: DeliberationObservation;
}

export function evaluateDeliberationPromotion(
  observations: readonly DeliberationObservation[],
  minimumTaskCount = 5,
): DeliberationPromotionReport {
  const { pairs, issues: pairingIssues } = pairDeliberationObservations(observations);
  const taskClasses = compareDeliberationTaskClasses(pairs);
  const issues = [
    ...pairingIssues,
    ...(pairs.length >= minimumTaskCount
      ? []
      : [`requires at least ${minimumTaskCount} paired tasks; received ${pairs.length}`]),
    ...taskClasses
      .filter((comparison) => comparison.xhighSuccessRate < comparison.highSuccessRate)
      .map((comparison) => `xhigh verified success regressed for task class ${comparison.taskClass}`),
    ...taskClasses
      .filter((comparison) => comparison.xhighValuePerToken < comparison.highValuePerToken)
      .map((comparison) => `xhigh value per token regressed for task class ${comparison.taskClass}`),
    ...pairs
      .filter((pair) => pair.xhigh.costUsd > pair.xhigh.budgetUsd)
      .map((pair) => `xhigh exceeded budget for task ${pair.taskId}`),
    ...pairs.flatMap((pair) => [pair.high, pair.xhigh]
      .filter((observation) => observation.deliberationEvidenceId.trim().length === 0)
      .map((observation) => `missing deliberation evidence for task ${pair.taskId} at ${observation.level}`)),
  ];
  return {
    policyId: "deliberation-promotion-v1",
    comparisonHash: comparisonHash(pairs),
    taskCount: pairs.length,
    promotionEligible: issues.length === 0,
    issues,
    taskClasses,
  };
}

function pairRouteObservations(observations: readonly PhaseAwareRouteObservation[]): {
  readonly pairs: readonly RoutePair[];
  readonly issues: readonly string[];
} {
  const byTask = new Map<string, Map<PhaseAwareRouteBenchmarkPolicy, PhaseAwareRouteObservation>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateCommonObservation(observation);
    if (!observation.verificationContractId.trim()) {
      throw new Error("Route observations require a verification contract.");
    }
    const taskId = observation.taskId.trim();
    const policies = byTask.get(taskId) ?? new Map();
    if (policies.has(observation.policy)) issues.push(`duplicate ${observation.policy} observation for task ${taskId}`);
    else policies.set(observation.policy, normalizeObservation(observation));
    byTask.set(taskId, policies);
  }
  const pairs: RoutePair[] = [];
  for (const [taskId, policies] of sortedEntries(byTask)) {
    const baseline = policies.get("static-baseline");
    const candidate = policies.get("phase-aware-candidate");
    if (!baseline || !candidate) {
      issues.push(`task ${taskId} is missing its ${baseline ? "phase-aware-candidate" : "static-baseline"} observation`);
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

function pairDeliberationObservations(observations: readonly DeliberationObservation[]): {
  readonly pairs: readonly DeliberationPair[];
  readonly issues: readonly string[];
} {
  const byTask = new Map<string, Map<DeliberationBenchmarkLevel, DeliberationObservation>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateCommonObservation(observation);
    validateNonNegative(observation.budgetUsd, "Deliberation budgetUsd");
    const taskId = observation.taskId.trim();
    const levels = byTask.get(taskId) ?? new Map();
    if (levels.has(observation.level)) issues.push(`duplicate ${observation.level} observation for task ${taskId}`);
    else levels.set(observation.level, normalizeObservation(observation));
    byTask.set(taskId, levels);
  }
  const pairs: DeliberationPair[] = [];
  for (const [taskId, levels] of sortedEntries(byTask)) {
    const high = levels.get("high");
    const xhigh = levels.get("xhigh");
    if (!high || !xhigh) {
      issues.push(`task ${taskId} is missing its ${high ? "xhigh" : "high"} observation`);
      continue;
    }
    if (high.taskClass !== xhigh.taskClass) {
      issues.push(`task ${taskId} changes task class between deliberation levels`);
      continue;
    }
    pairs.push({ taskId, taskClass: high.taskClass, high, xhigh });
  }
  return { pairs, issues };
}

function compareRouteTaskClasses(pairs: readonly RoutePair[]): readonly PhaseAwareRouteTaskClassComparison[] {
  return taskClasses(pairs).map((taskClass) => {
    const cohort = pairs.filter((pair) => pair.taskClass === taskClass);
    const baselineSuccessRate = successRate(cohort.map((pair) => pair.baseline));
    const candidateSuccessRate = successRate(cohort.map((pair) => pair.candidate));
    const costDeltaUsd = round(sum(cohort.map((pair) => pair.candidate.costUsd - pair.baseline.costUsd)));
    const tokenDelta = sum(cohort.map((pair) => pair.candidate.modelFacingTokens - pair.baseline.modelFacingTokens));
    const latencyDeltaMs = sum(cohort.map((pair) => pair.candidate.latencyMs - pair.baseline.latencyMs));
    const verificationContractPreserved = cohort.every((pair) =>
      pair.baseline.verificationContractId === pair.candidate.verificationContractId);
    const efficiency = [costDeltaUsd, tokenDelta, latencyDeltaMs];
    const paretoStatus = candidateSuccessRate < baselineSuccessRate || !verificationContractPreserved
      ? "regressed" as const
      : efficiency.every((delta) => delta <= 0) && efficiency.some((delta) => delta < 0)
        ? "dominates" as const
        : efficiency.every((delta) => delta === 0)
          ? "noninferior" as const
          : "tradeoff" as const;
    return {
      taskClass,
      taskCount: cohort.length,
      baselineSuccessRate,
      candidateSuccessRate,
      costDeltaUsd,
      tokenDelta,
      latencyDeltaMs,
      verificationContractPreserved,
      paretoStatus,
    };
  });
}

function compareDeliberationTaskClasses(pairs: readonly DeliberationPair[]): readonly DeliberationTaskClassComparison[] {
  return taskClasses(pairs).map((taskClass) => {
    const cohort = pairs.filter((pair) => pair.taskClass === taskClass);
    const highSuccesses = cohort.filter((pair) => pair.high.verifiedSuccess).length;
    const xhighSuccesses = cohort.filter((pair) => pair.xhigh.verifiedSuccess).length;
    const highTokens = sum(cohort.map((pair) => pair.high.modelFacingTokens));
    const xhighTokens = sum(cohort.map((pair) => pair.xhigh.modelFacingTokens));
    return {
      taskClass,
      taskCount: cohort.length,
      highSuccessRate: highSuccesses / cohort.length,
      xhighSuccessRate: xhighSuccesses / cohort.length,
      highValuePerToken: highTokens === 0 ? highSuccesses : highSuccesses / highTokens,
      xhighValuePerToken: xhighTokens === 0 ? xhighSuccesses : xhighSuccesses / xhighTokens,
      highCostUsd: round(sum(cohort.map((pair) => pair.high.costUsd))),
      xhighCostUsd: round(sum(cohort.map((pair) => pair.xhigh.costUsd))),
    };
  });
}

function validateCommonObservation(observation: {
  readonly taskId: string;
  readonly taskClass: string;
  readonly modelFacingTokens: number;
  readonly costUsd: number;
  readonly latencyMs?: number;
}): void {
  if (!observation.taskId.trim() || !observation.taskClass.trim()) {
    throw new Error("Routing benchmark observations require taskId and taskClass.");
  }
  if (!Number.isSafeInteger(observation.modelFacingTokens) || observation.modelFacingTokens < 0) {
    throw new Error("Routing benchmark modelFacingTokens must be a non-negative safe integer.");
  }
  validateNonNegative(observation.costUsd, "Routing benchmark costUsd");
  if (observation.latencyMs !== undefined) validateNonNegative(observation.latencyMs, "Routing benchmark latencyMs");
}

function validateNonNegative(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative finite number.`);
}

function normalizeObservation<T extends { readonly taskId: string; readonly taskClass: string }>(observation: T): T {
  return { ...observation, taskId: observation.taskId.trim(), taskClass: observation.taskClass.trim() };
}

function sortedEntries<K extends string, V>(map: ReadonlyMap<K, V>): readonly [K, V][] {
  return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function taskClasses<T extends { readonly taskClass: string }>(pairs: readonly T[]): readonly string[] {
  return [...new Set(pairs.map((pair) => pair.taskClass))].sort();
}

function successRate(observations: readonly { readonly verifiedSuccess: boolean }[]): number {
  return observations.filter((observation) => observation.verifiedSuccess).length / observations.length;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

function comparisonHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}
