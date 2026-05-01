import type { MemoryScope } from "../domain/index.js";
import type {
  MemoryLifecycleDecision,
  MemoryLifecycleEvaluationRecord,
} from "./evaluator.js";
import {
  validateMemoryLifecycleAction,
  validateMemoryLifecyclePolicySet,
  type MemoryForgettingPolicy,
} from "./policy.js";

export type MemoryForgettingRejectionReason =
  | "scope-mismatch"
  | "layer-not-forgettable"
  | "audit-preserved";

export interface MemoryForgettingCriteriaResult {
  readonly scope: boolean;
  readonly forgettableLayer: boolean;
  readonly auditPreserved: boolean;
}

export interface MemoryForgettingRejectedRecord {
  readonly recordId: string;
  readonly criteria: MemoryForgettingCriteriaResult;
  readonly reasons: readonly MemoryForgettingRejectionReason[];
}

export interface MemoryForgettingPlanInput {
  readonly policy: MemoryForgettingPolicy;
  readonly policyVersion: string;
  readonly scope?: MemoryScope;
  readonly records: readonly MemoryLifecycleEvaluationRecord[];
}

export interface MemoryForgettingPlan {
  readonly decisions: readonly MemoryLifecycleDecision[];
  readonly rejected: readonly MemoryForgettingRejectedRecord[];
}

export function planMemoryForgetting(input: MemoryForgettingPlanInput): MemoryForgettingPlan {
  validateForgettingPolicy(input.policy, input.policyVersion);
  if (input.policy.requiresExplicitScope && input.scope === undefined) {
    throw new Error("Memory lifecycle forgetting requires explicit scope");
  }

  const decisions: MemoryLifecycleDecision[] = [];
  const rejected: MemoryForgettingRejectedRecord[] = [];
  for (const entry of input.records) {
    const { record } = entry;
    const criteria: MemoryForgettingCriteriaResult = {
      scope: input.scope ? sameScope(record.scope, input.scope) : true,
      forgettableLayer: input.policy.layers.includes(record.layer),
      auditPreserved: record.layer !== "audit",
    };
    const reasons = rejectionReasons(criteria);
    if (reasons.length > 0) {
      rejected.push({
        recordId: record.id,
        criteria,
        reasons,
      });
      continue;
    }

    const action = validateMemoryLifecycleAction({
      type: "forget",
      recordId: record.id,
      scope: record.scope,
      layer: record.layer,
      policyId: input.policy.id,
      policyVersion: input.policyVersion,
      reason: "Memory record met explicit forgetting policy.",
      mode: input.policy.mode,
    });
    decisions.push({
      recordId: record.id,
      policyId: input.policy.id,
      policyVersion: input.policyVersion,
      reason: action.reason,
      action,
    });
  }

  return {
    decisions: decisions.sort(compareDecisions),
    rejected: rejected.sort(compareRejected),
  };
}

function validateForgettingPolicy(policy: MemoryForgettingPolicy, policyVersion: string): void {
  validateMemoryLifecyclePolicySet({
    id: "forgetting-plan-validation",
    version: policyVersion,
    retentionPolicies: [],
    decayPolicies: [],
    forgettingPolicies: [policy],
    compactionPolicies: [],
    promotionPolicies: [],
  });
}

function rejectionReasons(criteria: MemoryForgettingCriteriaResult): readonly MemoryForgettingRejectionReason[] {
  const reasons: MemoryForgettingRejectionReason[] = [];
  if (!criteria.scope) reasons.push("scope-mismatch");
  if (!criteria.forgettableLayer) reasons.push("layer-not-forgettable");
  if (!criteria.auditPreserved) reasons.push("audit-preserved");
  return reasons;
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function compareDecisions(left: MemoryLifecycleDecision, right: MemoryLifecycleDecision): number {
  return left.recordId.localeCompare(right.recordId)
    || left.policyId.localeCompare(right.policyId)
    || left.action.type.localeCompare(right.action.type);
}

function compareRejected(left: MemoryForgettingRejectedRecord, right: MemoryForgettingRejectedRecord): number {
  return left.recordId.localeCompare(right.recordId);
}
