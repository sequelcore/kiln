import type {
  GoalRun,
  GoalRunStore,
} from "./goal-run.js";
import { isTerminalGoalStatus } from "./goal-run.js";
import type {
  WorkItem,
  WorkItemExecutionAttempt,
  WorkItemExecutionMode,
  WorkItemPauseRequirement,
  WorkItemStore,
} from "./work-item.js";

export interface GoalExecutionGovernanceAssessment {
  readonly recommendation: "direct" | "orchestrate";
  readonly reasons: readonly string[];
  readonly requiredEvidence: readonly string[];
}

export type GoalExecutionStep =
  | {
    readonly status: "ready";
    readonly goalRunId: string;
    readonly workItemId: string;
    readonly workItem: WorkItem;
    readonly executionMode: WorkItemExecutionMode;
    readonly reason: string;
    readonly requiredEvidence: readonly string[];
  }
  | {
    readonly status: "paused";
    readonly goalRunId: string;
    readonly reasonCode:
      | "goal_terminal"
      | "missing_work_items"
      | "dependencies_incomplete"
      | "pause_requirements_unresolved"
      | "work_item_in_progress"
      | "work_item_blocked"
      | "no_ready_work_item";
    readonly reason: string;
    readonly blockingWorkItemIds: readonly string[];
    readonly incompleteDependencyIds: readonly string[];
    readonly missingWorkItemIds: readonly string[];
    readonly pendingPauseRequirements: readonly WorkItemPauseRequirement[];
  }
  | {
    readonly status: "complete";
    readonly goalRunId: string;
    readonly reason: string;
  };

export interface SelectNextGoalExecutionStepInput {
  readonly goalRun: GoalRun;
  readonly workItems: readonly WorkItem[];
  readonly governanceAssessment?: GoalExecutionGovernanceAssessment;
}

export interface StartGoalExecutionAttemptInput {
  readonly goalRunStore: GoalRunStore;
  readonly workItemStore: WorkItemStore;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly executionMode: WorkItemExecutionMode;
  readonly summary?: string;
  readonly managedInvocationId?: string;
}

export interface GoalExecutionAttemptTransition {
  readonly goal: GoalRun;
  readonly item: WorkItem;
  readonly attempt: WorkItemExecutionAttempt;
}

export interface FinishGoalExecutionAttemptInput {
  readonly goalRunStore: GoalRunStore;
  readonly workItemStore: WorkItemStore;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly providedEvidence?: readonly string[];
  readonly skippedVerificationGates?: readonly string[];
  readonly residualRisk?: string;
  readonly summary?: string;
  readonly closeoutSummary?: string;
}

export interface GoalExecutionAttemptFinish extends GoalExecutionAttemptTransition {
  readonly missingEvidence: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly missingGoalEvidence: readonly string[];
}

