import type {
  GoalRun,
  GoalRunStore,
} from "./goal-run.js";
import { isTerminalGoalStatus } from "./goal-run.js";
import {
  MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE,
  MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE,
  projectManagedOrchestrationAdoptionGate,
  projectManagedOrchestrationResultHandoff,
} from "./work-item.js";
import {
  parseBoundedWorkAcceptanceDecisionRecord,
  type BoundedWorkCloseoutDecision,
} from "./bounded-work-decision.js";
import type { BoundedWorkCandidateEvidence } from "./bounded-work-evidence.js";
import type { BoundedWorkCandidateIdentity } from "./bounded-work-candidate.js";
import type { BoundedWorkAssuranceEvaluation } from "./bounded-work-assurance.js";
import type {
  ManagedAgentResultHandoff,
} from "../agents/managed-invocation/index.js";
import type {
  WorkItem,
  WorkItemExecutionAttempt,
  WorkItemExecutionFailureReason,
  WorkItemExecutionMode,
  WorkItemPauseRequirement,
  WorkItemStore,
  VerificationGateResult,
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
      | "operator_paused"
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
  readonly managedInvocationProof?: ManagedInvocationExecutionProof;
}

export interface ManagedInvocationExecutionProof {
  readonly invocationId: string;
  readonly parentSessionId: string;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly resultHandoff: ManagedAgentResultHandoff;
  /** Exact checkout or workspace in which the managed invocation executed. */
  readonly candidateCaptureRoot: string;
}

export interface CompleteGoalExecutionInput {
  readonly goalRunStore: GoalRunStore;
  readonly workItemStore: WorkItemStore;
  readonly goalRunId: string;
  readonly closeoutSummary?: string;
  readonly boundedWorkCloseoutDecision: Extract<BoundedWorkCloseoutDecision, { readonly kind: "stop_acceptance_complete" }>;
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
  readonly verificationGateResults?: readonly VerificationGateResult[];
  readonly residualRisk?: string;
  readonly summary?: string;
  readonly managedInvocationResultHandoff?: ManagedAgentResultHandoff;
  readonly managedOrchestrationAdoption?: WorkItem["managedOrchestrationAdoption"];
  readonly closeoutSummary?: string;
  readonly candidate?: BoundedWorkCandidateIdentity;
  readonly candidateEvidence?: readonly BoundedWorkCandidateEvidence[];
  readonly assuranceEvaluation?: BoundedWorkAssuranceEvaluation;
}

export interface FailGoalExecutionAttemptInput {
  readonly goalRunStore: GoalRunStore;
  readonly workItemStore: WorkItemStore;
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly attemptId: string;
  readonly terminalStatus?: "failed" | "cancelled";
  readonly failureReason: WorkItemExecutionFailureReason;
  readonly summary: string;
}

export interface GoalExecutionAttemptFinish extends GoalExecutionAttemptTransition {
  readonly missingEvidence: readonly string[];
  readonly missingVerificationGates: readonly string[];
  readonly missingResidualRisk: boolean;
  readonly failedVerificationGates: readonly string[];
  readonly missingGoalEvidence: readonly string[];
}

