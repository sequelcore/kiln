import { randomUUID } from "node:crypto";
import type {
  CanonicalSessionEvent,
  GoalExecutionStep,
  GoalRun,
  GoalRunSnapshot,
  GoalRunStatus,
  WorkItemSnapshot,
} from "@kilnai/core";
import {
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
      console.log(args.includes("--json") ? JSON.stringify({ sessionId, goal }, null, 2) : formatGoalInspect(sessionId, goal));
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
      goal.planId.padEnd(14),
      goal.objective,
    ].join("  ")),
  ].join("\n");
}

function formatGoalInspect(sessionId: string, goal: GoalRun): string {
  return [
    `Goal: ${goal.id}`,
    `Session: ${sessionId}`,
    `Status: ${goal.status}`,
    `Objective: ${goal.objective}`,
    `Plan: ${goal.planId}${goal.planHash ? ` (${goal.planHash})` : ""}`,
    `Work items: ${goal.workItemIds.join(", ") || "none"}`,
    `Authority: ${goal.authorityEnvelope.maximumAuthority}`,
    `Escalation: ${goal.authorityEnvelope.escalationPolicy}`,
    `Route profile: ${goal.routePolicy.workflowProfile}`,
    goal.routePolicy.preferredRouteId ? `Preferred route: ${goal.routePolicy.preferredRouteId}` : undefined,
    goal.routePolicy.managedAgentProfile ? `Managed profile: ${goal.routePolicy.managedAgentProfile}` : undefined,
    goal.currentPhase ? `Current phase: ${goal.currentPhase}` : undefined,
    goal.terminalReason ? `Terminal reason: ${goal.terminalReason}` : undefined,
  ].filter((line): line is string => line !== undefined).join("\n");
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
      step.workItem.routeId ? `Route: ${step.workItem.routeId}` : undefined,
      step.workItem.assignedAgentProfile ? `Agent profile: ${step.workItem.assignedAgentProfile}` : undefined,
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
  console.log("\nUsage: kiln goal <list|inspect|cancel> [options]\n");
  console.log("Subcommands:");
  console.log("  list                 List goals from a canonical session transcript");
  console.log("  inspect <goal-id>    Inspect one goal from a canonical session transcript");
  console.log("  cancel <goal-id>     Append a canonical goal cancellation event");
  console.log("  resume <goal-id>     Report the next canonical execution step for a goal");
  console.log("");
  console.log("Options:");
  console.log("  --session <id>       Session id to read; defaults to latest recorded session");
  console.log("  --status <status>    Filter list by active, completed, failed, or cancelled");
  console.log("  --reason <text>      Cancellation reason");
  console.log("  --cancelled-by <id>  Operator id for cancellation");
  console.log("  --json               Print JSON");
  console.log("");
}