export function selectNextGoalExecutionStep(input: SelectNextGoalExecutionStepInput): GoalExecutionStep {
  const goal = input.goalRun;
  if (isTerminalGoalStatus(goal.status)) {
    return paused(goal, "goal_terminal", `Goal ${goal.id} is terminal.`, [], [], []);
  }

  const itemsById = new Map(input.workItems.map((item) => [item.id, item]));
  const missingWorkItemIds = goal.workItemIds.filter((id) => !itemsById.has(id));
  if (missingWorkItemIds.length > 0) {
    return paused(goal, "missing_work_items", "Goal references work items that are not present.", [], [], missingWorkItemIds);
  }

  const completedIds = new Set(
    goal.workItemIds
      .map((id) => itemsById.get(id))
      .filter((item): item is WorkItem => item?.status === "completed")
      .map((item) => item.id),
  );
  const blockingWorkItemIds: string[] = [];
  const incompleteDependencyIds = new Set<string>();

  for (const id of goal.workItemIds) {
    const item = itemsById.get(id)!;
    if (item.status === "completed" || item.status === "cancelled") {
      continue;
    }
    if (item.status === "in_progress") {
      return paused(goal, "work_item_in_progress", `Work item ${item.id} is already in progress.`, [item.id], [], []);
    }
    if (item.status === "blocked") {
      return paused(goal, "work_item_blocked", `Work item ${item.id} is blocked.`, [item.id], [], []);
    }
    const incompleteDependencies = item.dependencies.filter((dependencyId) => !completedIds.has(dependencyId));
    if (incompleteDependencies.length > 0) {
      blockingWorkItemIds.push(item.id);
      for (const dependencyId of incompleteDependencies) {
        incompleteDependencyIds.add(dependencyId);
      }
      continue;
    }
    const pendingPauseRequirements = item.pauseRequirements?.filter((requirement) => requirement.status === "pending") ?? [];
    if (pendingPauseRequirements.length > 0) {
      return paused(
        goal,
        "pause_requirements_unresolved",
        `Work item ${item.id} has unresolved pause requirements.`,
        [item.id],
        [],
        [],
        pendingPauseRequirements,
      );
    }

    const executionMode = resolveExecutionMode(goal, item, input.governanceAssessment);
    return {
      status: "ready",
      goalRunId: goal.id,
      workItemId: item.id,
      workItem: item,
      executionMode,
      reason: executionMode === "managed_delegation"
        ? "work item is ready for managed delegation"
        : "work item is ready for direct execution",
      requiredEvidence: unique([
        ...item.expectedEvidence,
        ...(input.governanceAssessment?.requiredEvidence ?? []),
      ]),
    };
  }

  if (completedIds.size === goal.workItemIds.length) {
    return {
      status: "complete",
      goalRunId: goal.id,
      reason: "all goal work items are completed",
    };
  }

  return paused(
    goal,
    incompleteDependencyIds.size > 0 ? "dependencies_incomplete" : "no_ready_work_item",
    incompleteDependencyIds.size > 0
      ? "No pending work item has completed dependencies."
      : "No ready pending work item was found.",
    blockingWorkItemIds,
    [...incompleteDependencyIds],
    [],
  );
}

export function startGoalExecutionAttempt(input: StartGoalExecutionAttemptInput): GoalExecutionAttemptTransition {
  const goal = requireActiveGoal(input.goalRunStore, input.goalRunId);
  assertGoalContainsWorkItem(goal, input.workItemId);
  const item = input.workItemStore.get(input.workItemId);
  const pendingPauseRequirements = item?.pauseRequirements?.filter((requirement) => requirement.status === "pending") ?? [];
  if (pendingPauseRequirements.length > 0) {
    throw new Error(`Work item ${input.workItemId} has unresolved pause requirements.`);
  }
  const started = input.workItemStore.startExecutionAttempt({
    id: input.workItemId,
    goalRunId: goal.id,
    executionMode: input.executionMode,
    summary: input.summary,
    managedInvocationId: input.managedInvocationId,
  });
  if (!started) {
    throw new Error(`Work item ${input.workItemId} was not found.`);
  }
  const updatedGoal = input.goalRunStore.update({
    id: goal.id,
    currentPhase: `executing:${input.workItemId}`,
  });
  return {
    goal: updatedGoal,
    item: started.item,
    attempt: started.attempt,
  };
}

export function finishGoalExecutionAttempt(input: FinishGoalExecutionAttemptInput): GoalExecutionAttemptFinish {
  const goal = requireActiveGoal(input.goalRunStore, input.goalRunId);
  assertGoalContainsWorkItem(goal, input.workItemId);
  const completed = input.workItemStore.finishExecutionAttempt({
    id: input.workItemId,
    attemptId: input.attemptId,
    providedEvidence: input.providedEvidence,
    skippedVerificationGates: input.skippedVerificationGates,
    residualRisk: input.residualRisk,
    summary: input.summary,
  });
  if (!completed) {
    throw new Error(`Work item ${input.workItemId} attempt ${input.attemptId} was not found.`);
  }
  const goalCloseout = completed.item.status === "completed"
    ? transitionGoalAfterCompletedItem(input, goal)
    : {
        goal: input.goalRunStore.update({
          id: goal.id,
          currentPhase: `paused:${input.workItemId}`,
        }),
        missingGoalEvidence: [],
      };
  return {
    goal: goalCloseout.goal,
    item: completed.item,
    attempt: completed.attempt,
    missingEvidence: completed.missingEvidence,
    missingResidualRisk: completed.missingResidualRisk,
    missingGoalEvidence: goalCloseout.missingGoalEvidence,
  };
}

