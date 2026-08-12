import { describe, expect, it } from "vitest";
import { GoalRunStore, WorkItemStore } from "../../src/work-governance/index.js";
import { testBoundedWorkCloseoutDecision, testBoundedWorkRevision } from "./bounded-work-fixtures.js";

describe("work-governance store restore", () => {
  it("restores work items with canonical sequence and resource notifications", () => {
    const source = new WorkItemStore({ now: () => "2026-05-12T19:00:00.000Z" });
    const item = source.upsert({
      id: "work-restored",
      summary: "Resume governed work after process restart.",
      workflowProfile: "runtime-repair",
      risk: "medium",
      triggers: ["session-resume"],
      expectedEvidence: ["tests"],
      providedEvidence: ["scout"],
      verificationGates: ["bun test"],
    });
    const notifications: string[] = [];
    const store = new WorkItemStore({
      resourceNotifications: {
        notifyResourceUpdated: (uri) => notifications.push(uri),
      },
      now: () => "2026-05-12T19:05:00.000Z",
    });

    expect(store.restore(item)).toEqual(item);
    expect(store.snapshot()).toEqual({
      items: [item],
      updatedAt: "2026-05-12T19:00:00.000Z",
      sequence: item.sequence,
    });
    expect(notifications).toEqual([
      "kiln://session/work-items",
      "kiln://session/work-items/work-restored",
    ]);

    const next = store.upsert({
      id: "work-next",
      summary: "Continue after restored item.",
      workflowProfile: "runtime-repair",
      risk: "low",
      triggers: ["session-resume"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    expect(next.sequence).toBe(item.sequence + 1);
  });

  it("restores goal runs with canonical sequence and resource notifications", () => {
    const source = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const activeGoal = source.create({
      id: "goal-restored",
      objective: "Resume the governed repair goal.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-restored", ["work-restored"], "Resume the governed repair goal."),
      workItemIds: ["work-restored"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan permits audited runtime repair.",
      },
      routePolicy: { workflowProfile: "runtime-repair" },
      evidenceRequirements: [
        { id: "tests", description: "Focused tests pass.", required: true },
      ],
    });
    const goal = source.complete({
      id: activeGoal.id,
      closeoutSummary: "Restored goal completed before the follow-up goal starts.",
      boundedWorkCloseoutDecision: testBoundedWorkCloseoutDecision(activeGoal.id, activeGoal.boundedWorkContractRevision),
    });
    const notifications: string[] = [];
    const store = new GoalRunStore({
      resourceNotifications: {
        notifyResourceUpdated: (uri) => notifications.push(uri),
      },
      now: () => "2026-05-12T18:05:00.000Z",
    });

    expect(store.restore(goal)).toEqual(goal);
    expect(store.snapshot()).toEqual({
      goals: [goal],
      updatedAt: "2026-05-12T18:00:00.000Z",
      sequence: goal.sequence,
    });
    expect(notifications).toEqual([
      "kiln://session/goals",
      "kiln://session/goals/goal-restored",
    ]);

    const next = store.create({
      id: "goal-next",
      objective: "Continue with a new goal.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-2" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-next", ["test-work-item"], "Continue with a new goal."),
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only follow-up.",
      },
      routePolicy: { workflowProfile: "runtime-repair" },
      evidenceRequirements: [],
    });
    expect(next.sequence).toBe(goal.sequence + 1);
  });
});
