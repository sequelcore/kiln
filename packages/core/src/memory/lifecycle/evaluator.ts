import type { MemoryRecord } from "../domain/index.js";
import {
  validateMemoryLifecycleAction,
  validateMemoryLifecyclePolicySet,
  type MemoryDecayPolicy,
  type MemoryLifecycleAction,
  type MemoryLifecyclePolicySet,
  type MemoryRetentionPolicy,
} from "./policy.js";
import { planMemoryCompactions } from "./compaction.js";
import { planMemoryPromotions } from "./promotion.js";

export interface MemoryLifecycleEvaluationRecord {
  readonly record: MemoryRecord;
  readonly recallSalience?: number;
  readonly useCount?: number;
  readonly lastAdmittedAt?: string;
}

export interface MemoryLifecycleEvaluationInput {
  readonly now: string;
  readonly policySet: MemoryLifecyclePolicySet;
  readonly records: readonly MemoryLifecycleEvaluationRecord[];
}

export interface MemoryLifecycleDecision {
  readonly recordId: string;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly reason: string;
  readonly action: MemoryLifecycleAction;
}

export interface MemoryLifecycleEvaluationResult {
  readonly decisions: readonly MemoryLifecycleDecision[];
}

export function evaluateMemoryLifecycle(input: MemoryLifecycleEvaluationInput): MemoryLifecycleEvaluationResult {
  const policySet = validateMemoryLifecyclePolicySet(input.policySet);
  const now = parseTime(input.now, "Memory lifecycle evaluation time is invalid");
  const records = [...input.records].sort(compareEvaluationRecords);
  const decisions: MemoryLifecycleDecision[] = [];

  for (const entry of records) {
    for (const policy of [...policySet.decayPolicies].sort(compareById)) {
      const decision = evaluateDecay(entry, policySet.version, policy, now);
      if (decision) decisions.push(decision);
    }
    for (const policy of [...policySet.retentionPolicies].sort(compareById)) {
      const decision = evaluateRetention(entry, policySet.version, policy, now);
      if (decision) decisions.push(decision);
    }
    for (const policy of [...policySet.promotionPolicies].sort(compareById)) {
      decisions.push(...planMemoryPromotions({
        policy,
        policyVersion: policySet.version,
        records: [entry],
      }).decisions);
    }
  }

  for (const policy of [...policySet.compactionPolicies].sort(compareById)) {
    decisions.push(...planMemoryCompactions({
      policy,
      policyVersion: policySet.version,
      records,
    }).decisions);
  }

  return {
    decisions: decisions.sort(compareDecisions),
  };
}

function evaluateDecay(
  entry: MemoryLifecycleEvaluationRecord,
  policyVersion: string,
  policy: MemoryDecayPolicy,
  now: number,
): MemoryLifecycleDecision | undefined {
  const { record } = entry;
  if (!policy.layers.includes(record.layer)) return undefined;
  const ageDays = elapsedDays(record.updatedAt ?? record.createdAt, now);
  if (ageDays < policy.halfLifeDays) return undefined;
  const currentSalience = entry.recallSalience ?? 1;
  const targetSalience = Math.min(currentSalience, policy.minSalience);
  if (targetSalience >= currentSalience) return undefined;

  return decision({
    action: validateMemoryLifecycleAction({
      type: "lower_recall_salience",
      recordId: record.id,
      scope: record.scope,
      layer: record.layer,
      policyId: policy.id,
      policyVersion,
      reason: "Memory record age exceeded decay half-life.",
      targetSalience,
    }),
  });
}

function evaluateRetention(
  entry: MemoryLifecycleEvaluationRecord,
  policyVersion: string,
  policy: MemoryRetentionPolicy,
  now: number,
): MemoryLifecycleDecision | undefined {
  const { record } = entry;
  if (!policy.layers.includes(record.layer)) return undefined;
  if (policy.mode === "retain") return undefined;
  if (policy.afterDays === undefined) return undefined;
  const ageDays = elapsedDays(record.updatedAt ?? record.createdAt, now);
  if (ageDays < policy.afterDays) return undefined;

  return decision({
    action: validateMemoryLifecycleAction({
      type: policy.mode === "archive" ? "archive" : "forget",
      recordId: record.id,
      scope: record.scope,
      layer: record.layer,
      policyId: policy.id,
      policyVersion,
      reason: "Memory record exceeded retention window.",
      ...(policy.mode === "forget" ? { mode: "soft_delete" as const } : {}),
    } as MemoryLifecycleAction),
  });
}

function decision(input: { readonly action: MemoryLifecycleAction }): MemoryLifecycleDecision {
  return {
    recordId: input.action.recordId,
    policyId: input.action.policyId,
    policyVersion: input.action.policyVersion,
    reason: input.action.reason,
    action: input.action,
  };
}

function elapsedDays(from: string, now: number): number {
  const startedAt = parseTime(from, "Memory lifecycle record time is invalid");
  return Math.max(0, (now - startedAt) / 86_400_000);
}

function parseTime(value: string, message: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(message);
  }
  return parsed;
}

function compareEvaluationRecords(left: MemoryLifecycleEvaluationRecord, right: MemoryLifecycleEvaluationRecord): number {
  return left.record.id.localeCompare(right.record.id);
}

function compareById(left: { readonly id: string }, right: { readonly id: string }): number {
  return left.id.localeCompare(right.id);
}

function compareDecisions(left: MemoryLifecycleDecision, right: MemoryLifecycleDecision): number {
  return left.recordId.localeCompare(right.recordId)
    || left.policyId.localeCompare(right.policyId)
    || left.action.type.localeCompare(right.action.type);
}
