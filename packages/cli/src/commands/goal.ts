import { randomUUID } from "node:crypto";
import type {
  CanonicalSessionEvent,
  GoalExecutionStep,
  GoalRun,
  GoalRunSnapshot,
  GoalRunStatus,
  PlanSubmissionInput,
  SessionPlan,
  WorkItem,
  WorkItemSnapshot,
  WorkflowProfile,
} from "@kilnai/core";
import {
  PlanStateStore,
  reconstructGoalRunsFromSessionEvents,
  reconstructWorkItemsFromSessionEvents,
  selectNextGoalExecutionStep,
} from "@kilnai/core";
import type { KilnAppConfig } from "../config.js";
import { SessionStore, TranscriptStore } from "../wrapper/session-store.js";

const GOAL_STATUSES: readonly GoalRunStatus[] = ["active", "completed", "failed", "cancelled"];

export interface GoalCommandOptions {
  readonly projectPath?: string;
  readonly now?: () => Date;
  readonly eventId?: () => string;
}

export async function goalCommand(
  _appConfig: KilnAppConfig,
  subcommand: string | undefined,
  args: readonly string[],
  options: GoalCommandOptions = {},
): Promise<void> {
  const root = options.projectPath ?? process.cwd();
  const transcriptStore = new TranscriptStore(root);

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printGoalHelp();
    return;
  }

  const sessionId = await resolveGoalCommandSessionId(root, args);
  if (!sessionId) {
    throw new Error("No session selected. Pass --session <id> or run a Kiln session first.");
  }

  switch (subcommand) {
    case "list": {
      const status = readGoalStatus(readFlag(args, "--status"));
      const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, sessionId);
      const goals = status ? snapshot.goals.filter((goal) => goal.status === status) : snapshot.goals;
      console.log(args.includes("--json") ? JSON.stringify({ sessionId, goals }, null, 2) : formatGoalList(sessionId, goals));
      return;
    }
    case "inspect": {
      const goalId = requirePositional(args, "goal id");
      const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, sessionId);
      const goal = snapshot.goals.find((candidate) => candidate.id === goalId);
      if (!goal) {
        throw new Error(`Goal not found: ${goalId}`);
      }
      const workItemSnapshot = await loadWorkItemSnapshotFromTranscript(transcriptStore, sessionId);
      console.log(args.includes("--json") ? JSON.stringify({ sessionId, goal }, null, 2) : formatGoalInspect(sessionId, goal, workItemSnapshot.items));
      return;
    }
    case "cancel": {
      const goalId = requirePositional(args, "goal id");
      const reason = readFlag(args, "--reason");
      if (!reason) {
        throw new Error("Goal cancellation requires --reason <text>.");
      }
      const cancelledBy = readFlag(args, "--cancelled-by");
      const cancelled = await appendGoalCancellation(transcriptStore, sessionId, goalId, {
        reason,
        cancelledBy,
        now: options.now ?? (() => new Date()),
        eventId: options.eventId ?? randomUUID,
      });
      console.log(args.includes("--json") ? JSON.stringify({ sessionId, goal: cancelled }, null, 2) : `Cancelled ${cancelled.id}: ${cancelled.terminalReason}`);
      return;
    }
    case "resume": {
      const goalId = requirePositional(args, "goal id");
      const goalSnapshot = await loadGoalSnapshotFromTranscript(transcriptStore, sessionId);
      const goal = goalSnapshot.goals.find((candidate) => candidate.id === goalId);
      if (!goal) {
        throw new Error(`Goal not found: ${goalId}`);
      }
      const workItemSnapshot = await loadWorkItemSnapshotFromTranscript(transcriptStore, sessionId);
      const step = selectNextGoalExecutionStep({
        goalRun: goal,
        workItems: workItemSnapshot.items,
      });
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, goalId, step }, null, 2)
        : formatGoalResume(goal, step));
      return;
    }
    case "approve-plan": {
      const planId = requirePositional(args, "plan id");
      const approved = await appendPlanApproval(transcriptStore, sessionId, planId, {
        approvedBy: readFlag(args, "--approved-by") ?? process.env.USERNAME ?? process.env.USER ?? "operator",
        residualRiskAcknowledged: args.includes("--ack-residual-risk"),
        residualRiskAcknowledgement: readFlag(args, "--residual-risk-acknowledgement"),
        now: options.now ?? (() => new Date()),
        eventId: options.eventId ?? randomUUID,
      });
      console.log(args.includes("--json")
        ? JSON.stringify({ sessionId, approval: approved }, null, 2)
        : `Approved ${approved.planId}: ${approved.approvalId}`);
      return;
    }
    default:
      throw new Error(`Unknown goal subcommand: ${subcommand}`);
  }
}

