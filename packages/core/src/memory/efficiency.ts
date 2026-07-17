import { createHash } from "node:crypto";
import type { MemoryLayerKind, MemoryProvenance } from "./domain/index.js";

export type MemoryWriteAdmissionDecision = "admit" | "defer" | "reject";
export type MemoryDurability = "short_lived" | "durable";
export type MemoryContradictionState = "none" | "resolved" | "unresolved";
export type MemoryDerivativeTrust = "original" | "verified" | "untrusted";

export interface MemoryWriteAdmissionInput {
  readonly layer: MemoryLayerKind;
  readonly topicKey?: string;
  readonly provenance: MemoryProvenance;
  readonly confidence?: number;
  readonly durability: MemoryDurability;
  readonly futureTaskValue: number;
  readonly contradictionState: MemoryContradictionState;
  readonly derivativeTrust: MemoryDerivativeTrust;
  readonly canonicalEvidenceUris: readonly string[];
}

export type MemoryWriteAdmissionReason =
  | "untrusted-derivative"
  | "unresolved-contradiction"
  | "durability-layer-mismatch"
  | "missing-topic-key"
  | "insufficient-confidence"
  | "insufficient-future-value"
  | "missing-canonical-evidence"
  | "noncanonical-evidence"
  | "invalid-provenance";

export interface MemoryWriteAdmissionResult {
  readonly policyId: "memory-write-admission-v1";
  readonly rollbackPolicyId: "memory-static-write-v1";
  readonly decision: MemoryWriteAdmissionDecision;
  readonly reasons: readonly MemoryWriteAdmissionReason[];
}

const DURABLE_LAYERS = new Set<MemoryLayerKind>(["semantic", "procedural"]);

export function evaluateMemoryWriteAdmission(input: MemoryWriteAdmissionInput): MemoryWriteAdmissionResult {
  requireUnit(input.futureTaskValue, "Memory future task value");
  if (input.confidence !== undefined) requireUnit(input.confidence, "Memory confidence");
  const reasons: MemoryWriteAdmissionReason[] = [];
  if (input.derivativeTrust === "untrusted") reasons.push("untrusted-derivative");
  if (input.contradictionState === "unresolved") reasons.push("unresolved-contradiction");
  if (!hasValidProvenance(input.provenance)) reasons.push("invalid-provenance");
  if (input.durability === "durable" && !DURABLE_LAYERS.has(input.layer) && input.layer !== "audit") {
    reasons.push("durability-layer-mismatch");
  }
  if (DURABLE_LAYERS.has(input.layer)) {
    if (!input.topicKey?.trim()) reasons.push("missing-topic-key");
    if ((input.confidence ?? 0) < 0.7) reasons.push("insufficient-confidence");
    if (input.futureTaskValue < 0.5) reasons.push("insufficient-future-value");
    if (input.canonicalEvidenceUris.length === 0) reasons.push("missing-canonical-evidence");
    if (input.canonicalEvidenceUris.some((uri) => !isCanonicalMemoryEvidenceUri(uri))) {
      reasons.push("noncanonical-evidence");
    }
  }
  const hardReject = reasons.some((reason) =>
    reason === "untrusted-derivative"
    || reason === "unresolved-contradiction"
    || reason === "invalid-provenance"
    || reason === "durability-layer-mismatch");
  return {
    policyId: "memory-write-admission-v1",
    rollbackPolicyId: "memory-static-write-v1",
    decision: hardReject ? "reject" : reasons.length > 0 ? "defer" : "admit",
    reasons,
  };
}