function transitionGoalAfterCompletedItem(
  input: FinishGoalExecutionAttemptInput,
  goal: GoalRun,
): {
  readonly goal: GoalRun;
  readonly missingGoalEvidence: readonly string[];
} {
  const allCompleted = goal.workItemIds.every((id) => {
    const item = input.workItemStore.get(id);
    return item?.status === "completed";
  });
  if (!allCompleted) {
    return {
      goal: input.goalRunStore.update({
        id: goal.id,
        currentPhase: `completed:${input.workItemId}`,
      }),
      missingGoalEvidence: [],
    };
  }

  const missingGoalEvidence = missingRequiredGoalEvidence(goal, input.workItemStore);
  if (missingGoalEvidence.length > 0) {
    return {
      goal: input.goalRunStore.update({
        id: goal.id,
        currentPhase: "paused:goal-closeout",
      }),
      missingGoalEvidence,
    };
  }
  return {
    goal: input.goalRunStore.complete({
      id: goal.id,
      closeoutSummary: input.closeoutSummary ?? `Goal ${goal.id} completed after work item ${input.workItemId}.`,
    }),
    missingGoalEvidence: [],
  };
}

function missingRequiredGoalEvidence(goal: GoalRun, workItemStore: WorkItemStore): readonly string[] {
  const provided = new Set<string>();
  for (const id of goal.workItemIds) {
    const item = workItemStore.get(id);
    if (!item) {
      continue;
    }
    for (const evidence of item.providedEvidence) {
      provided.add(evidence);
    }
    if (item.residualRisk) {
      provided.add("residual-risk");
    }
  }
  return goal.evidenceRequirements
    .filter((requirement) => requirement.required)
    .map((requirement) => requirement.id)
    .filter((id) => !provided.has(id));
}

function resolveExecutionMode(
  goal: GoalRun,
  item: WorkItem,
  assessment: GoalExecutionGovernanceAssessment | undefined,
): WorkItemExecutionMode {
  if (
    assessment?.recommendation === "orchestrate"
    || item.assignedAgentProfile
    || item.routeId
    || goal.routePolicy.managedAgentProfile
    || goal.routePolicy.preferredRouteId
  ) {
    return "managed_delegation";
  }
  return "direct";
}

function requireActiveGoal(goalRunStore: GoalRunStore, id: string): GoalRun {
  const goal = goalRunStore.get(id);
  if (!goal) {
    throw new Error(`Goal ${id} was not found.`);
  }
  if (isTerminalGoalStatus(goal.status)) {
    throw new Error(`Goal ${id} is terminal and cannot execute.`);
  }
  return goal;
}

function assertGoalContainsWorkItem(goal: GoalRun, workItemId: string): void {
  if (!goal.workItemIds.includes(workItemId)) {
    throw new Error(`Goal ${goal.id} does not include work item ${workItemId}.`);
  }
}

function paused(
  goal: GoalRun,
  reasonCode: Extract<GoalExecutionStep, { readonly status: "paused" }>["reasonCode"],
  reason: string,
  blockingWorkItemIds: readonly string[],
  incompleteDependencyIds: readonly string[],
  missingWorkItemIds: readonly string[],
  pendingPauseRequirements: readonly WorkItemPauseRequirement[] = [],
): GoalExecutionStep {
  return {
    status: "paused",
    goalRunId: goal.id,
    reasonCode,
    reason,
    blockingWorkItemIds,
    incompleteDependencyIds,
    missingWorkItemIds,
    pendingPauseRequirements,
  };
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