export async function loadGoalSnapshotFromTranscript(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<GoalRunSnapshot> {
  const transcript = await transcriptStore.readTranscript(sessionId);
  return reconstructGoalRunsFromSessionEvents(
    transcript.flatMap((event) => {
      if (!isGoalEventKind(event.kind)) {
        return [];
      }
      return [{
        eventId: event.eventId,
        kilnSessionId: event.kilnSessionId,
        sequence: event.sequence,
        timestamp: new Date(event.timestamp),
        kind: event.kind,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
        source: event.source ?? { actor: "runtime", surface: "cli", component: "goal-command" },
        ...event.payload,
      } as CanonicalSessionEvent];
    }),
  );
}

export async function loadWorkItemSnapshotFromTranscript(
  transcriptStore: TranscriptStore,
  sessionId: string,
): Promise<WorkItemSnapshot> {
  const transcript = await transcriptStore.readTranscript(sessionId);
  return reconstructWorkItemsFromSessionEvents(
    transcript.flatMap((event) => {
      if (!isWorkItemEventKind(event.kind)) {
        return [];
      }
      return [{
        eventId: event.eventId,
        kilnSessionId: event.kilnSessionId,
        sequence: event.sequence,
        timestamp: new Date(event.timestamp),
        kind: event.kind,
        ...(event.turnId ? { turnId: event.turnId } : {}),
        ...(event.parentEventId ? { parentEventId: event.parentEventId } : {}),
        source: event.source ?? { actor: "runtime", surface: "cli", component: "goal-command" },
        ...event.payload,
      } as CanonicalSessionEvent];
    }),
  );
}

async function appendGoalCancellation(
  transcriptStore: TranscriptStore,
  sessionId: string,
  goalId: string,
  options: {
    readonly reason: string;
    readonly cancelledBy?: string;
    readonly now: () => Date;
    readonly eventId: () => string;
  },
): Promise<GoalRun> {
  const transcript = await transcriptStore.readTranscript(sessionId);
  const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, sessionId);
  const goal = snapshot.goals.find((candidate) => candidate.id === goalId);
  if (!goal) {
    throw new Error(`Goal not found: ${goalId}`);
  }
  if (goal.status !== "active") {
    throw new Error(`Goal ${goalId} is ${goal.status} and cannot be cancelled.`);
  }
  const timestamp = options.now().toISOString();
  const sequence = Math.max(0, ...transcript.map((event) => event.sequence)) + 1;
  const terminalReason = options.cancelledBy
    ? `${options.reason} (${options.cancelledBy})`
    : options.reason;
  const cancelled: GoalRun = {
    ...goal,
    status: "cancelled",
    terminalReason,
    updatedAt: timestamp,
    sequence,
  };
  await transcriptStore.append(sessionId, {
    eventId: options.eventId(),
    kilnSessionId: sessionId,
    sequence,
    timestamp,
    kind: "goal.cancelled",
    source: { actor: "user", surface: "cli", component: "goal-command" },
    payload: {
      goal: cancelled,
      reason: options.reason,
      ...(options.cancelledBy ? { cancelledBy: options.cancelledBy } : {}),
    },
  });
  return cancelled;
}

