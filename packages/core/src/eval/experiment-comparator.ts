// compareExperiments: side-by-side comparison of two experiment runs

import type { Experiment } from "./types.js";

export interface ScorerComparison {
  readonly scorerName: string;
  readonly avgScoreA: number;
  readonly avgScoreB: number;
  readonly delta: number;
  readonly improved: boolean;
}

export interface ComparisonResult {
  readonly experimentA: string;
  readonly experimentB: string;
  readonly scorerComparisons: readonly ScorerComparison[];
  readonly summary: string;
}

export interface CachePolicyPromotionInput {
  readonly baseline: Experiment;
  readonly candidate: Experiment;
  readonly baselinePolicyId: string;
  readonly candidatePolicyId: string;
  readonly rollbackPolicyId: string;
  readonly nonInferiorityMargin?: number;
}

export interface CachePolicyPromotionResult {
  readonly status: "promotable" | "blocked";
  readonly baselinePolicyId: string;
  readonly candidatePolicyId: string;
  readonly rollbackPolicyId: string;
  readonly cachedInputTokenDelta: number;
  readonly issues: readonly string[];
}

export function compareExperiments(a: Experiment, b: Experiment): ComparisonResult {
  const scoresA = aggregateScores(a);
  const scoresB = aggregateScores(b);

  const allScorerNames = new Set([...scoresA.keys(), ...scoresB.keys()]);
  const comparisons: ScorerComparison[] = [];

  for (const scorerName of allScorerNames) {
    const avgA = scoresA.get(scorerName) ?? 0;
    const avgB = scoresB.get(scorerName) ?? 0;
    const delta = avgB - avgA;
    comparisons.push({ scorerName, avgScoreA: avgA, avgScoreB: avgB, delta, improved: delta > 0 });
  }

  const improved = comparisons.filter((c) => c.improved).length;
  const regressed = comparisons.filter((c) => c.delta < 0).length;
  const summary = `${b.name} improved in ${improved}/${comparisons.length} scorers, regressed in ${regressed}.`;

  return { experimentA: a.name, experimentB: b.name, scorerComparisons: comparisons, summary };
}

export function evaluateCachePolicyPromotion(input: CachePolicyPromotionInput): CachePolicyPromotionResult {
  const issues: string[] = [];
  if (input.rollbackPolicyId !== input.baselinePolicyId) {
    issues.push("rollback policy must restore the baseline policy");
  }
  if (input.candidatePolicyId === input.baselinePolicyId) {
    issues.push("candidate policy must be distinct from the baseline policy");
  }
  if (input.baseline.datasetName !== input.candidate.datasetName) {
    issues.push("baseline and candidate must use the same dataset");
  }
  if (!experimentPolicyMatches(input.baseline, input.baselinePolicyId)) {
    issues.push("baseline policy evidence does not match declared baseline policy");
  }
  if (!experimentPolicyMatches(input.candidate, input.candidatePolicyId)) {
    issues.push("candidate policy evidence does not match declared candidate policy");
  }

  const baselineByItem = new Map(input.baseline.results.map((result) => [result.itemId, result] as const));
  const candidateByItem = new Map(input.candidate.results.map((result) => [result.itemId, result] as const));
  for (const itemId of new Set([...baselineByItem.keys(), ...candidateByItem.keys()])) {
    const baseline = baselineByItem.get(itemId);
    const candidate = candidateByItem.get(itemId);
    if (!baseline || !candidate) {
      issues.push(`item ${itemId} missing from baseline or candidate`);
      continue;
    }
    if (baseline.output !== candidate.output) {
      issues.push(`item ${itemId} output changed`);
    }
    if (stableStringify(readAuthorityInvariant(baseline.metadata)) !== stableStringify(readAuthorityInvariant(candidate.metadata))) {
      issues.push(`item ${itemId} authority evidence changed`);
    }
    if (stableStringify(readMetadataArray(baseline.metadata, "toolCalls")) !== stableStringify(readMetadataArray(candidate.metadata, "toolCalls"))) {
      issues.push(`item ${itemId} tool trajectory changed`);
    }
  }

  const cachedInputTokenDelta = cachedInputTokens(input.candidate, "candidateCachedInputTokens")
    - cachedInputTokens(input.baseline, "baselineCachedInputTokens");
  if (cachedInputTokenDelta <= 0) {
    issues.push("candidate did not improve cached input tokens");
  }

  const margin = input.nonInferiorityMargin ?? 0;
  for (const comparison of compareExperiments(input.baseline, input.candidate).scorerComparisons) {
    if (comparison.scorerName === "cache-topology") {
      continue;
    }
    if (comparison.delta < -margin) {
      issues.push(`scorer ${comparison.scorerName} regressed by ${comparison.delta}`);
    }
  }

  return {
    status: issues.length === 0 ? "promotable" : "blocked",
    baselinePolicyId: input.baselinePolicyId,
    candidatePolicyId: input.candidatePolicyId,
    rollbackPolicyId: input.rollbackPolicyId,
    cachedInputTokenDelta,
    issues,
  };
}

function aggregateScores(exp: Experiment): Map<string, number> {
  const totals = new Map<string, { sum: number; count: number }>();

  for (const result of exp.results) {
    for (const score of result.scores) {
      const entry = totals.get(score.name) ?? { sum: 0, count: 0 };
      entry.sum += score.score;
      entry.count += 1;
      totals.set(score.name, entry);
    }
  }

  const averages = new Map<string, number>();
  for (const [name, { sum, count }] of totals) {
    averages.set(name, count > 0 ? sum / count : 0);
  }
  return averages;
}

function cachedInputTokens(
  experiment: Experiment,
  field: "baselineCachedInputTokens" | "candidateCachedInputTokens",
): number {
  let total = 0;
  for (const result of experiment.results) {
    const comparisons = readMetadataArray(result.metadata, "cacheGainComparisons");
    for (const comparison of comparisons) {
      if (!comparison || typeof comparison !== "object" || Array.isArray(comparison)) {
        continue;
      }
      const value = (comparison as Record<string, unknown>)[field];
      if (typeof value === "number" && Number.isFinite(value)) {
        total += value;
      }
    }
  }
  return total;
}

function experimentPolicyMatches(experiment: Experiment, policyId: string): boolean {
  return experiment.results.length > 0
    && experiment.results.every((result) => result.metadata?.cachePolicyId === policyId);
}

function readAuthorityInvariant(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  return {
    activeAgentId: metadata?.activeAgentId,
    authority: metadata?.authority,
    effectiveTurnAuthority: metadata?.effectiveTurnAuthority,
    authorityContext: metadata?.authorityContext,
  };
}

function readMetadataArray(metadata: Record<string, unknown> | undefined, key: string): readonly unknown[] {
  const value = metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
