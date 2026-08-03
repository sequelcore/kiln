import {
  defineDeliberationLevelId,
  resolveDeliberation,
  type DeliberationIntent,
  type DeliberationResolution,
  type DeliberationSource,
  type ModelDeliberationCapabilities,
} from "@kilnai/core";
import type {
  KilnDeliberationPolicyConfig,
  KilnDeliberationRuleConfig,
  KilnModelTaskSuitabilityTask,
} from "../kiln-yaml-types.js";

export interface ResolveConfiguredDeliberationInput {
  readonly explicitLevel?: string;
  readonly policy?: KilnDeliberationPolicyConfig;
  readonly task?: KilnModelTaskSuitabilityTask;
  readonly provider?: string;
  readonly model?: string;
  readonly capabilities?: ModelDeliberationCapabilities;
}

export function resolveConfiguredDeliberation(
  input: ResolveConfiguredDeliberationInput,
): DeliberationResolution {
  const configured = selectIntent(input);
  if (!configured) {
    return resolveDeliberation({});
  }
  return resolveDeliberation({
    ...configured,
    capabilities: input.capabilities,
  });
}

function selectIntent(
  input: ResolveConfiguredDeliberationInput,
): {
  readonly intent: DeliberationIntent;
  readonly source: Exclude<DeliberationSource, "provider-default">;
} | undefined {
  if (input.explicitLevel !== undefined) {
    return {
      intent: {
        mode: "fixed",
        preferredLevel: defineDeliberationLevelId(input.explicitLevel),
        onUnsupported: "deny",
      },
      source: "operator",
    };
  }

  const routeRule = input.provider && input.model
    ? input.policy?.byRoute?.find((rule) => rule.provider === input.provider && rule.model === input.model)
    : undefined;
  if (routeRule) {
    return { intent: toIntent(routeRule), source: "route" };
  }

  const taskRule = input.task ? input.policy?.byTask?.[input.task] : undefined;
  if (taskRule) {
    return { intent: toIntent(taskRule), source: "task" };
  }

  if (input.policy?.default) {
    return { intent: toIntent(input.policy.default), source: "project" };
  }
  return undefined;
}

function toIntent(rule: KilnDeliberationRuleConfig): DeliberationIntent {
  const onUnsupported = rule.onUnsupported ?? "deny";
  if (rule.mode === "provider-default") {
    return { mode: "provider-default", onUnsupported };
  }
  const bounds = rule.bounds
    ? {
        ...(rule.bounds.min ? { min: defineDeliberationLevelId(rule.bounds.min) } : {}),
        ...(rule.bounds.max ? { max: defineDeliberationLevelId(rule.bounds.max) } : {}),
      }
    : undefined;
  if (rule.mode === "fixed") {
    return {
      mode: "fixed",
      preferredLevel: defineDeliberationLevelId(rule.preferredLevel),
      ...(bounds ? { bounds } : {}),
      onUnsupported,
    };
  }
  return {
    mode: "adaptive",
    target: rule.target,
    ...(bounds ? { bounds } : {}),
    onUnsupported,
  };
}
