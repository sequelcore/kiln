import type { SessionTurnOutcome, ToolResultEvent } from "@kilnai/core";
import type { RuntimeTurnToolCompletion } from "./runtime-turn-record.js";
import type { ToolExecutionSummary } from "./runtime-session-orchestrator.js";

export type GovernedTurnOutcomeToolRecord = RuntimeTurnToolCompletion;

export function deriveGovernedTurnOutcome(input: {
  readonly runtimeToolResults?: readonly ToolResultEvent[];
  readonly surfaceToolCompletions?: readonly RuntimeTurnToolCompletion[];
  readonly toolExecutions?: readonly ToolExecutionSummary[];
}): SessionTurnOutcome | undefined {
  return deriveGovernedTurnOutcomeFromToolRecords(input.runtimeToolResults)
    ?? deriveGovernedTurnOutcomeFromToolRecords(input.surfaceToolCompletions)
    ?? deriveGovernedTurnOutcomeFromToolRecords(input.toolExecutions);
}

export function deriveGovernedTurnOutcomeFromToolRecords(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): SessionTurnOutcome | undefined {
  if ((toolExecutions ?? []).some(isManagedInvocationBlockingExecutionFailure)) {
    return "failed";
  }
  if (hasUnmaterializedOrchestrationRecommendation(toolExecutions)) {
    return "failed";
  }
  if (hasCurrentPendingPauseRequirement(toolExecutions)) {
    return "failed";
  }
  if (hasOpenGovernedWorkWithoutCloseout(toolExecutions)) {
    return "failed";
  }
  if (hasStartedExecutionWithoutTerminalCloseout(toolExecutions)) {
    return "failed";
  }
  const latestGovernanceExecution = (toolExecutions ?? [])
    .filter((execution) => isWorkGovernanceToolName(execution.toolName))
    .at(-1);
  return latestGovernanceExecution?.success === false ? "failed" : undefined;
}

function hasUnmaterializedOrchestrationRecommendation(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const executions = toolExecutions ?? [];
  const assessmentIndex = executions.findLastIndex(isSuccessfulOrchestrationAssessment);
  if (assessmentIndex < 0) {
    return false;
  }
  return !executions
    .slice(assessmentIndex + 1)
    .some(isSuccessfulGovernedWorkMaterialization);
}

function isSuccessfulOrchestrationAssessment(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (execution.toolName !== "work_governance.assess" || !execution.success) {
    return false;
  }
  const recommendation = readGovernanceRecommendation(execution);
  return recommendation === "orchestrate" || recommendation === "delegate";
}

function readGovernanceRecommendation(execution: GovernedTurnOutcomeToolRecord): string | undefined {
  const metadataRecommendation = typeof execution.metadata?.recommendation === "string"
    ? execution.metadata.recommendation.trim().toLowerCase()
    : undefined;
  if (metadataRecommendation) {
    return metadataRecommendation;
  }
  const text = `${execution.output ?? ""}\n${execution.resultSummary ?? ""}`;
  const match = /^\s*recommendation:\s*([a-z_-]+)/im.exec(text);
  return match?.[1]?.trim().toLowerCase();
}

function isSuccessfulGovernedWorkMaterialization(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (!execution.success) {
    return false;
  }
  return execution.toolName === "submit_specification"
    || execution.toolName === "submit_plan"
    || execution.toolName === "goal.create"
    || execution.toolName === "work_item.update"
    || execution.toolName === "work_item.execution.start"
    || execution.toolName === "managed_agent.invoke";
}

function hasCurrentPendingPauseRequirement(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const latestSnapshots = new Map<string, Record<string, unknown>>();
  for (const execution of toolExecutions ?? []) {
    const snapshot = readWorkItemSnapshot(execution);
    if (!snapshot) {
      continue;
    }
    latestSnapshots.set(snapshot.id, snapshot.item);
  }
  for (const item of latestSnapshots.values()) {
    if (workItemHasPendingPauseRequirement(item)) {
      return true;
    }
  }
  return false;
}

function hasOpenGovernedWorkWithoutCloseout(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const executions = toolExecutions ?? [];
  const assessmentIndex = executions.findLastIndex(isSuccessfulOrchestrationAssessment);
  if (assessmentIndex < 0) {
    return false;
  }

  const openSnapshots: Array<{ readonly index: number; readonly item: Record<string, unknown> }> = [];
  for (let index = assessmentIndex + 1; index < executions.length; index += 1) {
    const execution = executions[index];
    if (!execution) {
      continue;
    }
    const snapshot = readWorkItemSnapshot(execution);
    if (!snapshot || !workItemIsOpen(snapshot.item)) {
      continue;
    }
    openSnapshots.push({ index, item: snapshot.item });
  }

  return openSnapshots.some((snapshot) => !executions
    .slice(snapshot.index + 1)
    .some(isSuccessfulGovernedWorkCloseout));
}