async function appendPlanApproval(
  transcriptStore: TranscriptStore,
  sessionId: string,
  planId: string,
  options: {
    readonly approvedBy: string;
    readonly residualRiskAcknowledged: boolean;
    readonly residualRiskAcknowledgement?: string;
    readonly now: () => Date;
    readonly eventId: () => string;
  },
): Promise<{
  readonly planId: string;
  readonly approvalId: string;
  readonly planHash: string;
}> {
  const transcript = await transcriptStore.readTranscript(sessionId);
  const planEvent = transcript
    .filter((event) => event.kind === "plan_submitted")
    .filter((event) => readString(event.payload.planId) === planId)
    .at(-1);
  if (!planEvent) {
    throw new Error(`Plan not found: ${planId}`);
  }

  const planStateStore = new PlanStateStore({
    now: () => options.now().getTime(),
  });
  const plan = planStateStore.submitPlan(planSubmissionInputFromPayload(planEvent.payload));
  const expectedHash = readString(planEvent.payload.planHash);
  if (expectedHash && expectedHash !== plan.contentHash) {
    throw new Error(`Recovered plan ${plan.id} hash does not match the canonical plan_submitted event.`);
  }
  if (plan.status !== "ready_for_approval") {
    throw new Error(`Plan ${plan.id} is not ready for approval.`);
  }

  const analysis = transcript
    .filter((event) => event.kind === "plan_analysis_reported")
    .filter((event) => readString(event.payload.planId) === plan.id)
    .at(-1);
  if (!analysis) {
    throw new Error(`Plan ${plan.id} cannot be approved until a plan/spec analysis report exists.`);
  }
  const analysisStatus = readString(analysis.payload.status);
  const blockingFindingIds = readStringArray(analysis.payload.blockingFindingIds);
  if (analysisStatus === "blocked" || blockingFindingIds.length > 0) {
    throw new Error(`Plan ${plan.id} cannot be approved while blocking analysis findings remain open: ${blockingFindingIds.join(", ")}.`);
  }

  if (requiresResidualRiskAcknowledgement(plan) && !options.residualRiskAcknowledged) {
    throw new Error(`Plan ${plan.id} has residual risks that must be acknowledged before execution approval.`);
  }

  const approval = planStateStore.approvePlan(plan.id);
  if (!approval.success) {
    throw new Error(approval.message);
  }
  const readiness = planStateStore.executionReadiness(approval.planId);
  if (!readiness.success || !readiness.ready) {
    throw new Error(readiness.message);
  }

  const timestamp = options.now().toISOString();
  const sequence = Math.max(0, ...transcript.map((event) => event.sequence)) + 1;
  await transcriptStore.append(sessionId, {
    eventId: options.eventId(),
    kilnSessionId: sessionId,
    sequence,
    timestamp,
    kind: "plan_approved",
    source: { actor: "user", surface: "cli", component: "goal-command" },
    payload: {
      planId: approval.planId,
      approvalId: approval.approval.approvalId,
      planHash: approval.approval.planHash,
      approvedBy: options.approvedBy.trim() || "operator",
      approvedAt: timestamp,
      residualRiskAcknowledged: options.residualRiskAcknowledged,
      ...(options.residualRiskAcknowledgement?.trim()
        ? { residualRiskAcknowledgement: options.residualRiskAcknowledgement.trim() }
        : {}),
      fromMode: "plan",
      toMode: "execute",
    },
  });

  return {
    planId: approval.planId,
    approvalId: approval.approval.approvalId,
    planHash: approval.approval.planHash,
  };
}

async function resolveGoalCommandSessionId(root: string, args: readonly string[]): Promise<string | undefined> {
  const explicit = readFlag(args, "--session");
  if (explicit) {
    return explicit;
  }
  const latest = await new SessionStore(root).last();
  return latest?.sessionId;
}

