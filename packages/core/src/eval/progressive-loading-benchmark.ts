import { createHash } from "node:crypto";

export type ProgressiveLoadingPolicy = "eager" | "progressive";

export interface ProgressiveLoadingObservation {
  readonly taskId: string;
  readonly policy: ProgressiveLoadingPolicy;
  readonly taskSucceeded: boolean;
  readonly skillInstructionTokens: number;
  readonly irrelevantSkillTokens: number;
  readonly toolSchemaTokens: number;
  readonly irrelevantToolSchemaTokens: number;
  readonly selectionEvidenceId: string;
  readonly replayEvidenceId: string;
}

export interface ProgressiveLoadingPromotionOptions {
  readonly minimumTaskCount?: number;
}

export interface ProgressiveLoadingTokenDelta {
  readonly totalModelFacing: number;
  readonly skillInstructions: number;
  readonly irrelevantSkills: number;
  readonly toolSchemas: number;
  readonly irrelevantToolSchemas: number;
}

export interface ProgressiveLoadingPromotionReport {
  readonly policyId: "progressive-loading-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly eagerSuccessRate: number;
  readonly progressiveSuccessRate: number;
  readonly tokenDelta: ProgressiveLoadingTokenDelta;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
}

interface ObservationPair {
  readonly taskId: string;
  readonly eager: ProgressiveLoadingObservation;
  readonly progressive: ProgressiveLoadingObservation;
}

export function evaluateProgressiveLoadingPromotion(
  observations: readonly ProgressiveLoadingObservation[],
  options: ProgressiveLoadingPromotionOptions = {},
): ProgressiveLoadingPromotionReport {
  const minimumTaskCount = options.minimumTaskCount ?? 5;
  const { pairs, issues: pairingIssues } = pairObservations(observations);
  const eagerSuccessRate = successRate(pairs.map((pair) => pair.eager));
  const progressiveSuccessRate = successRate(pairs.map((pair) => pair.progressive));
  const tokenDelta = calculateTokenDelta(pairs);
  const issues = [
    ...pairingIssues,
    ...(pairs.length >= minimumTaskCount
      ? []
      : [`requires at least ${minimumTaskCount} paired tasks; received ${pairs.length}`]),
    ...(progressiveSuccessRate >= eagerSuccessRate
      ? []
      : ["progressive task success is inferior to eager loading"]),
    ...missingEvidenceIssues(pairs),
    ...(tokenDelta.totalModelFacing < 0 ? [] : ["total model-facing loading tokens did not decline"]),
    ...(tokenDelta.irrelevantSkills < 0 ? [] : ["irrelevant skill tokens did not decline"]),
    ...(tokenDelta.irrelevantToolSchemas < 0 ? [] : ["irrelevant tool-schema tokens did not decline"]),
  ];

  return {
    policyId: "progressive-loading-promotion-v1",
    comparisonHash: hashComparison(pairs),
    taskCount: pairs.length,
    eagerSuccessRate,
    progressiveSuccessRate,
    tokenDelta,
    promotionEligible: issues.length === 0,
    issues,
  };
}

function pairObservations(observations: readonly ProgressiveLoadingObservation[]): {
  readonly pairs: readonly ObservationPair[];
  readonly issues: readonly string[];
} {
  const byTask = new Map<string, Map<ProgressiveLoadingPolicy, ProgressiveLoadingObservation>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateObservation(observation);
    const taskId = observation.taskId.trim();
    const policies = byTask.get(taskId) ?? new Map<ProgressiveLoadingPolicy, ProgressiveLoadingObservation>();
    if (policies.has(observation.policy)) {
      issues.push(`duplicate ${observation.policy} observation for task ${taskId}`);
    } else {
      policies.set(observation.policy, { ...observation, taskId });
    }
    byTask.set(taskId, policies);
  }

  const pairs: ObservationPair[] = [];
  for (const [taskId, policies] of [...byTask.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const eager = policies.get("eager");
    const progressive = policies.get("progressive");
    if (!eager || !progressive) {
      issues.push(`task ${taskId} is missing its ${eager ? "progressive" : "eager"} observation`);
      continue;
    }
    pairs.push({ taskId, eager, progressive });
  }
  return { pairs, issues };
}

function validateObservation(observation: ProgressiveLoadingObservation): void {
  if (observation.taskId.trim().length === 0) {
    throw new Error("Progressive loading observations require a non-empty taskId.");
  }
  for (const [field, value] of Object.entries({
    skillInstructionTokens: observation.skillInstructionTokens,
    irrelevantSkillTokens: observation.irrelevantSkillTokens,
    toolSchemaTokens: observation.toolSchemaTokens,
    irrelevantToolSchemaTokens: observation.irrelevantToolSchemaTokens,
  })) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative safe integer.`);
    }
  }
}

function successRate(observations: readonly ProgressiveLoadingObservation[]): number {
  if (observations.length === 0) return 0;
  return observations.filter((observation) => observation.taskSucceeded).length / observations.length;
}

function calculateTokenDelta(pairs: readonly ObservationPair[]): ProgressiveLoadingTokenDelta {
  const eager = sumTokens(pairs.map((pair) => pair.eager));
  const progressive = sumTokens(pairs.map((pair) => pair.progressive));
  return {
    totalModelFacing:
      progressive.skillInstructionTokens + progressive.toolSchemaTokens
      - eager.skillInstructionTokens - eager.toolSchemaTokens,
    skillInstructions: progressive.skillInstructionTokens - eager.skillInstructionTokens,
    irrelevantSkills: progressive.irrelevantSkillTokens - eager.irrelevantSkillTokens,
    toolSchemas: progressive.toolSchemaTokens - eager.toolSchemaTokens,
    irrelevantToolSchemas: progressive.irrelevantToolSchemaTokens - eager.irrelevantToolSchemaTokens,
  };
}

function sumTokens(observations: readonly ProgressiveLoadingObservation[]): {
  readonly skillInstructionTokens: number;
  readonly irrelevantSkillTokens: number;
  readonly toolSchemaTokens: number;
  readonly irrelevantToolSchemaTokens: number;
} {
  return observations.reduce((total, observation) => ({
    skillInstructionTokens: total.skillInstructionTokens + observation.skillInstructionTokens,
    irrelevantSkillTokens: total.irrelevantSkillTokens + observation.irrelevantSkillTokens,
    toolSchemaTokens: total.toolSchemaTokens + observation.toolSchemaTokens,
    irrelevantToolSchemaTokens: total.irrelevantToolSchemaTokens + observation.irrelevantToolSchemaTokens,
  }), {
    skillInstructionTokens: 0,
    irrelevantSkillTokens: 0,
    toolSchemaTokens: 0,
    irrelevantToolSchemaTokens: 0,
  });
}

function missingEvidenceIssues(pairs: readonly ObservationPair[]): readonly string[] {
  return pairs.flatMap((pair) => [pair.eager, pair.progressive]
    .filter((observation) =>
      observation.selectionEvidenceId.trim().length === 0
      || observation.replayEvidenceId.trim().length === 0)
    .map((observation) =>
      `missing selection or replay evidence for task ${pair.taskId} under ${observation.policy} policy`));
}

function hashComparison(pairs: readonly ObservationPair[]): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(pairs))
    .digest("hex")}`;
}
