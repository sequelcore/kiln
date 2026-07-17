import {
  resolveNormalizedReasoningEffort,
  type NormalizedReasoningEffortResolution,
  type ReasoningEffort,
} from "@kilnai/core";
import type {
  KilnModelTaskSuitabilityTask,
  KilnReasoningPolicyConfig,
} from "../kiln-yaml-types.js";

export interface ResolveConfiguredReasoningEffortInput {
  readonly explicitReasoningEffort?: ReasoningEffort;
  readonly policy?: KilnReasoningPolicyConfig;
  readonly task?: KilnModelTaskSuitabilityTask;
  readonly provider?: string;
  readonly model?: string;
  readonly supportedReasoningEfforts?: readonly ReasoningEffort[];
  readonly allowExperimentalXhigh?: boolean;
  readonly xhighPromotionEligible?: boolean;
  readonly purpose?: "production" | "benchmark";
  readonly budgetUsd?: number;
  readonly estimatedEffortCostUsd?: number;
}

export function resolveConfiguredReasoningEffort(
  input: ResolveConfiguredReasoningEffortInput,
): ReasoningEffort | undefined {
  const resolution = resolveConfiguredReasoningEffortEvidence(input);
  return resolution.status === "resolved" ? resolution.resolved : undefined;
}

export function resolveConfiguredReasoningEffortEvidence(
  input: ResolveConfiguredReasoningEffortInput,
): NormalizedReasoningEffortResolution {
  const explicit = input.explicitReasoningEffort;
  const desired = explicit ?? desiredReasoningEffort(input.policy, input.task);
  if (!desired) return { status: "omitted", reason: "not-requested" };

  return resolveNormalizedReasoningEffort({
    requested: desired,
    requestedSource: explicit ? "explicit" : "policy",
    supportEvidence: input.supportedReasoningEfforts ? "known" : "unknown",
    supported: input.supportedReasoningEfforts,
    unsupportedPolicy: input.policy?.unsupported ?? (explicit ? "fail" : "omit"),
    allowExperimentalXhigh: input.allowExperimentalXhigh,
    xhighPromotionEligible: input.xhighPromotionEligible,
    purpose: input.purpose,
    budgetUsd: input.budgetUsd,
    estimatedEffortCostUsd: input.estimatedEffortCostUsd,
  });
}

function desiredReasoningEffort(
  policy: KilnReasoningPolicyConfig | undefined,
  task: KilnModelTaskSuitabilityTask | undefined,
): ReasoningEffort | undefined {
  if (!policy) {
    return undefined;
  }
  return (task ? policy.byTask?.[task] : undefined) ?? policy.default;
}
