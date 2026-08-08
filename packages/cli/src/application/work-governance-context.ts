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
    "- Work governance recommendations are advisory until the operator requests formal tracked execution or the turn intentionally materializes a governed work item.",
    "- Research, comparison, explanation, diagnosis, review, and planning-as-answer turns should report evidence and residual risk without creating work_item, goal, or work_item.execution records unless the operator explicitly asks to track or execute formal work.",
    "- Non-trivial executable work should be decomposed, delegated to configured managed agents when available, verified, and closed with evidence.",
    "- Use work_profile.list and work_item.update/list/complete only after formal governed work is required or explicitly requested. Choose a stable work item id before the first work_item.update call and reuse that id for every later update, execution, evidence, and completion call; never use a temporary provenance id such as pending.",
    "- Use work_item.execution.start/finish for approved goal-bound work so attempt history, evidence, and residual risk are recorded.",
    "- work_item.complete is only for standalone work items. Never use it for a goal-bound item; finish the active attempt with work_item.execution.finish so the owning goal reaches a canonical terminal state.",
    "- Do not stop after scout or local read-only diagnosis when a governed work item has a write-capable route; create/use a goal and call work_item.execution.start.",
    "- If work_item.execution.start pauses for managed delegation, call managed_agent.invoke with the exact managedInvocationRequest object it returned; do not add agentProfile when it is absent, and do not replace a route-owned request with a guessed profile.",
    "- If managedInvocationRequest.executionPhase is intermediate, record that phase evidence with work_item.update after managed_agent.invoke succeeds or after valid recovery, then request the next phase; do not finish the work item until the final phase.",
    "- If managed_agent.invoke returns phaseCompletion or recovery with nextTool = work_item.update, call work_item.update as a tool. Never print workItemUpdateInputTemplate, providedEvidence, or verificationGateResults JSON in assistant text.",
    "- If work_item.execution.start returns recovery.workItemUpdateInputTemplate after a managed child failure, collect the missing evidence locally if possible, replace placeholders with real evidence, call work_item.update with that input, then call work_item.execution.start again before replying.",
    "- When delegating a work item with managed_agent.invoke, pass the work item id, expected evidence, result fields, done criteria, role intent, and residual-risk requirement.",
    "- UI work with an approved-write route must declare phaseRoutes.visual-reference-research before execution; use that read-only web/frontend-reference route for product UI captures when available, or code-backed frontend implementation evidence when the reference has no public screenshots. If local sibling or cloned reference repositories are required, put their concrete root paths in work_item.update referenceRoots so managed_agent.invoke can fail closed before child execution when the selected route cannot read them. Treat repository chrome, stars/forks/issues, and raw file listings alone as source-discovery only.",
    "- If work_item.update rejects with visual_reference_phase_route_required, immediately retry work_item.update as a tool call using its retryInputPatch shape and the configured read-only frontend-reference route; do not paste JSON into assistant text.",
    "- Model self-confidence is not evidence; executable checks, browser QA, formal proof, managed-agent review, and residual-risk reporting are stronger evidence.",
    "- User-facing handoffs must omit scratch notes, private planning text, and tool-output housekeeping.",
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
    modelFacingSemantics: "directive",
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
