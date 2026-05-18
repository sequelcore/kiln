import type { ReasoningEffort } from "@kilnai/core";
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
}

export function resolveConfiguredReasoningEffort(
  input: ResolveConfiguredReasoningEffortInput,
): ReasoningEffort | undefined {
  if (input.explicitReasoningEffort) {
    return input.explicitReasoningEffort;
  }

  const desired = desiredReasoningEffort(input.policy, input.task);
  if (!desired) {
    return undefined;
  }

  const supported = input.supportedReasoningEfforts;
  if (supported?.includes(desired)) {
    return desired;
  }

  if (input.policy?.unsupported === "fail") {
    throw new Error(`Reasoning effort '${desired}' is not supported by ${routeLabel(input)}`);
  }

  return undefined;
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

function routeLabel(input: ResolveConfiguredReasoningEffortInput): string {
  if (input.provider && input.model) {
    return `${input.provider}/${input.model}`;
  }
  if (input.provider) {
    return input.provider;
  }
  if (input.model) {
    return input.model;
  }
  return "selected route";
}
