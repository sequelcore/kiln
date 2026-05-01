import type { ContextCandidate } from "../../context/index.js";
import type {
  MemoryLayerKind,
  MemoryRecord,
  MemoryScope,
} from "../domain/index.js";

export type MemoryRecallEligibility = "eligible" | "inhibited";

export interface MemoryRecallEvidence {
  readonly record: MemoryRecord;
  readonly recallSalience?: number;
  readonly useCount?: number;
  readonly lastAdmittedAt?: string;
  readonly noiseScore?: number;
  readonly estimatedTokens?: number;
}

export interface MemoryRecallScoringPolicy {
  readonly eligibilityThreshold: number;
  readonly lowSalienceThreshold: number;
  readonly highNoiseThreshold: number;
  readonly mutableLayerStaleAfterDays: Partial<Record<MemoryLayerKind, number>>;
  readonly layerWeights: Record<MemoryLayerKind, number>;
}

export interface MemoryRecallScoringInput {
  readonly now: string;
  readonly scope: MemoryScope;
  readonly cues?: readonly string[];
  readonly records: readonly MemoryRecallEvidence[];
  readonly policy?: Partial<MemoryRecallScoringPolicy>;
}

export interface MemoryRecallScoreComponents {
  readonly cue: number;
  readonly confidence: number;
  readonly recency: number;
  readonly salience: number;
  readonly usefulness: number;
  readonly layer: number;
  readonly inhibition: number;
}

export interface MemoryRecallCandidate {
  readonly record: MemoryRecord;
  readonly eligibility: MemoryRecallEligibility;
  readonly score: number;
  readonly components: MemoryRecallScoreComponents;
  readonly reasons: readonly string[];
  readonly estimatedTokens?: number;
}

export interface MemoryRecallScoringResult {
  readonly candidates: readonly MemoryRecallCandidate[];
  readonly eligible: readonly MemoryRecallCandidate[];
  readonly inhibited: readonly MemoryRecallCandidate[];
}

const MUTABLE_LAYERS = new Set<MemoryLayerKind>(["working", "episodic", "coordination"]);

const DEFAULT_RECALL_SCORING_POLICY: MemoryRecallScoringPolicy = {
  eligibilityThreshold: 0.25,
  lowSalienceThreshold: 0.25,
  highNoiseThreshold: 0.75,
  mutableLayerStaleAfterDays: {
    working: 2,
    episodic: 90,
    coordination: 21,
  },
  layerWeights: {
    working: 0.9,
    episodic: 0.75,
    semantic: 0.85,
    procedural: 0.8,
    coordination: 0.65,
    audit: 0.2,
  },
};

export function scoreMemoryRecall(input: MemoryRecallScoringInput): MemoryRecallScoringResult {
  const now = parseTime(input.now, "Memory recall scoring time is invalid");
  const policy = mergePolicy(input.policy);
  const cues = normalizeCues(input.cues ?? []);
  const candidates = input.records
    .filter((entry) => sameScope(entry.record.scope, input.scope))
    .map((entry) => scoreCandidate(entry, cues, now, policy))
    .sort(compareRecallCandidates);

  return {
    candidates,
    eligible: candidates.filter((candidate) => candidate.eligibility === "eligible"),
    inhibited: candidates.filter((candidate) => candidate.eligibility === "inhibited"),
  };
}

export function toMemoryContextCandidates(candidates: readonly MemoryRecallCandidate[]): readonly ContextCandidate[] {
  return candidates
    .filter((candidate) => candidate.eligibility === "eligible")
    .map((candidate) => ({
      kind: "memory",
      source: `memory-recall:${candidate.record.layer}`,
      content: candidate.record.content,
      required: false,
      score: candidate.score,
      memoryRecordId: candidate.record.id,
      estimatedTokens: candidate.estimatedTokens,
    }));
}