function workItemIsOpen(item: Record<string, unknown>): boolean {
  const status = item.status;
  return status === "pending" || status === "in_progress" || status === "blocked";
}

function isSuccessfulGovernedWorkCloseout(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (!execution.success) {
    return false;
  }
  return execution.toolName === "submit_plan"
    || execution.toolName === "work_item.execution.finish"
    || execution.toolName === "work_item.complete";
}

function hasStartedExecutionWithoutTerminalCloseout(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const executions = toolExecutions ?? [];
  const startIndex = executions.findLastIndex((execution) =>
    execution.toolName === "work_item.execution.start" && execution.success,
  );
  if (startIndex < 0) {
    return false;
  }
  return !executions
    .slice(startIndex + 1)
    .some(isSuccessfulTerminalWorkItemCloseout);
}

function isSuccessfulTerminalWorkItemCloseout(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (!execution.success) {
    return false;
  }
  if (execution.toolName !== "work_item.execution.finish" && execution.toolName !== "work_item.complete") {
    return false;
  }
  const snapshot = readWorkItemSnapshot(execution);
  return snapshot ? workItemIsTerminal(snapshot.item) : true;
}

function workItemIsTerminal(item: Record<string, unknown>): boolean {
  const status = item.status;
  return status === "completed" || status === "cancelled";
}

function readWorkItemSnapshot(
  execution: GovernedTurnOutcomeToolRecord,
): { readonly id: string; readonly item: Record<string, unknown> } | undefined {
  if (!isWorkItemToolName(execution.toolName)) {
    return undefined;
  }
  const item = readRecord(execution.metadata?.item) ?? readWorkItemSnapshotFromOutput(execution.output);
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const id = typeof record.id === "string"
    ? record.id.trim()
    : (typeof execution.metadata?.id === "string" ? execution.metadata.id.trim() : "");
  return id ? { id, item: record } : undefined;
}

function readWorkItemSnapshotFromOutput(output: string | undefined): Record<string, unknown> | undefined {
  const parsed = parseJsonRecord(output);
  if (!parsed) {
    return undefined;
  }
  const nestedItem = readRecord(parsed.item);
  if (nestedItem) {
    return nestedItem;
  }
  const nestedOutput = typeof parsed.output === "string" ? readWorkItemSnapshotFromOutput(parsed.output) : undefined;
  if (nestedOutput) {
    return nestedOutput;
  }
  return typeof parsed.id === "string" && typeof parsed.status === "string"
    ? parsed
    : undefined;
}

function parseJsonRecord(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) {
    return undefined;
  }
  try {
    return readRecord(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function workItemHasPendingPauseRequirement(item: Record<string, unknown>): boolean {
  const requirements = item.pauseRequirements;
  if (!Array.isArray(requirements)) {
    return false;
  }
  return requirements.some((candidate) => {
    if (!candidate || typeof candidate !== "object") {
      return false;
    }
    const status = (candidate as Record<string, unknown>).status;
    return status === undefined || status === "pending";
  });
}

function isManagedInvocationBlockingExecutionFailure(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (execution.success) {
    return false;
  }
  if (
    execution.toolName === "work_item.execution.start"
    && execution.metadata?.operation === "managed_invocation_failed"
  ) {
    return true;
  }
  return execution.toolName === "managed_agent.invoke"
    && execution.metadata?.kind === "managed-invocation"
    && isManagedInvocationTerminalFailureStatus(execution.metadata.status);
}

function isManagedInvocationTerminalFailureStatus(status: unknown): boolean {
  return status === "failed"
    || status === "denied"
    || status === "timed-out"
    || status === "cancelled";
}

function isWorkGovernanceToolName(toolName: string): boolean {
  return toolName === "work_governance.assess"
    || toolName === "goal.create"
    || toolName === "work_item.update"
    || toolName === "work_item.complete"
    || toolName === "work_item.execution.start"
    || toolName === "work_item.execution.finish";
}

function isWorkItemToolName(toolName: string): boolean {
  return toolName === "work_item.update"
    || toolName === "work_item.complete"
    || toolName === "work_item.execution.start"
    || toolName === "work_item.execution.finish";
}
