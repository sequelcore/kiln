import { KilnYamlError } from "../../../kiln-yaml.js";
import {
  isRecord,
  rejectUnknownFields,
  validateOptionalStringArray,
} from "./shared.js";

export function validateWorkGovernance(value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (!isRecord(value)) {
    throw new KilnYamlError("workGovernance must be an object");
  }
  for (const key of Object.keys(value)) {
    if (
      key !== "defaultPosture"
      && key !== "requireDelegationFor"
      && key !== "requiredEvidence"
      && key !== "boundedWorkCeiling"
    ) {
      throw new KilnYamlError(`Unknown workGovernance field: ${key}`);
    }
  }
  if (value.defaultPosture !== undefined && value.defaultPosture !== "orchestrate" && value.defaultPosture !== "direct") {
    throw new KilnYamlError('workGovernance.defaultPosture must be "orchestrate" or "direct"');
  }
  const requireDelegationFor = value.requireDelegationFor as readonly unknown[] | undefined;
  validateOptionalStringArray(requireDelegationFor, "workGovernance.requireDelegationFor");
  for (const trigger of requireDelegationFor ?? []) {
    if (!isWorkGovernanceTrigger(trigger)) {
      throw new KilnYamlError(`workGovernance.requireDelegationFor contains unsupported trigger: ${trigger}`);
    }
  }
  const requiredEvidence = value.requiredEvidence as readonly unknown[] | undefined;
  validateOptionalStringArray(requiredEvidence, "workGovernance.requiredEvidence");
  for (const evidence of requiredEvidence ?? []) {
    if (!isWorkGovernanceEvidence(evidence)) {
      throw new KilnYamlError(`workGovernance.requiredEvidence contains unsupported evidence: ${evidence}`);
    }
  }
  validateBoundedWorkCeiling(value.boundedWorkCeiling);
}

function validateBoundedWorkCeiling(value: unknown): void {
  if (value === undefined) return;
  if (!isRecord(value)) throw new KilnYamlError("workGovernance.boundedWorkCeiling must be an object");
  rejectUnknownFields(value, ["allowedEffects", "allowedRoots", "deniedRoots", "maximumLimits", "minimumHarnessCapability"], "workGovernance.boundedWorkCeiling");
  validateOptionalStringArray(value.allowedEffects, "workGovernance.boundedWorkCeiling.allowedEffects");
  for (const effect of value.allowedEffects as readonly unknown[] ?? []) {
    if (!isBoundedWorkEffect(effect)) throw new KilnYamlError(`workGovernance.boundedWorkCeiling.allowedEffects contains unsupported effect: ${String(effect)}`);
  }
  validateOptionalStringArray(value.allowedRoots, "workGovernance.boundedWorkCeiling.allowedRoots");
  validateOptionalStringArray(value.deniedRoots, "workGovernance.boundedWorkCeiling.deniedRoots");
  if (value.minimumHarnessCapability !== undefined
    && value.minimumHarnessCapability !== "authoritative"
    && value.minimumHarnessCapability !== "partially_enforced"
    && value.minimumHarnessCapability !== "advisory_only") {
    throw new KilnYamlError("workGovernance.boundedWorkCeiling.minimumHarnessCapability is invalid");
  }
  if (value.maximumLimits !== undefined) {
    if (!isRecord(value.maximumLimits)) throw new KilnYamlError("workGovernance.boundedWorkCeiling.maximumLimits must be an object");
    const allowed = ["maxExecutionAttempts", "maxManagedInvocations", "maxConcurrentManagedInvocations", "maxChildDepth", "maxReviewRounds", "maxRemediationRounds", "maxToolCalls", "maxActiveDurationMs"];
    rejectUnknownFields(value.maximumLimits, allowed, "workGovernance.boundedWorkCeiling.maximumLimits");
    for (const [key, limit] of Object.entries(value.maximumLimits)) {
      if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 0 || (key === "maxExecutionAttempts" && limit < 1)) {
        throw new KilnYamlError(`workGovernance.boundedWorkCeiling.maximumLimits.${key} must be ${key === "maxExecutionAttempts" ? "a positive" : "a non-negative"} safe integer`);
      }
    }
  }
}

function isBoundedWorkEffect(value: unknown): boolean {
  return value === "inspect" || value === "modify_source" || value === "modify_tests"
    || value === "modify_documentation" || value === "modify_configuration"
    || value === "run_verification" || value === "invoke_managed_agent" || value === "external_write";
}

function isWorkGovernanceTrigger(value: unknown): boolean {
  return value === "architecture"
    || value === "security"
    || value === "ui"
    || value === "runtime"
    || value === "provider-routing"
    || value === "managed-agents"
    || value === "config"
    || value === "cross-surface"
    || value === "long-running"
    || value === "verification-heavy"
    || value === "formal-proof-candidate";
}

function isWorkGovernanceEvidence(value: unknown): boolean {
  return value === "surface-map"
    || value === "risk-hypothesis"
    || value === "spec"
    || value === "plan"
    || value === "tests"
    || value === "typecheck"
    || value === "visual-reference-research"
    || value === "browser-qa"
    || value === "managed-agent-review"
    || value === "formal-proof"
    || value === "residual-risk";
}

/**
 * Single emission point for unknown-field rejections.
 *
 * The diagnostic names the build that produced it because an unknown field is
 * ambiguous on its own: it means either the operator wrote a field that does
 * not exist, or the running build predates a field that does.
 */
