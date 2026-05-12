import { describe, expect, it } from "vitest";
import {
  finishGoalExecutionAttempt,
  GoalRunStore,
  reconstructWorkItemsFromSessionEvents,
  selectNextGoalExecutionStep,
  startGoalExecutionAttempt,
  WorkItemStore,
} from "../../src/work-governance/index.js";
import { createSessionEvent } from "../../src/events/index.js";

describe("goal execution loop", () => {
  it("selects the first ready pending work item and derives managed delegation from governance assessment", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const completed = workItemStore.upsert({
      id: "work-scout",
      summary: "Map surfaces.",
      status: "completed",
      workflowProfile: "architecture-change",
      triggers: ["architecture"],
      expectedEvidence: ["surface-map"],
      providedEvidence: ["surface-map"],
      verificationGates: ["review scout"],
    });
    const ready = workItemStore.upsert({
      id: "work-implementation",
      summary: "Implement controller.",
      workflowProfile: "architecture-change",
      triggers: ["runtime"],
      expectedEvidence: ["tests", "typecheck"],
      verificationGates: ["bun run --filter @kilnai/core test"],
      dependencies: [completed.id],
      assignedAgentProfile: "coder",
      routeId: "codex-worker",
    });
    const goal = new GoalRunStore({ now: fixedNow }).create({
      id: "goal-execution",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      planHash: "sha256:plan",
      workItemIds: [completed.id, ready.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan permits audited execution.",
      },
      routePolicy: {
        workflowProfile: "architecture-change",
        preferredRouteId: "codex-worker",
        managedAgentProfile: "coder",
      },
      evidenceRequirements: [],
    });

    const step = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: workItemStore.snapshot().items,
      governanceAssessment: {
        recommendation: "orchestrate",
        reasons: ["delegation trigger matched: runtime"],
        requiredEvidence: ["managed-agent-review"],
      },
    });

    expect(step).toMatchObject({
      status: "ready",
      goalRunId: "goal-execution",
      workItemId: ready.id,
      executionMode: "managed_delegation",
      reason: "work item is ready for managed delegation",
      requiredEvidence: ["tests", "typecheck", "managed-agent-review"],
    });
  });

  it("pauses instead of advancing when no pending work item has completed dependencies", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const dependency = workItemStore.upsert({
      id: "work-scout",
      summary: "Map surfaces.",
      workflowProfile: "architecture-change",
      triggers: ["architecture"],
      expectedEvidence: ["surface-map"],
      verificationGates: ["review scout"],
    });
    const blocked = workItemStore.upsert({
      id: "work-implementation",
      summary: "Implement controller.",
      workflowProfile: "architecture-change",
      triggers: ["runtime"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      dependencies: [dependency.id],
    });
    const goal = new GoalRunStore({ now: fixedNow }).create({
      id: "goal-paused",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [blocked.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [],
    });

    const step = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: workItemStore.snapshot().items,
    });

    expect(step).toMatchObject({
      status: "paused",
      reasonCode: "dependencies_incomplete",
      blockingWorkItemIds: [blocked.id],
      incompleteDependencyIds: [dependency.id],
    });
  });

  it("pauses on unresolved work item requirements and resumes after they are resolved", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-needs-input",
      summary: "Execute work after operator confirmation.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      pauseRequirements: [
        {
          id: "operator-confirmation",
          kind: "operator_input",
          summary: "Confirm whether Slice 9 should continue.",
          status: "pending",
        },
      ],
    });
    const goal = new GoalRunStore({ now: fixedNow }).create({
      id: "goal-needs-input",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });

    const paused = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: workItemStore.snapshot().items,
    });

    expect(paused).toMatchObject({
      status: "paused",
      reasonCode: "pause_requirements_unresolved",
      blockingWorkItemIds: [item.id],
      pendingPauseRequirements: [
        {
          id: "operator-confirmation",
          kind: "operator_input",
          status: "pending",
        },
      ],
    });

    workItemStore.upsert({
      ...item,
      pauseRequirements: [
        {
          id: "operator-confirmation",
          kind: "operator_input",
          summary: "Confirm whether Slice 9 should continue.",
          status: "resolved",
          resolvedBy: "operator",
          resolvedAt: "2026-05-12T20:00:00.000Z",
          resolution: "Continue Slice 9.",
        },
      ],
    });

    const ready = selectNextGoalExecutionStep({
      goalRun: goal,
      workItems: workItemStore.snapshot().items,
    });

    expect(ready).toMatchObject({
      status: "ready",
      workItemId: item.id,
      executionMode: "direct",
    });
  });

  it("records execution attempts and blocks completion until required evidence and residual risk are present", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-verify",
      summary: "Verify execution.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck", "residual-risk"],
      verificationGates: ["bun run typecheck"],
    });
    const goal = goalRunStore.create({
      id: "goal-attempts",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });

    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "direct",
      summary: "Run focused verification.",
    });
    expect(started.item).toMatchObject({
      status: "in_progress",
      executionAttempts: [
        expect.objectContaining({
          id: "goal-attempts:work-verify:attempt:1",
          status: "started",
          executionMode: "direct",
        }),
      ],
    });
    expect(started.goal.currentPhase).toBe("executing:work-verify");

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
      summary: "Only tests were produced.",
    });

    expect(blocked.item).toMatchObject({
      status: "blocked",
      executionAttempts: [
        expect.objectContaining({
          status: "blocked",
          providedEvidence: ["tests"],
          missingEvidence: ["typecheck", "residual-risk"],
          missingResidualRisk: true,
        }),
      ],
    });
    expect(blocked.goal.currentPhase).toBe("paused:work-verify");
  });

  it("replays work item execution attempts from canonical session events", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-replay",
      summary: "Replay attempt state.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    const goal = goalRunStore.create({
      id: "goal-replay",
      objective: "Replay execution.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "direct",
    });
    const finished = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
      closeoutSummary: "Replay done.",
    });

    const snapshot = reconstructWorkItemsFromSessionEvents([
      createSessionEvent({
        kind: "work_item_execution_started",
        kilnSessionId: "session-1",
        sequence: 1,
        workItem: started.item,
        attempt: started.attempt,
      }),
      createSessionEvent({
        kind: "work_item_execution_finished",
        kilnSessionId: "session-1",
        sequence: 2,
        workItem: finished.item,
        attempt: finished.attempt,
        missingEvidence: [],
        missingResidualRisk: false,
      }),
    ]);

    expect(snapshot).toMatchObject({
      sequence: finished.item.sequence,
      items: [
        expect.objectContaining({
          id: "work-replay",
          status: "completed",
          executionAttempts: [
            expect.objectContaining({
              id: started.attempt.id,
              status: "completed",
              providedEvidence: ["tests"],
            }),
          ],
        }),
      ],
    });
  });
});

function fixedNow(): string {
  return "2026-05-12T20:00:00.000Z";
}