function formatGoalList(sessionId: string, goals: readonly GoalRun[]): string {
  if (goals.length === 0) {
    return `No goals found for session ${sessionId}.`;
  }
  return [
    `Goals for session ${sessionId}:`,
    ...goals.map((goal) => [
      goal.id.padEnd(18),
      goal.status.padEnd(10),
      formatGoalSource(goal).padEnd(24),
      goal.objective,
    ].join("  ")),
  ].join("\n");
}

function formatGoalInspect(sessionId: string, goal: GoalRun, workItems: readonly WorkItem[] = []): string {
  const linkedWorkItems = goal.workItemIds.flatMap((id) => {
    const item = workItems.find((candidate) => candidate.id === id);
    return item ? [item] : [];
  });
  return [
    `Goal: ${goal.id}`,
    `Session: ${sessionId}`,
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    `Source: ${formatGoalSource(goal)}`,
    `Work items: ${goal.workItemIds.join(", ") || "none"}`,
    `Authority: ${goal.authorityEnvelope.maximumAuthority}`,
    `Escalation: ${goal.authorityEnvelope.escalationPolicy}`,
    `Route profile: ${goal.routePolicy.workflowProfile}`,
    goal.routePolicy.preferredRouteId ? `Preferred route: ${goal.routePolicy.preferredRouteId}` : undefined,
    goal.routePolicy.managedAgentProfile ? `Managed profile: ${goal.routePolicy.managedAgentProfile}` : undefined,
    goal.currentPhase ? `Current phase: ${goal.currentPhase}` : undefined,
    goal.terminalReason ? `Terminal reason: ${goal.terminalReason}` : undefined,
    ...linkedWorkItems.flatMap(formatInspectableWorkItem),
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatGoalSource(goal: GoalRun): string {
  return goal.source.kind === "approved_plan"
    ? `plan ${goal.source.planId}${goal.source.planHash ? ` (${goal.source.planHash})` : ""}`
    : `operator turn ${goal.source.turnId}`;
}

function formatGoalResume(goal: GoalRun, step: GoalExecutionStep): string {
  if (step.status === "ready") {
    return [
      `Goal ${goal.id} is ready to resume.`,
      `Next work item: ${step.workItemId}`,
      `Summary: ${step.workItem.summary}`,
      `Execution mode: ${step.executionMode}`,
      `Reason: ${step.reason}`,
      `Required evidence: ${step.requiredEvidence.join(", ") || "none"}`,
      `Resource: ${workItemResourceUri(step.workItem.id)}`,
      step.workItem.routeId ? `Route: ${step.workItem.routeId}` : undefined,
      step.workItem.assignedAgentProfile ? `Agent profile: ${step.workItem.assignedAgentProfile}` : undefined,
      step.workItem.authorityProfile ? `Authority profile: ${step.workItem.authorityProfile}` : undefined,
      `Missing evidence: ${missingWorkItemEvidence(step.workItem).join(", ") || "none"}`,
    ].filter((line): line is string => line !== undefined).join("\n");
  }
  if (step.status === "complete") {
    return [
      `Goal ${goal.id} is complete.`,
      `Reason: ${step.reason}`,
    ].join("\n");
  }
  return [
    `Goal ${goal.id} is paused.`,
    `Reason code: ${step.reasonCode}`,
    `Reason: ${step.reason}`,
    step.blockingWorkItemIds.length > 0 ? `Blocking work items: ${step.blockingWorkItemIds.join(", ")}` : undefined,
    step.incompleteDependencyIds.length > 0 ? `Incomplete dependencies: ${step.incompleteDependencyIds.join(", ")}` : undefined,
    step.missingWorkItemIds.length > 0 ? `Missing work items: ${step.missingWorkItemIds.join(", ")}` : undefined,
    step.pendingPauseRequirements.length > 0
      ? `Pending pause requirements: ${step.pendingPauseRequirements.map((requirement) => requirement.id).join(", ")}`
      : undefined,
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatInspectableWorkItem(item: WorkItem): readonly string[] {
  return [
    `Work item ${item.id}: ${item.status} - ${item.summary}`,
    `Work item resource: ${workItemResourceUri(item.id)}`,
    item.authorityProfile ? `Work item authority: ${item.authorityProfile}` : undefined,
    item.routeId ? `Work item route: ${item.routeId}` : undefined,
    item.assignedAgentProfile ? `Work item agent profile: ${item.assignedAgentProfile}` : undefined,
    `Work item evidence: ${item.providedEvidence.length}/${item.expectedEvidence.length}`,
    `Work item missing evidence: ${missingWorkItemEvidence(item).join(", ") || "none"}`,
  ].filter((line): line is string => line !== undefined);
}

function workItemResourceUri(id: string): string {
  return `kiln://session/work-items/${encodeURIComponent(id)}`;
}

function missingWorkItemEvidence(item: WorkItem): readonly string[] {
  return item.expectedEvidence.filter((evidence) => {
    if (item.providedEvidence.includes(evidence)) {
      return false;
    }
    if (evidence === "residual-risk" && item.residualRisk?.trim()) {
      return false;
    }
    return true;
  });
}

function planSubmissionInputFromPayload(payload: Record<string, unknown>): PlanSubmissionInput {
  return {
    planId: readString(payload.planId),
    objective: requireString(payload.objective, "objective"),
    nonGoals: readStringArray(payload.nonGoals),
    operatorDecisionsRequired: readStringArray(payload.operatorDecisionsRequired),
    assumptions: readStringArray(payload.assumptions),
    affectedSurfaces: readStringArray(payload.affectedSurfaces),
    riskClassification: readRiskClassification(payload.riskClassification),
    workGovernanceRecommendation: {
      posture: readWorkGovernancePosture(payload.workGovernancePosture),
      rationale: requireString(payload.workGovernanceRationale, "workGovernanceRationale"),
      workflowProfile: readWorkflowProfile(payload.workflowProfile),
    },
    proposedWorkItems: readProposedWorkItems(payload.proposedWorkItems),
    expectedEvidence: readStringArray(payload.expectedEvidence),
    verificationGates: readStringArray(payload.verificationGates),
    managedAgentDelegationCandidates: readStringArray(payload.managedAgentDelegationCandidates),
    approvalBoundaries: readStringArray(payload.approvalBoundaries),
    rollbackNotes: requireString(payload.rollbackNotes, "rollbackNotes"),
    residualRisks: readStringArray(payload.residualRisks),
    sourceSpecificationId: requireString(payload.sourceSpecificationId, "sourceSpecificationId"),
    clarificationRecordIds: readStringArray(payload.clarificationRecordIds),
    constitutionSnapshot: {
      instructionProfileHash: requireString(payload.constitutionSnapshotHash, "constitutionSnapshotHash"),
      instructionProfileIds: readStringArray(payload.constitutionSnapshotIds),
    },
  };
}

function readProposedWorkItems(value: unknown): PlanSubmissionInput["proposedWorkItems"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return [];
    }
    const id = readString(entry.id);
    const summary = readString(entry.summary);
    if (!id || !summary) {
      return [];
    }
    return [{
      id,
      summary,
      workflowProfile: readWorkflowProfile(entry.workflowProfile),
      risk: readRiskClassification(entry.risk),
      expectedEvidence: readStringArray(entry.expectedEvidence),
      verificationGates: readStringArray(entry.verificationGates),
      dependencies: readStringArray(entry.dependencies),
    }];
  });
}

function requiresResidualRiskAcknowledgement(plan: SessionPlan): boolean {
  if (plan.residualRisks.length === 0) {
    return false;
  }
  return plan.riskClassification === "high"
    || plan.riskClassification === "critical"
    || plan.workGovernanceRecommendation.workflowProfile === "architecture-change"
    || plan.workGovernanceRecommendation.workflowProfile === "managed-agent-change"
    || plan.workGovernanceRecommendation.workflowProfile === "verification-heavy"
    || plan.workGovernanceRecommendation.workflowProfile === "formal-proof-candidate";
}

function isGoalEventKind(kind: string): kind is "goal.created" | "goal.updated" | "goal.completed" | "goal.failed" | "goal.cancelled" {
  return kind === "goal.created"
    || kind === "goal.updated"
    || kind === "goal.completed"
    || kind === "goal.failed"
    || kind === "goal.cancelled";
}

function isWorkItemEventKind(kind: string): kind is "work_item_updated" | "work_item_execution_started" | "work_item_execution_finished" {
  return kind === "work_item_updated"
    || kind === "work_item_execution_started"
    || kind === "work_item_execution_finished";
}

function readGoalStatus(value: string | undefined): GoalRunStatus | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (GOAL_STATUSES.includes(value as GoalRunStatus)) {
    return value as GoalRunStatus;
  }
  throw new Error(`Unknown goal status '${value}'. Use active, completed, failed, or cancelled.`);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function requireString(value: unknown, field: string): string {
  const normalized = readString(value);
  if (!normalized) {
    throw new Error(`Plan ${field} is required.`);
  }
  return normalized;
}

function readStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? [...new Set(value.flatMap((entry) => readString(entry) ? [readString(entry)!] : []))]
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readWorkflowProfile(value: unknown): WorkflowProfile {
  if (
    value === "small-fix"
    || value === "bug-diagnosis"
    || value === "architecture-change"
    || value === "ui-change"
    || value === "managed-agent-change"
    || value === "config-change"
    || value === "verification-heavy"
    || value === "formal-proof-candidate"
  ) {
    return value;
  }
  throw new Error(`Unknown workflow profile '${String(value)}'.`);
}

function readRiskClassification(value: unknown): PlanSubmissionInput["riskClassification"] {
  if (value === "low" || value === "medium" || value === "high" || value === "critical") {
    return value;
  }
  throw new Error(`Unknown risk classification '${String(value)}'.`);
}

function readWorkGovernancePosture(value: unknown): PlanSubmissionInput["workGovernanceRecommendation"]["posture"] {
  if (value === "direct" || value === "orchestrate" || value === "delegate") {
    return value;
  }
  throw new Error(`Unknown work governance posture '${String(value)}'.`);
}

function readFlag(args: readonly string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    return value;
  }
  const prefix = `${flag}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function requirePositional(args: readonly string[], label: string): string {
  const positional = args.find((arg, index) => !arg.startsWith("--") && !args[index - 1]?.startsWith("--"));
  if (!positional) {
    throw new Error(`Goal ${label} is required.`);
  }
  return positional;
}

function printGoalHelp(): void {
  console.log("\nUsage: kiln goal <list|inspect|approve-plan|cancel|resume> [options]\n");
  console.log("Subcommands:");
  console.log("  list                 List goals from a canonical session transcript");
  console.log("  inspect <goal-id>    Inspect one goal from a canonical session transcript");
  console.log("  approve-plan <id>    Append a canonical plan approval event after analysis is ready");
  console.log("  cancel <goal-id>     Append a canonical goal cancellation event");
  console.log("  resume <goal-id>     Report the next canonical execution step for a goal");
  console.log("");
  console.log("Options:");
  console.log("  --session <id>       Session id to read; defaults to latest recorded session");
  console.log("  --status <status>    Filter list by active, completed, failed, or cancelled");
  console.log("  --reason <text>      Cancellation reason");
  console.log("  --cancelled-by <id>  Operator id for cancellation");
  console.log("  --approved-by <id>   Operator id for plan approval");
  console.log("  --ack-residual-risk  Acknowledge high-control residual risks");
  console.log("  --residual-risk-acknowledgement <text>");
  console.log("  --json               Print JSON");
  console.log("");
}
