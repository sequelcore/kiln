import { createHash } from "node:crypto";

export interface SkillValueObservation {
  readonly taskId: string;
  readonly condition: "baseline" | "skill";
  readonly passed: boolean;
  readonly qualityScore: number;
  readonly routingCorrect: boolean;
  readonly authorityBoundaryFailures: number;
  readonly modelFacingTokens: number;
  readonly latencyMs: number;
  readonly costUsd: number;
  readonly skillDigest: string;
  readonly candidateSetDigest: string;
  readonly model: string;
  readonly harness: string;
  readonly fixtureVersion: string;
  readonly replayEvidenceId: string;
}

export interface SkillValuePromotionReport {
  readonly policyId: "skill-value-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly baselineSuccessRate: number;
  readonly skillSuccessRate: number;
  readonly meanQualityDelta: number;
  readonly tokenDelta: number;
  readonly latencyDeltaMs: number;
  readonly costDeltaUsd: number;
  readonly regressedTaskIds: readonly string[];
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
}

export function evaluateSkillValuePromotion(
  observations: readonly SkillValueObservation[],
  options: {
    readonly minimumTaskCount?: number;
    readonly minimumMeanQualityDelta?: number;
    readonly maximumMeanTokenIncrease?: number;
    readonly maximumMeanLatencyIncreaseMs?: number;
    readonly maximumMeanCostIncreaseUsd?: number;
  } = {},
): SkillValuePromotionReport {
  const minimum = options.minimumTaskCount ?? 5;
  const groups = new Map<string, Partial<Record<"baseline" | "skill", SkillValueObservation>>>();
  const issues: string[] = [];
  const replayEvidenceIds = new Set<string>();
  for (const observation of observations) {
    validate(observation);
    if (!observation.replayEvidenceId.trim()) issues.push(`${observation.condition} observation lacks replay evidence for task ${observation.taskId}`);
    else if (replayEvidenceIds.has(observation.replayEvidenceId)) issues.push(`replay evidence ${observation.replayEvidenceId} is reused`);
    else replayEvidenceIds.add(observation.replayEvidenceId);
    const group = groups.get(observation.taskId) ?? {};
    if (group[observation.condition]) issues.push(`duplicate ${observation.condition} observation for task ${observation.taskId}`);
    else group[observation.condition] = observation;
    groups.set(observation.taskId, group);
  }
  const pairs = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([taskId, group]) => {
    if (!group.baseline || !group.skill) { issues.push(`task ${taskId} is missing a paired observation`); return []; }
    return [{ taskId, baseline: group.baseline, skill: group.skill }];
  });
  if (pairs.length < minimum) issues.push(`requires at least ${minimum} paired tasks; received ${pairs.length}`);
  const regressedTaskIds = pairs.filter((pair) => pair.baseline.passed && !pair.skill.passed).map((pair) => pair.taskId);
  issues.push(...regressedTaskIds.map((taskId) => `skill regressed task ${taskId}`));
  for (const pair of pairs) {
    for (const field of ["skillDigest", "candidateSetDigest", "model", "harness", "fixtureVersion"] as const) {
      if (pair.baseline[field] !== pair.skill[field]) issues.push(`task ${pair.taskId} has incomparable ${field}`);
    }
    if (!pair.skill.routingCorrect) issues.push(`skill routing was incorrect for task ${pair.taskId}`);
    if (pair.skill.authorityBoundaryFailures > 0) issues.push(`skill crossed an authority boundary for task ${pair.taskId}`);
  }
  const rate = (condition: "baseline" | "skill") => pairs.length === 0 ? 0 : pairs.filter((pair) => pair[condition].passed).length / pairs.length;
  const delta = (field: "qualityScore" | "modelFacingTokens" | "latencyMs" | "costUsd") => pairs.length === 0 ? 0 : pairs.reduce((sum, pair) => sum + pair.skill[field] - pair.baseline[field], 0) / pairs.length;
  const baselineSuccessRate = rate("baseline"); const skillSuccessRate = rate("skill");
  const meanQualityDelta = delta("qualityScore");
  const tokenDelta = delta("modelFacingTokens");
  const latencyDeltaMs = delta("latencyMs");
  const costDeltaUsd = delta("costUsd");
  if (skillSuccessRate < baselineSuccessRate) issues.push("skill success is inferior to baseline");
  if (meanQualityDelta < (options.minimumMeanQualityDelta ?? 0)) issues.push("skill mean quality is inferior to promotion policy");
  if (options.maximumMeanTokenIncrease !== undefined && tokenDelta > options.maximumMeanTokenIncrease) issues.push("skill token increase exceeds promotion policy");
  if (options.maximumMeanLatencyIncreaseMs !== undefined && latencyDeltaMs > options.maximumMeanLatencyIncreaseMs) issues.push("skill latency increase exceeds promotion policy");
  if (options.maximumMeanCostIncreaseUsd !== undefined && costDeltaUsd > options.maximumMeanCostIncreaseUsd) issues.push("skill cost increase exceeds promotion policy");
  return {
    policyId: "skill-value-promotion-v1", comparisonHash: `sha256:${createHash("sha256").update(JSON.stringify(pairs)).digest("hex")}`,
    taskCount: pairs.length, baselineSuccessRate, skillSuccessRate, meanQualityDelta,
    tokenDelta, latencyDeltaMs, costDeltaUsd,
    regressedTaskIds, promotionEligible: issues.length === 0, issues,
  };
}

function validate(observation: SkillValueObservation): void {
  if (!observation.taskId.trim()) throw new Error("Skill value observation requires taskId.");
  for (const field of ["model", "harness", "fixtureVersion"] as const) if (!observation[field].trim()) throw new Error(`Skill value observation requires ${field}.`);
  if (!/^sha256:[a-f0-9]{64}$/.test(observation.skillDigest) || !/^sha256:[a-f0-9]{64}$/.test(observation.candidateSetDigest)) throw new Error("Skill value observations require sha256 digests.");
  for (const field of ["qualityScore", "modelFacingTokens", "latencyMs", "costUsd", "authorityBoundaryFailures"] as const) if (!Number.isFinite(observation[field]) || observation[field] < 0) throw new Error(`${field} must be non-negative.`);
}
