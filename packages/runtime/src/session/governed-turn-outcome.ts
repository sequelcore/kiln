import type { SessionTurnOutcome, ToolResultEvent } from "@kilnai/core";
import type { RuntimeTurnToolCompletion } from "./runtime-turn-record.js";
import type { ToolExecutionSummary } from "./runtime-session-orchestrator.js";
import {
  RUNTIME_SESSION_GOVERNED_WORK_MATERIALIZATION_REQUIRED_STOP_REASON,
  RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON,
  RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON,
  RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON,
} from "./runtime-session-orchestrator.types.js";

export type GovernedTurnOutcomeToolRecord = RuntimeTurnToolCompletion;

export function deriveRuntimeTurnOutcome(input: {
  readonly runtimeToolResults?: readonly ToolResultEvent[];
  readonly surfaceToolCompletions?: readonly RuntimeTurnToolCompletion[];
  readonly toolExecutions?: readonly ToolExecutionSummary[];
  readonly stopReason?: string;
}): SessionTurnOutcome {
  if (input.stopReason === RUNTIME_SESSION_TOOL_ROUND_BUDGET_EXHAUSTED_STOP_REASON) {
    return "paused";
  }
  if (
    input.stopReason === RUNTIME_SESSION_NO_TOOL_FINALIZATION_FAILED_STOP_REASON
    || input.stopReason === RUNTIME_SESSION_MANAGED_INVOCATION_STATE_TRANSITION_REQUIRED_STOP_REASON
    || input.stopReason === RUNTIME_SESSION_GOVERNED_WORK_MATERIALIZATION_REQUIRED_STOP_REASON
  ) {
    return "failed";
  }
  return deriveGovernedTurnOutcome(input) ?? "completed";
}

export function deriveGovernedTurnOutcome(input: {
  readonly runtimeToolResults?: readonly ToolResultEvent[];
  readonly surfaceToolCompletions?: readonly RuntimeTurnToolCompletion[];
  readonly toolExecutions?: readonly ToolExecutionSummary[];
}): SessionTurnOutcome | undefined {
  const evidencePlanes = [
    input.runtimeToolResults,
    input.surfaceToolCompletions,
    input.toolExecutions,
  ].filter((records): records is readonly GovernedTurnOutcomeToolRecord[] => Boolean(records?.length));
  const observedGoalIds = new Set(evidencePlanes.flatMap(readObservedGoalIds));
  const completedGoalIds = new Set(evidencePlanes.flatMap(readCompletedGoalIds));
  const everyObservedGoalCompleted = observedGoalIds.size > 0
    && [...observedGoalIds].every((goalId) => completedGoalIds.has(goalId));
  const combinedEvidence = evidencePlanes.flat();

  if (
    everyObservedGoalCompleted
    && !hasUnresolvedManagedInvocationBlockingExecutionFailure(combinedEvidence)
  ) {
    const terminalPlane = evidencePlanes.find((records) =>
      readCompletedGoalIds(records).length > 0
      && deriveGovernedTurnOutcomeFromToolRecords(records) === undefined,
    );
    if (terminalPlane) {
      return undefined;
    }
  }

  return evidencePlanes
    .map(deriveGovernedTurnOutcomeFromToolRecords)
    .find((outcome) => outcome !== undefined);
}

function readObservedGoalIds(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[],
): readonly string[] {
  return toolExecutions.flatMap((execution) => {
    const goal = readGoalSnapshot(execution);
    const id = readText(goal?.id);
    return id ? [id] : [];
  });
}

function readCompletedGoalIds(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[],
): readonly string[] {
  return toolExecutions.flatMap((execution) => {
    const goal = readGoalSnapshot(execution);
    const id = readText(goal?.id);
    return id && goal?.status === "completed" ? [id] : [];
  });
}

function readGoalSnapshot(execution: GovernedTurnOutcomeToolRecord): Record<string, unknown> | undefined {
  return readRecord(execution.metadata?.goal) ?? readRecord(parseJsonRecord(execution.output)?.goal);
}