export function selectNextGoalExecutionStep(input: SelectNextGoalExecutionStepInput): GoalExecutionStep {
  const goal = input.goalRun;
  if (isTerminalGoalStatus(goal.status)) {
    return paused(goal, "goal_terminal", `Goal ${goal.id} is terminal.`, [], [], []);
  }
  if (goal.status === "paused") {
    return paused(goal, "operator_paused", `Goal ${goal.id} is paused by the operator.`, [], [], []);
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
  assertManagedInvocationProof(input, goal);
  const item = input.workItemStore.get(input.workItemId);
  const pendingPauseRequirements = item?.pauseRequirements?.filter((requirement) => requirement.status === "pending") ?? [];
  if (pendingPauseRequirements.length > 0) {
    throw new Error(`Work item ${input.workItemId} has unresolved pause requirements.`);
  }
  const started = input.workItemStore.startExecutionAttempt({
    id: input.workItemId,
    goalRunId: goal.id,
    boundedWorkContractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
    executionMode: input.executionMode,
    summary: input.summary,
    managedInvocationId: input.managedInvocationId,
    managedInvocationResultHandoff: input.managedInvocationProof?.resultHandoff,
    candidateCaptureRoot: input.managedInvocationProof?.candidateCaptureRoot,
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

export function completeGoalExecution(input: CompleteGoalExecutionInput): GoalRun {
  const goal = requireActiveGoal(input.goalRunStore, input.goalRunId);
  const incompleteWorkItemIds = goal.workItemIds.filter(
    (workItemId) => input.workItemStore.get(workItemId)?.status !== "completed",
  );
  if (incompleteWorkItemIds.length > 0) {
    throw new Error(`Goal ${goal.id} has incomplete work items: ${incompleteWorkItemIds.join(", ")}.`);
  }
  const missingGoalEvidence = missingRequiredGoalEvidence(goal);
  if (missingGoalEvidence.length > 0) {
    throw new Error(`Goal ${goal.id} is missing required evidence: ${missingGoalEvidence.join(", ")}.`);
  }
  assertBoundedWorkCloseoutDecision(input, goal);
  return input.goalRunStore.complete({
    id: goal.id,
    closeoutSummary: input.closeoutSummary ?? generateGoalCloseoutSummary(goal, input.workItemStore),
    boundedWorkCloseoutDecision: input.boundedWorkCloseoutDecision,
  });
}

export function finishGoalExecutionAttempt(input: FinishGoalExecutionAttemptInput): GoalExecutionAttemptFinish {
  const goal = requireNonTerminalGoal(input.goalRunStore, input.goalRunId);
  assertGoalContainsWorkItem(goal, input.workItemId);
  assertAttemptContractRevision(input.workItemStore.get(input.workItemId), input.attemptId, goal);
  const completed = input.workItemStore.finishExecutionAttempt({
    id: input.workItemId,
    attemptId: input.attemptId,
    providedEvidence: input.providedEvidence,
    skippedVerificationGates: input.skippedVerificationGates,
    verificationGateResults: input.verificationGateResults,
    residualRisk: input.residualRisk,
    summary: input.summary,
    managedInvocationResultHandoff: input.managedInvocationResultHandoff,
    managedOrchestrationAdoption: input.managedOrchestrationAdoption,
    candidate: input.candidate,
    candidateEvidence: input.candidateEvidence,
    assuranceEvaluation: input.assuranceEvaluation,
  });
  if (!completed) {
    throw new Error(`Work item ${input.workItemId} attempt ${input.attemptId} was not found.`);
  }
  const goalCloseout = goal.status === "paused"
    ? {
        goal,
        missingGoalEvidence: completed.item.status === "completed"
          ? missingRequiredGoalEvidence(goal)
          : [],
      }
    : completed.item.status === "completed"
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
    missingVerificationGates: completed.missingVerificationGates,
    missingResidualRisk: completed.missingResidualRisk,
    failedVerificationGates: completed.failedVerificationGates,
    missingGoalEvidence: goalCloseout.missingGoalEvidence,
  };
}

export function failGoalExecutionAttempt(input: FailGoalExecutionAttemptInput): GoalExecutionAttemptFinish {
  const goal = requireNonTerminalGoal(input.goalRunStore, input.goalRunId);
  assertGoalContainsWorkItem(goal, input.workItemId);
  assertAttemptContractRevision(input.workItemStore.get(input.workItemId), input.attemptId, goal);
  const failed = input.workItemStore.failExecutionAttempt({
    id: input.workItemId,
    attemptId: input.attemptId,
    terminalStatus: input.terminalStatus,
    failureReason: input.failureReason,
    summary: input.summary,
  });
  if (!failed) {
    throw new Error(`Work item ${input.workItemId} attempt ${input.attemptId} was not found.`);
  }
  const updatedGoal = goal.status === "paused"
    ? goal
    : input.goalRunStore.update({
        id: goal.id,
        currentPhase: `paused:${input.workItemId}`,
      });
  return {
    goal: updatedGoal,
    item: failed.item,
    attempt: failed.attempt,
    missingEvidence: failed.missingEvidence,
    missingVerificationGates: failed.missingVerificationGates,
    missingResidualRisk: failed.missingResidualRisk,
    failedVerificationGates: failed.failedVerificationGates,
    missingGoalEvidence: [],
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

  const missingGoalEvidence = missingRequiredGoalEvidence(goal);
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
    goal: input.goalRunStore.update({
      id: goal.id,
      currentPhase: "paused:bounded-work-acceptance",
    }),
    missingGoalEvidence: [],
  };
}

function assertBoundedWorkCloseoutDecision(input: CompleteGoalExecutionInput, goal: GoalRun): void {
  const decision = input.boundedWorkCloseoutDecision;
  const acceptanceDecision = decision?.kind === "stop_acceptance_complete"
    ? parseBoundedWorkAcceptanceDecisionRecord(decision.acceptanceDecision)
    : undefined;
  if (
    !decision
    || decision.kind !== "stop_acceptance_complete"
    || !acceptanceDecision
    || decision.contractRevisionDigest !== goal.boundedWorkContractRevision.revisionDigest
    || decision.accounting.accountingLineageId !== goal.id
    || decision.accounting.contractRevisionDigest !== goal.boundedWorkContractRevision.revisionDigest
    || acceptanceDecision.outcome !== "accepted"
    || acceptanceDecision.candidateDigest !== decision.candidateDigest
    || acceptanceDecision.contractRevisionDigest !== decision.contractRevisionDigest
    || acceptanceDecision.issuer.policyRevisionDigest !== decision.contractRevisionDigest
    || JSON.stringify(acceptanceDecision.authority) !== JSON.stringify(goal.boundedWorkContractRevision.adoptedBy)
  ) {
    throw new Error(`Goal ${goal.id} requires a current bounded-work acceptance decision.`);
  }
  const candidateExists = goal.workItemIds.some((workItemId) =>
    input.workItemStore.get(workItemId)?.executionAttempts.some((attempt) =>
      attempt.status === "completed"
      && attempt.candidate?.candidateDigest === decision.candidateDigest
      && attempt.assuranceEvaluation?.evaluationDigest === acceptanceDecision.assuranceEvaluationDigest));
  if (!candidateExists) {
    throw new Error(`Goal ${goal.id} bounded-work acceptance does not reference a completed execution candidate.`);
  }
}

export function missingRequiredGoalEvidence(goal: GoalRun): readonly string[] {
  const provided = new Set(goal.evidence.map((record) => record.requirementId));
  return goal.evidenceRequirements
    .filter((requirement) => requirement.required)
    .map((requirement) => requirement.id)
    .filter((id) => !provided.has(id));
}

function assertManagedInvocationProof(
  input: StartGoalExecutionAttemptInput,
  goal: GoalRun,
): void {
  if (input.executionMode !== "managed_delegation") {
    if (input.managedInvocationId || input.managedInvocationProof) {
      throw new Error("Direct execution cannot link managed invocation provenance.");
    }
    return;
  }
  const proof = input.managedInvocationProof;
  if (!input.managedInvocationId || !proof) {
    throw new Error("Managed delegation requires verified invocation provenance.");
  }
  if (
    proof.invocationId !== input.managedInvocationId
    || proof.parentSessionId !== goal.ownerSessionId
    || proof.goalRunId !== goal.id
    || proof.workItemId !== input.workItemId
  ) {
    throw new Error("Managed invocation provenance does not match the goal execution scope.");
  }
}

function generateGoalCloseoutSummary(goal: GoalRun, workItemStore: WorkItemStore): string {
  const items = goal.workItemIds.flatMap((id) => {
    const item = workItemStore.get(id);
    return item ? [item] : [];
  });
  const evidence = unique(items.flatMap((item) => [
    ...goalProvidedEvidence(item),
    ...(item.residualRisk ? ["residual-risk"] : []),
  ]));
  const gateResults = items.flatMap((item) => item.verificationGateResults);
  const passedGates = unique(gateResults
    .filter((result) => result.status === "passed")
    .map((result) => result.gate));
  const skippedGates = unique([
    ...items.flatMap((item) => item.skippedVerificationGates),
    ...gateResults
      .filter((result) => result.status === "skipped")
      .map((result) => result.gate),
  ]);
  const residualRisks = unique(items.flatMap((item) => item.residualRisk ? [item.residualRisk] : []));

  return [
    `Goal ${goal.id} completed from canonical evidence.`,
    `Work items: ${formatList(items.map((item) => item.id))}.`,
    `Evidence: ${formatList(evidence)}.`,
    `Passed gates: ${formatList(passedGates)}.`,
    `Skipped gates: ${formatList(skippedGates)}.`,
    `Residual risk: ${residualRisks.length > 0 ? residualRisks.join("; ") : "none recorded"}.`,
  ].join("\n");
}

function formatList(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
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
  const goal = requireNonTerminalGoal(goalRunStore, id);
  if (goal.status !== "active") {
    throw new Error(`Goal ${id} is paused and cannot start or close execution.`);
  }
  return goal;
}

function requireNonTerminalGoal(goalRunStore: GoalRunStore, id: string): GoalRun {
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

function assertAttemptContractRevision(
  item: WorkItem | undefined,
  attemptId: string,
  goal: GoalRun,
): void {
  const attempt = item?.executionAttempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) return;
  if (attempt.boundedWorkContractRevisionDigest !== goal.boundedWorkContractRevision.revisionDigest) {
    throw new Error(
      `Execution attempt ${attemptId} is bound to a stale bounded-work contract revision.`,
    );
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

function goalProvidedEvidence(item: WorkItem): readonly string[] {
  const adoptionGate = projectManagedOrchestrationAdoptionGate(item);
  const resultHandoff = projectManagedOrchestrationResultHandoff(item);
  return unique([
    ...item.providedEvidence.filter((evidence) =>
      (evidence !== MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE
        || item.managedOrchestration?.adoptionGate.required !== true)
      && (evidence !== MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE
        || item.managedOrchestration === undefined)
    ),
    ...(adoptionGate.status === "adopted"
      ? [MANAGED_ORCHESTRATION_ADOPTION_GATE_EVIDENCE]
      : []),
    ...(resultHandoff.status === "recorded"
      ? [MANAGED_ORCHESTRATION_RESULT_HANDOFF_EVIDENCE]
      : []),
  ]);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
