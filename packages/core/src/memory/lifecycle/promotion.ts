import type { MemoryScope } from "../domain/index.js";
import type {
  MemoryLifecycleDecision,
  MemoryLifecycleEvaluationRecord,
} from "./evaluator.js";
import {
  validateMemoryLifecycleAction,
  validateMemoryLifecyclePolicySet,
  type MemoryPromotionPolicy,
} from "./policy.js";

export type MemoryPromotionRejectionReason =
  | "scope-mismatch"
  | "outside-scope"
  | "source-layer-not-promotable"
  | "insufficient-confidence"
  | "insufficient-utility"
  | "missing-topic-key"
  | "weak-topic-coherence"
  | "weak-provenance";

export interface MemoryPromotionCriteriaResult {
  readonly scope: boolean;
  readonly sourceLayer: boolean;
  readonly confidence: boolean;
  readonly utility: boolean;
  readonly topicCoherence: boolean;
  readonly provenanceQuality: boolean;
}

export interface MemoryPromotionAcceptedCandidate {
  readonly recordId: string;
  readonly criteria: MemoryPromotionCriteriaResult;
  readonly decision: MemoryLifecycleDecision;
}

export interface MemoryPromotionRejectedCandidate {
  readonly recordId: string;
  readonly criteria: MemoryPromotionCriteriaResult;
  readonly reasons: readonly MemoryPromotionRejectionReason[];
}

export interface MemoryPromotionPlanInput {
  readonly policy: MemoryPromotionPolicy;
  readonly policyVersion: string;
  readonly scope?: MemoryScope;
  readonly records: readonly MemoryLifecycleEvaluationRecord[];
}

export interface MemoryPromotionPlan {
  readonly decisions: readonly MemoryLifecycleDecision[];
  readonly accepted: readonly MemoryPromotionAcceptedCandidate[];
  readonly rejected: readonly MemoryPromotionRejectedCandidate[];
}

export function planMemoryPromotions(input: MemoryPromotionPlanInput): MemoryPromotionPlan {
  validatePromotionPolicy(input.policy, input.policyVersion);
  const accepted: MemoryPromotionAcceptedCandidate[] = [];
  const rejected: MemoryPromotionRejectedCandidate[] = [];

  for (const entry of input.records) {
    const record = entry.record;
    const criteria: MemoryPromotionCriteriaResult = {
      scope: input.scope ? sameScope(record.scope, input.scope) : true,
      sourceLayer: input.policy.sourceLayers.includes(record.layer),
      confidence: (record.confidence ?? 0) >= input.policy.minConfidence,
      utility: (entry.useCount ?? 0) >= (input.policy.minUses ?? 0),
      topicCoherence: input.policy.requireTopicKey === true ? hasTopic(record.topicKey) : true,
      provenanceQuality: hasUsableProvenance(record.provenance),
    };
    const reasons = promotionRejectionReasons(criteria);
    if (reasons.length > 0) {
      rejected.push({
        recordId: record.id,
        criteria,
        reasons,
      });
      continue;
    }

    const action = validateMemoryLifecycleAction({
      type: "promote",
      recordId: record.id,
      scope: record.scope,
      layer: record.layer,
      policyId: input.policy.id,
      policyVersion: input.policyVersion,
      reason: "Memory record met promotion criteria.",
      targetLayer: input.policy.targetLayer,
    });
    const decision: MemoryLifecycleDecision = {
      recordId: record.id,
      policyId: input.policy.id,
      policyVersion: input.policyVersion,
      reason: action.reason,
      action,
    };
    accepted.push({
      recordId: record.id,
      criteria,
      decision,
    });
  }

  return {
    decisions: accepted.map((candidate) => candidate.decision).sort(compareDecisions),
    accepted,
    rejected,
  };
}

function validatePromotionPolicy(policy: MemoryPromotionPolicy, policyVersion: string): void {
  validateMemoryLifecyclePolicySet({
    id: "promotion-plan-validation",
    version: policyVersion,
    retentionPolicies: [],
    decayPolicies: [],
    forgettingPolicies: [],
    compactionPolicies: [],
    promotionPolicies: [policy],
  });
}

function promotionRejectionReasons(criteria: MemoryPromotionCriteriaResult): readonly MemoryPromotionRejectionReason[] {
  const reasons: MemoryPromotionRejectionReason[] = [];
  if (!criteria.scope) reasons.push("scope-mismatch");
  if (!criteria.sourceLayer) {
    reasons.push("outside-scope", "source-layer-not-promotable");
  }
  if (!criteria.confidence) reasons.push("insufficient-confidence");
  if (!criteria.utility) reasons.push("insufficient-utility");
  if (!criteria.topicCoherence) reasons.push("missing-topic-key", "weak-topic-coherence");
  if (!criteria.provenanceQuality) reasons.push("weak-provenance");
  return reasons;
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function hasTopic(topicKey: string | undefined): boolean {
  return topicKey !== undefined && topicKey.trim().length > 0;
}

function hasUsableProvenance(provenance: { readonly sourceId: string; readonly capturedAt: string }): boolean {
  return provenance.sourceId.trim().length > 0 && Number.isFinite(Date.parse(provenance.capturedAt));
}

function compareDecisions(left: MemoryLifecycleDecision, right: MemoryLifecycleDecision): number {
  return left.recordId.localeCompare(right.recordId)
    || left.policyId.localeCompare(right.policyId)
    || left.action.type.localeCompare(right.action.type);
}