export function deriveGovernedTurnOutcomeFromToolRecords(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): SessionTurnOutcome | undefined {
  if (hasUnresolvedManagedInvocationBlockingExecutionFailure(toolExecutions)) {
    return "failed";
  }
  if (hasUnrecordedManagedInvocationPhaseCompletion(toolExecutions)) {
    return "failed";
  }
  if (hasCurrentPendingPauseRequirement(toolExecutions)) {
    return "failed";
  }
  if (hasUnrecordedVisualReferenceObligation(toolExecutions)) {
    return "failed";
  }
  if (hasOpenGovernedWorkWithoutCloseout(toolExecutions)) {
    return "failed";
  }
  if (hasOpenGoalWithoutCloseout(toolExecutions)) {
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

function hasOpenGoalWithoutCloseout(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const latestGoals = new Map<string, Record<string, unknown>>();
  for (const execution of toolExecutions ?? []) {
    const goal = readRecord(execution.metadata?.goal);
    const id = goal ? readText(goal.id) : undefined;
    if (goal && id) {
      latestGoals.set(id, goal);
    }
  }
  return [...latestGoals.values()].some((goal) => goal.status === "active");
}

function hasUnrecordedManagedInvocationPhaseCompletion(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const executions = toolExecutions ?? [];
  return executions.some((execution, index) =>
    isManagedInvocationPhaseCompletionPending(execution)
    && !isManagedInvocationPhaseCompletionRecorded(execution, executions.slice(index + 1)));
}

function isManagedInvocationPhaseCompletionPending(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (execution.toolName !== "managed_agent.invoke" || !execution.success) {
    return false;
  }
  const phaseCompletion = readManagedInvocationPhaseCompletion(execution);
  return phaseCompletion?.nextTool === "work_item.update";
}

function isManagedInvocationPhaseCompletionRecorded(
  execution: GovernedTurnOutcomeToolRecord,
  laterExecutions: readonly GovernedTurnOutcomeToolRecord[],
): boolean {
  const phaseCompletion = readManagedInvocationPhaseCompletion(execution);
  if (!phaseCompletion || phaseCompletion.nextTool !== "work_item.update") {
    return false;
  }
  const workItemId = readText(phaseCompletion.workItemId);
  const requiredEvidence = readTextArray(phaseCompletion.evidenceToRecord);
  if (!workItemId || requiredEvidence.length === 0) {
    return false;
  }
  return laterExecutions.some((candidate) => {
    if (candidate.toolName !== "work_item.update" || !candidate.success) {
      return false;
    }
    const snapshot = readWorkItemSnapshot(candidate);
    if (!snapshot || snapshot.id !== workItemId) {
      return false;
    }
    const providedEvidence = readTextArray(snapshot.item.providedEvidence);
    return requiredEvidence.every((evidence) => providedEvidence.includes(evidence));
  });
}

function readManagedInvocationPhaseCompletion(
  execution: GovernedTurnOutcomeToolRecord,
): Record<string, unknown> | undefined {
  return readRecord(execution.metadata?.managedInvocationPhaseCompletion)
    ?? readRecord(parseJsonRecord(execution.output)?.phaseCompletion);
}

function hasUnresolvedManagedInvocationBlockingExecutionFailure(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const executions = toolExecutions ?? [];
  return executions.some((execution, index) =>
    isManagedInvocationBlockingExecutionFailure(execution)
    && !isManagedInvocationFailureRecovered(execution, executions.slice(index + 1)));
}

function isManagedInvocationFailureRecovered(
  execution: GovernedTurnOutcomeToolRecord,
  laterExecutions: readonly GovernedTurnOutcomeToolRecord[],
): boolean {
  const recovery = readRecord(execution.metadata?.managedInvocationRecovery);
  if (!recovery) {
    return false;
  }
  if (recovery.nextTool === "work_item.execution.fail") {
    const workItemId = readText(recovery.workItemId);
    const attemptId = readRecoveryAttemptId(recovery);
    if (!workItemId) {
      return false;
    }
    return laterExecutions.some((candidate) => {
      if (candidate.toolName !== "work_item.execution.fail") {
        return false;
      }
      const snapshot = readWorkItemSnapshot(candidate);
      if (snapshot?.id !== workItemId) {
        return false;
      }
      return !attemptId || readExecutionAttemptId(candidate) === attemptId;
    });
  }
  if (recovery.nextTool !== "work_item.update") {
    return false;
  }
  const workItemId = readText(recovery.workItemId);
  const requiredEvidence = readTextArray(recovery.evidenceToRecord);
  if (!workItemId || requiredEvidence.length === 0) {
    return false;
  }
  return laterExecutions.some((candidate) => {
    if (candidate.toolName !== "work_item.update" || !candidate.success) {
      return false;
    }
    const snapshot = readWorkItemSnapshot(candidate);
    if (!snapshot || snapshot.id !== workItemId) {
      return false;
    }
    const providedEvidence = readTextArray(snapshot.item.providedEvidence);
    return requiredEvidence.every((evidence) => providedEvidence.includes(evidence));
  });
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

function hasUnrecordedVisualReferenceObligation(
  toolExecutions: readonly GovernedTurnOutcomeToolRecord[] | undefined,
): boolean {
  const unresolvedVisualWorkItems = new Set<string>();
  const observedVisualObligations = new Set<string>();

  for (const execution of toolExecutions ?? []) {
    const snapshot = readWorkItemSnapshot(execution);
    if (snapshot) {
      if (workItemHasProvidedEvidence(snapshot.item, "visual-reference-research")) {
        unresolvedVisualWorkItems.delete(snapshot.id);
        observedVisualObligations.delete(snapshot.id);
      } else if (workItemExpectsEvidence(snapshot.item, "visual-reference-research") && workItemIsOpen(snapshot.item)) {
        unresolvedVisualWorkItems.add(snapshot.id);
      }
    }

    if (isSuccessfulVisualReferenceResearchTool(execution) || isSuccessfulPlanSubmission(execution)) {
      for (const workItemId of unresolvedVisualWorkItems) {
        observedVisualObligations.add(workItemId);
      }
    }
  }

  return observedVisualObligations.size > 0;
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

function workItemExpectsEvidence(item: Record<string, unknown>, evidence: string): boolean {
  return readTextArray(item.expectedEvidence).includes(evidence);
}

function workItemHasProvidedEvidence(item: Record<string, unknown>, evidence: string): boolean {
  return readTextArray(item.providedEvidence).includes(evidence);
}

function isSuccessfulVisualReferenceResearchTool(execution: GovernedTurnOutcomeToolRecord): boolean {
  if (!execution.success) {
    return false;
  }
  return execution.toolName === "browser_session_start"
    || execution.toolName === "browser_navigate"
    || execution.toolName === "browser_observe"
    || execution.toolName === "web_search"
    || execution.toolName === "web_fetch"
    || execution.toolName === "web_extract";
}

function isSuccessfulPlanSubmission(execution: GovernedTurnOutcomeToolRecord): boolean {
  return execution.toolName === "submit_plan" && execution.success;
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
  const startedExecution = executions[startIndex]!;
  return !executions
    .slice(startIndex + 1)
    .some((execution) => isSuccessfulTerminalWorkItemCloseoutForStart(startedExecution, execution));
}

function isSuccessfulTerminalWorkItemCloseoutForStart(
  startedExecution: GovernedTurnOutcomeToolRecord,
  execution: GovernedTurnOutcomeToolRecord,
): boolean {
  if (!isSuccessfulTerminalWorkItemCloseout(execution)) {
    return false;
  }
  const startedSnapshot = readWorkItemSnapshot(startedExecution);
  const closeoutSnapshot = readWorkItemSnapshot(execution);
  if (startedSnapshot && closeoutSnapshot && startedSnapshot.id !== closeoutSnapshot.id) {
    return false;
  }
  const startedAttemptId = readExecutionAttemptId(startedExecution);
  if (!startedAttemptId || execution.toolName === "work_item.complete") {
    return true;
  }
  return readExecutionAttemptId(execution) === startedAttemptId;
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

function readExecutionAttemptId(execution: GovernedTurnOutcomeToolRecord): string | undefined {
  const attempt = readRecord(execution.metadata?.attempt) ?? readRecord(parseJsonRecord(execution.output)?.attempt);
  return readText(attempt?.id);
}

function readRecoveryAttemptId(recovery: Record<string, unknown>): string | undefined {
  return readText(recovery.attemptId)
    ?? readText(readRecord(recovery.workItemExecutionFailInputTemplate)?.attemptId)
    ?? readText(readRecord(recovery.workItemExecutionFinishInputTemplate)?.attemptId);
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

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map(readText).filter((item): item is string => item !== undefined)
    : [];
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
    || status === "unavailable"
    || status === "route_profile_conflict"
    || status === "handoff_not_substantive"
    || status === "timed_out"
    || status === "timed-out"
    || status === "cancelled"
    || status === "skipped";
}

function isWorkGovernanceToolName(toolName: string): boolean {
  return toolName === "work_governance.assess"
    || toolName === "goal.create"
    || toolName === "goal.evidence.record"
    || toolName === "goal.complete"
    || toolName === "work_item.update"
    || toolName === "work_item.complete"
    || toolName === "work_item.execution.start"
    || toolName === "work_item.execution.finish"
    || toolName === "work_item.execution.fail";
}

function isWorkItemToolName(toolName: string): boolean {
  return toolName === "work_item.update"
    || toolName === "work_item.complete"
    || toolName === "work_item.execution.start"
    || toolName === "work_item.execution.finish"
    || toolName === "work_item.execution.fail";
}
