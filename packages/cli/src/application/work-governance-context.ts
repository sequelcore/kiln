import type { ContextCandidate } from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { defaultBuildSystemPrompt } from "../config.js";
import type { KilnWorkGovernanceConfig } from "../kiln-yaml-types.js";

const WORK_GOVERNANCE_SCORE = 0.97;

export function buildWorkGovernanceContext(config: KilnWorkGovernanceConfig | undefined): string | undefined {
  if (!config) {
    return undefined;
  }

  const lines = [
    "## Work Governance",
    "Source: resolved Kiln workGovernance config.",
    config.defaultPosture ? `- Default posture: ${config.defaultPosture}` : undefined,
    config.directExecution ? formatDirectExecution(config.directExecution) : undefined,
    config.requireDelegationFor && config.requireDelegationFor.length > 0
      ? `- Require orchestration/delegation for: ${config.requireDelegationFor.join(", ")}`
      : undefined,
    config.requiredEvidence && config.requiredEvidence.length > 0
      ? `- Evidence expected before done: ${config.requiredEvidence.join(", ")}`
      : undefined,
    "",
    "Interpretation:",
    "- Direct execution is allowed only for local, low-risk work inside the configured direct-execution envelope.",
    "- Non-trivial work should be decomposed, delegated to configured managed agents when available, verified, and closed with evidence.",
    "- Use work_profile.list and work_item.update/list/complete to track broad work and fail closed on missing evidence.",
    "- When delegating a work item with managed_agent.invoke, pass the work item id, expected evidence, result fields, done criteria, role intent, and residual-risk requirement.",
    "- Model self-confidence is not evidence; executable checks, browser QA, formal proof, managed-agent review, and residual-risk reporting are stronger evidence.",
  ].filter((line): line is string => line !== undefined);

  return lines.join("\n");
}

export function buildWorkGovernanceContextCandidate(
  config: KilnWorkGovernanceConfig | undefined,
): ContextCandidate | undefined {
  const content = buildWorkGovernanceContext(config);
  if (!content) {
    return undefined;
  }

  return {
    kind: "instruction",
    source: "work-governance:resolved-kiln-config#workGovernance",
    content,
    required: true,
    score: WORK_GOVERNANCE_SCORE,
  };
}

export function withWorkGovernanceContext(
  appConfig: KilnAppConfig,
  config: KilnWorkGovernanceConfig | undefined,
): KilnAppConfig {
  const candidate = buildWorkGovernanceContextCandidate(config);
  if (!candidate) {
    return appConfig;
  }

  return {
    ...appConfig,
    buildSystemPrompt: appConfig.buildSystemPrompt ?? defaultBuildSystemPrompt,
    contextCandidates: [
      ...(appConfig.contextCandidates ?? []),
      candidate,
    ],
  };
}

function formatDirectExecution(config: NonNullable<KilnWorkGovernanceConfig["directExecution"]>): string {
  const parts = [
    config.maxFiles !== undefined ? `maxFiles=${config.maxFiles}` : undefined,
    config.maxRisk ? `maxRisk=${config.maxRisk}` : undefined,
  ].filter((part): part is string => part !== undefined);
  return `- Direct execution envelope: ${parts.length > 0 ? parts.join(", ") : "configured"}`;
}