export function isCanonicalMemoryEvidenceUri(uri: string): boolean {
  return /^kiln:\/\/artifacts\/[^/]+\/[^/]+\/content$/u.test(uri)
    || /^kiln:\/\/memory\/nodes\/[^/?#]+$/u.test(uri);
}

export type MemoryEfficiencyOperation = "write" | "recall" | "injection" | "stale_recall";
export type MemoryEfficiencyMetricSource = "measured" | "estimated" | "unknown";

export interface MemoryEfficiencyMetric {
  readonly value: number | "unknown";
  readonly source: MemoryEfficiencyMetricSource;
}

export interface MemoryEfficiencyUsageEntry {
  readonly operation: MemoryEfficiencyOperation;
  readonly layer: MemoryLayerKind;
  readonly tokens: MemoryEfficiencyMetric;
  readonly costUsd: MemoryEfficiencyMetric;
  readonly latencyMs: MemoryEfficiencyMetric;
  readonly evidenceUris: readonly string[];
}

export interface MemoryEfficiencyUsageTotals {
  readonly tokens: number | "unknown";
  readonly costUsd: number | "unknown";
  readonly latencyMs: number | "unknown";
}

export interface MemoryEfficiencyLayerUsage {
  readonly layer: MemoryLayerKind;
  readonly write?: MemoryEfficiencyUsageTotals;
  readonly recall?: MemoryEfficiencyUsageTotals;
  readonly injection?: MemoryEfficiencyUsageTotals;
  readonly stale_recall?: MemoryEfficiencyUsageTotals;
}

export interface MemoryEfficiencyUsageReport {
  readonly version: "memory-efficiency-usage-v1";
  readonly entries: readonly MemoryEfficiencyUsageEntry[];
  readonly byLayer: readonly MemoryEfficiencyLayerUsage[];
}

export function defineMemoryEfficiencyUsageReport(
  input: Omit<MemoryEfficiencyUsageReport, "byLayer">,
): MemoryEfficiencyUsageReport {
  if (input.version !== "memory-efficiency-usage-v1") throw new Error("Memory efficiency usage version is unsupported.");
  const entries = input.entries.map((entry) => ({
    operation: requireOperation(entry.operation),
    layer: requireLayer(entry.layer),
    tokens: defineMetric(entry.tokens, true),
    costUsd: defineMetric(entry.costUsd, false),
    latencyMs: defineMetric(entry.latencyMs, false),
    evidenceUris: entry.evidenceUris.map((uri) => requireText(uri, "Memory efficiency evidence uri is required.")),
  }));
  const layers = [...new Set(entries.map((entry) => entry.layer))].sort();
  return {
    version: input.version,
    entries,
    byLayer: layers.map((layer) => ({
      layer,
      ...Object.fromEntries((["write", "recall", "injection", "stale_recall"] as const).flatMap((operation) => {
        const cohort = entries.filter((entry) => entry.layer === layer && entry.operation === operation);
        return cohort.length === 0 ? [] : [[operation, totalUsage(cohort)]];
      })),
    })),
  };
}

function totalUsage(entries: readonly MemoryEfficiencyUsageEntry[]): MemoryEfficiencyUsageTotals {
  return {
    tokens: totalMetric(entries.map((entry) => entry.tokens)),
    costUsd: totalMetric(entries.map((entry) => entry.costUsd)),
    latencyMs: totalMetric(entries.map((entry) => entry.latencyMs)),
  };
}

export type MemoryOfflineOperation = "correction" | "consolidation" | "expiration" | "forgetting";

export interface MemoryOfflineLifecycleObservation {
  readonly fixtureId: string;
  readonly operation: MemoryOfflineOperation;
  readonly expectedOutcomeObserved: boolean;
  readonly reversible: boolean;
  readonly sourceRecordsPreserved: boolean;
  readonly canonicalEvidencePreserved: boolean;
  readonly staleDetected: boolean;
  readonly contradictionDetected: boolean;
  readonly poisonDetected: boolean;
  readonly evidenceUris: readonly string[];
}

export interface MemoryOfflineLifecycleReport {
  readonly policyId: "memory-offline-lifecycle-v1";
  readonly eligible: boolean;
  readonly issues: readonly string[];
}

export function evaluateMemoryOfflineLifecycle(
  observations: readonly MemoryOfflineLifecycleObservation[],
): MemoryOfflineLifecycleReport {
  const issues: string[] = [];
  const required: readonly MemoryOfflineOperation[] = ["correction", "consolidation", "expiration", "forgetting"];
  for (const operation of required) {
    if (!observations.some((observation) => observation.operation === operation)) issues.push(`missing ${operation} fixture`);
  }
  for (const observation of observations) {
    const id = requireText(observation.fixtureId, "Memory offline fixture id is required.");
    if (!observation.expectedOutcomeObserved) issues.push(`expected outcome was not observed for ${id}`);
    if (!observation.reversible) issues.push(`reconsolidation is not reversible for ${id}`);
    if (!observation.sourceRecordsPreserved) issues.push(`source records were not preserved for ${id}`);
    if (!observation.canonicalEvidencePreserved) issues.push(`canonical evidence was not preserved for ${id}`);
    if (!observation.staleDetected) issues.push(`stale memory was not detected for ${id}`);
    if (!observation.contradictionDetected) issues.push(`contradiction was not detected for ${id}`);
    if (!observation.poisonDetected) issues.push(`poisoned memory was not detected for ${id}`);
    if (observation.evidenceUris.length === 0) issues.push(`offline evidence is missing for ${id}`);
  }
  return { policyId: "memory-offline-lifecycle-v1", eligible: issues.length === 0, issues };
}

export type MemoryEfficiencyPolicy = "static-baseline" | "candidate";

export interface MemoryEfficiencyObservation {
  readonly taskId: string;
  readonly taskClass: string;
  readonly policy: MemoryEfficiencyPolicy;
  readonly verifiedContinuity: boolean;
  readonly replayTokens: number;
  readonly totalCostUsd: number;
  readonly economicsKnown: boolean;
  readonly scopePreserved: boolean;
  readonly authorityPreserved: boolean;
  readonly canonicalEvidencePreserved: boolean;
  readonly revisionLineagePreserved: boolean;
  readonly staleDetected: boolean;
  readonly contradictionDetected: boolean;
  readonly poisonDetected: boolean;
  readonly reconsolidationReversible: boolean;
  readonly usageEvidenceId: string;
}

export interface MemoryEfficiencyPromotionReport {
  readonly policyId: "memory-efficiency-promotion-v1";
  readonly comparisonHash: string;
  readonly taskCount: number;
  readonly promotionEligible: boolean;
  readonly issues: readonly string[];
  readonly replayTokenDelta: number;
  readonly costDeltaUsd: number;
}

export function evaluateMemoryEfficiencyPromotion(
  observations: readonly MemoryEfficiencyObservation[],
  minimumTaskCount = 5,
): MemoryEfficiencyPromotionReport {
  const byTask = new Map<string, Partial<Record<MemoryEfficiencyPolicy, MemoryEfficiencyObservation>>>();
  const issues: string[] = [];
  for (const observation of observations) {
    validateObservation(observation);
    const pair = byTask.get(observation.taskId) ?? {};
    if (pair[observation.policy]) issues.push(`duplicate ${observation.policy} observation for task ${observation.taskId}`);
    pair[observation.policy] = observation;
    byTask.set(observation.taskId, pair);
  }
  const pairs = [...byTask.entries()].sort(([left], [right]) => left.localeCompare(right)).flatMap(([taskId, pair]) => {
    if (!pair["static-baseline"] || !pair.candidate) {
      issues.push(`task ${taskId} is missing a paired observation`);
      return [];
    }
    return [{ taskId, baseline: pair["static-baseline"], candidate: pair.candidate }];
  });
  if (pairs.length < minimumTaskCount) issues.push(`requires at least ${minimumTaskCount} paired tasks; received ${pairs.length}`);
  for (const pair of pairs) {
    if (pair.baseline.taskClass !== pair.candidate.taskClass) issues.push(`task ${pair.taskId} changes task class`);
    if (pair.baseline.verifiedContinuity && !pair.candidate.verifiedContinuity) issues.push(`verified continuity regressed for task ${pair.taskId}`);
    for (const observation of [pair.baseline, pair.candidate]) {
      if (!observation.economicsKnown) issues.push(`memory economics are unknown for task ${pair.taskId} under ${observation.policy}`);
      if (!observation.usageEvidenceId.trim()) issues.push(`memory usage evidence is missing for task ${pair.taskId} under ${observation.policy}`);
    }
    for (const [field, label] of [
      ["scopePreserved", "scope"],
      ["authorityPreserved", "authority"],
      ["canonicalEvidencePreserved", "canonical evidence"],
      ["revisionLineagePreserved", "revision lineage"],
      ["staleDetected", "stale memory detection"],
      ["contradictionDetected", "contradiction detection"],
      ["poisonDetected", "poison detection"],
      ["reconsolidationReversible", "reversible reconsolidation"],
    ] as const) {
      if (!pair.candidate[field]) issues.push(`candidate did not preserve ${label} for task ${pair.taskId}`);
    }
  }
  const replayTokenDelta = pairs.reduce((total, pair) => total + pair.candidate.replayTokens - pair.baseline.replayTokens, 0);
  const costDeltaUsd = Number(pairs.reduce((total, pair) => total + pair.candidate.totalCostUsd - pair.baseline.totalCostUsd, 0).toFixed(12));
  if (replayTokenDelta >= 0) issues.push("candidate did not reduce replay tokens");
  if (costDeltaUsd >= 0) issues.push("candidate did not reduce memory cost");
  return {
    policyId: "memory-efficiency-promotion-v1",
    comparisonHash: `sha256:${createHash("sha256").update(JSON.stringify(pairs)).digest("hex")}`,
    taskCount: pairs.length,
    promotionEligible: issues.length === 0,
    issues,
    replayTokenDelta,
    costDeltaUsd,
  };
}

function defineMetric(metric: MemoryEfficiencyMetric, integer: boolean): MemoryEfficiencyMetric {
  if (metric.source === "unknown" || metric.value === "unknown") {
    if (metric.source !== "unknown" || metric.value !== "unknown") throw new Error("Unknown memory metrics require unknown value and source.");
    return { value: "unknown", source: "unknown" };
  }
  if (metric.source !== "measured" && metric.source !== "estimated") throw new Error("Memory metric source is unsupported.");
  if (!Number.isFinite(metric.value) || metric.value < 0 || (integer && !Number.isSafeInteger(metric.value))) {
    throw new Error("Memory metrics must be non-negative finite values.");
  }
  return metric;
}

function totalMetric(metrics: readonly MemoryEfficiencyMetric[]): number | "unknown" {
  if (metrics.some((metric) => metric.value === "unknown")) return "unknown";
  return Number(metrics.reduce<number>((total, metric) => total + (metric.value as number), 0).toFixed(12));
}

function validateObservation(observation: MemoryEfficiencyObservation): void {
  requireText(observation.taskId, "Memory efficiency task id is required.");
  requireText(observation.taskClass, "Memory efficiency task class is required.");
  if (!Number.isSafeInteger(observation.replayTokens) || observation.replayTokens < 0) throw new Error("Memory replay tokens must be non-negative.");
  if (!Number.isFinite(observation.totalCostUsd) || observation.totalCostUsd < 0) throw new Error("Memory cost must be non-negative.");
}

function requireOperation(value: MemoryEfficiencyOperation): MemoryEfficiencyOperation {
  if (value === "write" || value === "recall" || value === "injection" || value === "stale_recall") return value;
  throw new Error("Memory efficiency operation is unsupported.");
}

function requireLayer(value: MemoryLayerKind): MemoryLayerKind {
  const layers: readonly MemoryLayerKind[] = ["working", "episodic", "semantic", "procedural", "coordination", "audit"];
  if (!layers.includes(value)) throw new Error("Memory layer is unsupported.");
  return value;
}

function hasValidProvenance(provenance: MemoryProvenance): boolean {
  return provenance.sourceId.trim().length > 0 && Number.isFinite(Date.parse(provenance.capturedAt));
}

function requireUnit(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${field} must be between 0 and 1.`);
}

function requireText(value: string, message: string): string {
  const text = value?.trim();
  if (!text) throw new Error(message);
  return text;
}
