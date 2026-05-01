import type {
  MemoryLayerKind,
  MemoryRelationType,
  MemoryScope,
} from "../domain/index.js";
import type {
  MemoryLifecycleDecision,
  MemoryLifecycleEvaluationRecord,
} from "./evaluator.js";
import {
  validateMemoryLifecycleAction,
  validateMemoryLifecyclePolicySet,
  type MemoryCompactionPolicy,
} from "./policy.js";

export interface MemoryCompactionGroupPlan {
  readonly anchorRecordId: string;
  readonly scope: MemoryScope;
  readonly sourceLayer: MemoryLayerKind;
  readonly targetLayer: MemoryLayerKind;
  readonly topicKey: string;
  readonly sourceRecordIds: readonly string[];
  readonly relationType: Extract<MemoryRelationType, "derived_from">;
  readonly sourceDisposition: "preserve";
}

export interface MemoryCompactionPlanInput {
  readonly policy: MemoryCompactionPolicy;
  readonly policyVersion: string;
  readonly records: readonly MemoryLifecycleEvaluationRecord[];
}

export interface MemoryCompactionPlan {
  readonly decisions: readonly MemoryLifecycleDecision[];
  readonly groups: readonly MemoryCompactionGroupPlan[];
}

export function planMemoryCompactions(input: MemoryCompactionPlanInput): MemoryCompactionPlan {
  validateCompactionPolicy(input.policy, input.policyVersion);
  const grouped = new Map<string, MemoryLifecycleEvaluationRecord[]>();

  for (const entry of input.records) {
    const { record } = entry;
    const topicKey = record.topicKey?.trim();
    if (!topicKey) continue;
    if (!input.policy.sourceLayers.includes(record.layer)) continue;
    const key = `${record.scope.kind}:${record.scope.id}:${record.layer}:${topicKey}`;
    const records = grouped.get(key) ?? [];
    records.push(entry);
    grouped.set(key, records);
  }

  const groups: MemoryCompactionGroupPlan[] = [];
  const decisions: MemoryLifecycleDecision[] = [];
  for (const group of [...grouped.values()]) {
    if (group.length < input.policy.minSourceRecords) continue;
    const sortedGroup = [...group].sort(compareEvaluationRecords);
    const anchor = sortedGroup[0]!.record;
    const topicKey = anchor.topicKey!.trim();
    const action = validateMemoryLifecycleAction({
      type: "create_derived_summary",
      recordId: anchor.id,
      scope: anchor.scope,
      layer: anchor.layer,
      policyId: input.policy.id,
      policyVersion: input.policyVersion,
      reason: "Memory topic group met compaction threshold.",
      targetLayer: input.policy.targetLayer,
    });

    groups.push({
      anchorRecordId: anchor.id,
      scope: anchor.scope,
      sourceLayer: anchor.layer,
      targetLayer: input.policy.targetLayer,
      topicKey,
      sourceRecordIds: sortedGroup.map((entry) => entry.record.id),
      relationType: "derived_from",
      sourceDisposition: "preserve",
    });
    decisions.push({
      recordId: anchor.id,
      policyId: input.policy.id,
      policyVersion: input.policyVersion,
      reason: action.reason,
      action,
    });
  }

  return {
    decisions: decisions.sort(compareDecisions),
    groups: groups.sort(compareGroups),
  };
}

function validateCompactionPolicy(policy: MemoryCompactionPolicy, policyVersion: string): void {
  validateMemoryLifecyclePolicySet({
    id: "compaction-plan-validation",
    version: policyVersion,
    retentionPolicies: [],
    decayPolicies: [],
    forgettingPolicies: [],
    compactionPolicies: [policy],
    promotionPolicies: [],
  });
}

function compareEvaluationRecords(left: MemoryLifecycleEvaluationRecord, right: MemoryLifecycleEvaluationRecord): number {
  return left.record.id.localeCompare(right.record.id);
}

function compareDecisions(left: MemoryLifecycleDecision, right: MemoryLifecycleDecision): number {
  return left.recordId.localeCompare(right.recordId)
    || left.policyId.localeCompare(right.policyId)
    || left.action.type.localeCompare(right.action.type);
}

function compareGroups(left: MemoryCompactionGroupPlan, right: MemoryCompactionGroupPlan): number {
  return left.scope.kind.localeCompare(right.scope.kind)
    || left.scope.id.localeCompare(right.scope.id)
    || left.sourceLayer.localeCompare(right.sourceLayer)
    || left.topicKey.localeCompare(right.topicKey)
    || left.anchorRecordId.localeCompare(right.anchorRecordId);
}
