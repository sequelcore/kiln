import {
  createSessionEvent,
  type CanonicalSessionEvent,
  type GoalRun,
  type GoalRunStore,
} from "@kilnai/core";
import type { GuiGoalControlAction } from "@kilnai/gateway-contracts";
import type { TranscriptStore } from "../wrapper/session-store.js";

export interface GoalControlRequest {
  readonly goalRunId: string;
  readonly action: GuiGoalControlAction;
  readonly objective?: string;
  readonly reason?: string;
  readonly requestedBy: string;
  readonly sourceSurface: "cli" | "gui";
}

export class GoalControlService {
  constructor(
    private readonly goalRunStore: GoalRunStore,
    private readonly transcriptStore: TranscriptStore,
    private readonly eventId: () => string = () => crypto.randomUUID(),
  ) {}

  async control(request: GoalControlRequest): Promise<CanonicalSessionEvent> {
    const existing = this.goalRunStore.get(request.goalRunId);
    if (!existing) {
      throw new Error(`Goal ${request.goalRunId} was not found in the live session.`);
    }

    const goal = this.transition(existing, request);
    const kind = goal.status === "cancelled" ? "goal.cancelled" as const : "goal.updated" as const;
    const timestamp = new Date(goal.updatedAt);
    const eventId = this.eventId();
    const source = { actor: "user" as const, surface: request.sourceSurface, component: "goal-control" };
    const changedFields = changedFieldsForAction(request.action);
    const appended = await this.transcriptStore.appendNext(goal.ownerSessionId, {
      eventId,
      kilnSessionId: goal.ownerSessionId,
      timestamp: timestamp.toISOString(),
      kind,
      source,
      payload: kind === "goal.cancelled"
        ? {
            goal,
            reason: request.reason?.trim() || "Operator cancelled the goal.",
            cancelledBy: request.requestedBy,
          }
        : { goal, changedFields },
    });
    if (!appended) {
      this.goalRunStore.restore(existing);
      throw new Error(`Goal ${goal.id} changed in memory but its canonical event could not be persisted.`);
    }

    return kind === "goal.cancelled"
      ? createSessionEvent<"goal.cancelled">({
          eventId,
          kilnSessionId: goal.ownerSessionId,
          sequence: appended.sequence,
          timestamp,
          kind,
          source,
          goal,
          reason: request.reason?.trim() || "Operator cancelled the goal.",
          cancelledBy: request.requestedBy,
        })
      : createSessionEvent<"goal.updated">({
          eventId,
          kilnSessionId: goal.ownerSessionId,
          sequence: appended.sequence,
          timestamp,
          kind,
          source,
          goal,
          changedFields,
        });
  }

  private transition(existing: GoalRun, request: GoalControlRequest): GoalRun {
    switch (request.action) {
      case "pause":
        return this.goalRunStore.pause({ id: existing.id });
      case "resume":
        return this.goalRunStore.resume({ id: existing.id });
      case "update_objective":
        requireObjective(request.objective);
        throw new Error(
          "Goal objective is immutable. Create an explicit bounded-work contract supersession with an approved operator or plan decision instead.",
        );
      case "cancel":
        return this.goalRunStore.cancel({
          id: existing.id,
          reason: request.reason?.trim() || "Operator cancelled the goal.",
          cancelledBy: request.requestedBy,
        });
    }
  }
}

function changedFieldsForAction(action: GuiGoalControlAction): readonly string[] {
  switch (action) {
    case "pause":
    case "resume":
      return ["status", "currentPhase", "activeDurationMs", "activeSince"];
    case "update_objective":
      return [];
    case "cancel":
      return ["status", "currentPhase", "activeDurationMs", "activeSince", "terminalReason"];
  }
}

function requireObjective(value: string | undefined): string {
  const objective = value?.trim();
  if (!objective) {
    throw new Error("Goal objective is required.");
  }
  return objective;
}
