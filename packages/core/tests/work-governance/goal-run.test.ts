import { describe, expect, it } from "vitest";
import { createSessionEvent } from "../../src/events/index.js";
import {
  GoalRunStore,
  reconstructGoalRunsFromSessionEvents,
} from "../../src/work-governance/index.js";

describe("GoalRunStore", () => {
  it("creates goal runs with authority, route, plan, work-item, and evidence linkage", () => {
    const notifications: string[] = [];
    const store = new GoalRunStore({
      resourceNotifications: {
        notifyResourceUpdated: (uri) => notifications.push(uri),
      },
      now: () => "2026-05-12T18:00:00.000Z",
    });

    const goal = store.create({
      id: "goal-1",
      objective: "Execute approved plan through governed work items.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1", planHash: "sha256:plan" },
      workItemIds: ["wi-1", "wi-2"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan permits audited implementation only.",
      },
      routePolicy: {
        workflowProfile: "architecture-change",
        preferredRouteId: "runtime-coder",
        managedAgentProfile: "coder",
      },
      evidenceRequirements: [
        { id: "tests", description: "Focused and package tests pass.", required: true },
      ],
    });

    expect(goal).toMatchObject({
      id: "goal-1",
      status: "active",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1", planHash: "sha256:plan" },
      workItemIds: ["wi-1", "wi-2"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
      },
      routePolicy: {
        workflowProfile: "architecture-change",
        preferredRouteId: "runtime-coder",
      },
      evidenceRequirements: [
        { id: "tests", description: "Focused and package tests pass.", required: true },
      ],
      createdAt: "2026-05-12T18:00:00.000Z",
      updatedAt: "2026-05-12T18:00:00.000Z",
      sequence: 1,
    });
    expect(notifications).toEqual([
      "kiln://session/goals",
      "kiln://session/goals/goal-1",
    ]);
  });

  it("prevents updates and terminal transitions after a goal reaches a terminal state", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const goal = store.create({
      id: "goal-terminal",
      objective: "Complete once.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only closeout.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });

    expect(store.complete({ id: goal.id, closeoutSummary: "All evidence linked." }).status).toBe("completed");
    expect(() => store.update({ id: goal.id, currentPhase: "resume" })).toThrow(
      "Goal goal-terminal is terminal and cannot transition",
    );
    expect(() => store.cancel({ id: goal.id, reason: "operator changed mind" })).toThrow(
      "Goal goal-terminal is terminal and cannot transition",
    );
  });

  it("fails fast for invalid authority, duplicate work items, and malformed evidence requirements", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const validInput = {
      id: "goal-validation",
      objective: "Validate goal input.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      workItemIds: ["wi-1"],
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [
        { id: "tests", description: "Tests pass.", required: true },
      ],
    };

    expect(() => store.create({
      ...validInput,
      authorityEnvelope: {
        ...validInput.authorityEnvelope,
        maximumAuthority: "owner" as "audited",
      },
    })).toThrow("authorityEnvelope.maximumAuthority must be read_only, audited, or destructive");
    expect(() => store.create({
      ...validInput,
      workItemIds: ["wi-1", "wi-1"],
    })).toThrow("Duplicate workItemIds id: wi-1");
    expect(() => store.create({
      ...validInput,
      evidenceRequirements: [
        { id: "tests", description: "Tests pass.", required: true },
        { id: "tests", description: "Build passes.", required: true },
      ],
    })).toThrow("Duplicate evidence requirement id: tests");
    expect(() => store.create({
      ...validInput,
      evidenceRequirements: [
        { id: "tests", description: "Tests pass.", required: undefined as unknown as boolean },
      ],
    })).toThrow("evidenceRequirements.0.required is required");
  });

  it("reconstructs latest goal state from canonical goal events without duplicating work-item state", () => {
    const created = new Date("2026-05-12T18:00:00.000Z");
    const updated = new Date("2026-05-12T18:03:00.000Z");
    const completed = new Date("2026-05-12T18:10:00.000Z");
    const baseGoal = {
      id: "goal-replay",
      objective: "Replay goal from session events.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1", planHash: "sha256:plan" },
      status: "active" as const,
      workItemIds: ["wi-1"],
      currentPhase: "implementation",
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [{ id: "tests", description: "Tests pass.", required: true }],
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      sequence: 1,
    };

    const snapshot = reconstructGoalRunsFromSessionEvents([
      createSessionEvent({
        kind: "goal.created",
        kilnSessionId: "session-1",
        sequence: 1,
        goal: baseGoal,
      }),
      createSessionEvent({
        kind: "goal.updated",
        kilnSessionId: "session-1",
        sequence: 2,
        goal: {
          ...baseGoal,
          currentPhase: "verification",
          updatedAt: updated.toISOString(),
          sequence: 2,
        },
        changedFields: ["currentPhase"],
      }),
      createSessionEvent({
        kind: "goal.completed",
        kilnSessionId: "session-1",
        sequence: 3,
        goal: {
          ...baseGoal,
          status: "completed",
          currentPhase: "verification",
          closeoutSummary: "Evidence linked.",
          updatedAt: completed.toISOString(),
          sequence: 3,
        },
        closeoutSummary: "Evidence linked.",
      }),
    ]);

    expect(snapshot).toMatchObject({
      sequence: 3,
      goals: [
        {
          id: "goal-replay",
          status: "completed",
          currentPhase: "verification",
          closeoutSummary: "Evidence linked.",
          workItemIds: ["wi-1"],
        },
      ],
    });
    expect(snapshot.goals[0]).not.toHaveProperty("workItems");
  });
});