function scoreCandidate(
  entry: MemoryRecallEvidence,
  cues: readonly string[],
  now: number,
  policy: MemoryRecallScoringPolicy,
): MemoryRecallCandidate {
  const reasons: string[] = ["scope-match"];
  const ageDays = elapsedDays(entry.record.updatedAt ?? entry.record.createdAt, now);
  const cue = scoreCueMatch(entry.record, cues);
  const confidence = clampUnit(entry.record.confidence ?? 0.5);
  const recency = scoreRecency(entry.record.layer, ageDays);
  const rawSalience = clampUnit(entry.recallSalience ?? 1);
  const salience = MUTABLE_LAYERS.has(entry.record.layer)
    ? clampUnit(rawSalience * recency)
    : rawSalience;
  const usefulness = scoreUsefulness(entry, now);
  const layer = policy.layerWeights[entry.record.layer];
  const noise = clampUnit(entry.noiseScore ?? 0);
  const stale = isStaleMutableMemory(entry.record.layer, ageDays, policy);

  if (cue > 0) reasons.push("cue-match");
  if (cue === 0 && cues.length > 0) reasons.push("cue-miss");
  if (usefulness > 0) reasons.push("prior-usefulness");
  if (salience < policy.lowSalienceThreshold) reasons.push("low-salience");
  if (stale) reasons.push("stale-mutable-memory");
  if (noise >= policy.highNoiseThreshold) reasons.push("noise-inhibition");

  const inhibition = clampUnit(
    (cue === 0 && cues.length > 0 ? 0.4 : 0)
    + (salience < policy.lowSalienceThreshold ? 0.25 : 0)
    + (stale ? 0.2 : 0)
    + (noise * 0.35),
  );
  const score = clampUnit(
    (cue * 0.3)
    + (confidence * 0.16)
    + (recency * 0.12)
    + (salience * 0.2)
    + (usefulness * 0.12)
    + (layer * 0.1)
    - inhibition,
  );
  const eligibility = score >= policy.eligibilityThreshold && !(cue === 0 && cues.length > 0) && inhibition < 0.55
    ? "eligible"
    : "inhibited";

  return {
    record: entry.record,
    eligibility,
    score,
    components: {
      cue,
      confidence,
      recency,
      salience,
      usefulness,
      layer,
      inhibition,
    },
    reasons,
    estimatedTokens: entry.estimatedTokens,
  };
}

function scoreCueMatch(record: MemoryRecord, cues: readonly string[]): number {
  if (cues.length === 0) return 0.5;
  const haystack = normalizeSearchText([
    record.topicKey,
    record.content,
    ...record.tags,
  ]);
  const matched = cues.filter((cue) => haystack.includes(cue)).length;
  return matched / cues.length;
}

function scoreRecency(layer: MemoryLayerKind, ageDays: number): number {
  if (layer === "semantic" || layer === "procedural" || layer === "audit") {
    return 1;
  }
  const halfLifeDays = layer === "working"
    ? 2
    : layer === "coordination"
      ? 14
      : 30;
  return clampUnit(1 / (1 + (ageDays / halfLifeDays)));
}

function scoreUsefulness(entry: MemoryRecallEvidence, now: number): number {
  const useCountScore = clampUnit((entry.useCount ?? 0) / 5);
  if (!entry.lastAdmittedAt) {
    return useCountScore;
  }
  const daysSinceAdmission = elapsedDays(entry.lastAdmittedAt, now);
  const admissionScore = clampUnit(1 / (1 + (daysSinceAdmission / 14)));
  return Math.max(useCountScore, admissionScore);
}

function isStaleMutableMemory(
  layer: MemoryLayerKind,
  ageDays: number,
  policy: MemoryRecallScoringPolicy,
): boolean {
  const staleAfterDays = policy.mutableLayerStaleAfterDays[layer];
  return staleAfterDays !== undefined && ageDays > staleAfterDays;
}

function mergePolicy(policy: Partial<MemoryRecallScoringPolicy> | undefined): MemoryRecallScoringPolicy {
  return {
    ...DEFAULT_RECALL_SCORING_POLICY,
    ...policy,
    mutableLayerStaleAfterDays: {
      ...DEFAULT_RECALL_SCORING_POLICY.mutableLayerStaleAfterDays,
      ...policy?.mutableLayerStaleAfterDays,
    },
    layerWeights: {
      ...DEFAULT_RECALL_SCORING_POLICY.layerWeights,
      ...policy?.layerWeights,
    },
  };
}

function compareRecallCandidates(left: MemoryRecallCandidate, right: MemoryRecallCandidate): number {
  return right.score - left.score
    || eligibilityRank(left.eligibility) - eligibilityRank(right.eligibility)
    || left.record.id.localeCompare(right.record.id);
}

function eligibilityRank(eligibility: MemoryRecallEligibility): number {
  return eligibility === "eligible" ? 0 : 1;
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function normalizeCues(cues: readonly string[]): readonly string[] {
  return [...new Set(cues
    .flatMap((cue) => cue.toLowerCase().split(/[^a-z0-9/.-]+/u))
    .map((cue) => cue.trim())
    .filter((cue) => cue.length > 0))];
}

function normalizeSearchText(parts: readonly (string | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== undefined)
    .join(" ")
    .toLowerCase();
}

function elapsedDays(from: string, now: number): number {
  const startedAt = parseTime(from, "Memory recall record time is invalid");
  return Math.max(0, (now - startedAt) / 86_400_000);
}

function parseTime(value: string, message: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(message);
  }
  return parsed;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
