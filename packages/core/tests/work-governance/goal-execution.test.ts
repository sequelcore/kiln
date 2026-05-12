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

  it("blocks closeout when a verification gate is skipped without residual risk", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-skipped-gate",
      summary: "Verify skipped gate closeout.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test", "bun run typecheck"],
    });
    const goal = goalRunStore.create({
      id: "goal-skipped-gate",
      objective: "Execute closeout-gated work.",
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

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
      skippedVerificationGates: ["bun run typecheck"],
      summary: "Tests passed; typecheck was not run.",
    });

    expect(blocked).toMatchObject({
      missingEvidence: [],
      missingResidualRisk: true,
      item: {
        status: "blocked",
        skippedVerificationGates: ["bun run typecheck"],
      },
      attempt: {
        status: "blocked",
        skippedVerificationGates: ["bun run typecheck"],
        missingResidualRisk: true,
      },
    });
    expect(blocked.goal.currentPhase).toBe("paused:work-skipped-gate");

    const completed = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      residualRisk: "Typecheck was skipped because this change only exercised test fixtures.",
      closeoutSummary: "Skipped gate documented.",
    });

    expect(completed).toMatchObject({
      missingEvidence: [],
      missingResidualRisk: false,
      item: {
        status: "completed",
        skippedVerificationGates: ["bun run typecheck"],
        residualRisk: "Typecheck was skipped because this change only exercised test fixtures.",
      },
      goal: {
        status: "completed",
        closeoutSummary: "Skipped gate documented.",
      },
    });
  });

  it("records verification gate results and blocks closeout while any gate failed", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-gate-results",
      summary: "Record verification gate results.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck"],
      verificationGates: ["bun test", "bun run typecheck"],
    });
    const goal = goalRunStore.create({
      id: "goal-gate-results",
      objective: "Execute closeout-gated work.",
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

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests", "typecheck"],
      verificationGateResults: [
        { gate: "bun test", status: "passed", summary: "Focused tests passed." },
        { gate: "bun run typecheck", status: "failed", summary: "TypeScript error in workflow projection." },
      ],
      summary: "Typecheck failed.",
    });

    expect(blocked).toMatchObject({
      missingEvidence: [],
      failedVerificationGates: ["bun run typecheck"],
      item: {
        status: "blocked",
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "failed" },
        ],
      },
      attempt: {
        status: "blocked",
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "failed" },
        ],
      },
    });
    expect(blocked.goal.currentPhase).toBe("paused:work-gate-results");

    const completed = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      verificationGateResults: [
        { gate: "bun run typecheck", status: "passed", summary: "Typecheck passed after fix." },
      ],
      closeoutSummary: "All gates passed.",
    });

    expect(completed).toMatchObject({
      failedVerificationGates: [],
      item: {
        status: "completed",
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "passed" },
        ],
      },
      goal: {
        status: "completed",
        closeoutSummary: "All gates passed.",
      },
    });
  });

  it("blocks risky profile closeout until reviewer gate evidence has a passed gate result", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-review-gate",
      summary: "Verify managed-agent review closeout.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review", "tests", "typecheck"],
      verificationGates: ["adversarial managed-agent review", "bun test", "bun run typecheck"],
    });
    const goal = goalRunStore.create({
      id: "goal-review-gate",
      objective: "Execute risky profile work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["managed-agent-review", "tests", "typecheck"],
      verificationGateResults: [
        { gate: "bun test", status: "passed" },
        { gate: "bun run typecheck", status: "passed" },
      ],
    });

    expect(blocked).toMatchObject({
      missingEvidence: [],
      missingVerificationGates: ["adversarial managed-agent review"],
      item: {
        status: "blocked",
      },
      attempt: {
        status: "blocked",
      },
    });

    const completed = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      verificationGateResults: [
        { gate: "adversarial managed-agent review", status: "passed", summary: "No blocking managed-agent risks." },
      ],
      closeoutSummary: "Risky profile review passed.",
    });

    expect(completed).toMatchObject({
      missingVerificationGates: [],
      item: {
        status: "completed",
      },
      goal: {
        status: "completed",
        closeoutSummary: "Risky profile review passed.",
      },
    });
  });

  it("blocks UI profile closeout until browser QA gates have passed", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-browser-gate",
      summary: "Verify browser QA closeout.",
      workflowProfile: "ui-change",
      triggers: ["ui"],
      expectedEvidence: ["browser-qa", "tests", "typecheck"],
      verificationGates: ["browser QA screenshot or interaction proof", "accessibility/overflow check", "typecheck"],
    });
    const goal = goalRunStore.create({
      id: "goal-browser-gate",
      objective: "Execute UI profile work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "ui-change" },
      evidenceRequirements: [],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["browser-qa", "tests", "typecheck"],
      verificationGateResults: [
        { gate: "typecheck", status: "passed" },
      ],
    });

    expect(blocked).toMatchObject({
      missingEvidence: [],
      missingVerificationGates: [
        "browser QA screenshot or interaction proof",
        "accessibility/overflow check",
      ],
      item: {
        status: "blocked",
      },
      attempt: {
        status: "blocked",
      },
    });

    const completed = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      verificationGateResults: [
        { gate: "browser QA screenshot or interaction proof", status: "passed", summary: "Screenshot evidence captured." },
        { gate: "accessibility/overflow check", status: "passed", summary: "No overflow or keyboard regressions found." },
      ],
      closeoutSummary: "Browser QA passed.",
    });

    expect(completed).toMatchObject({
      missingVerificationGates: [],
      item: {
        status: "completed",
      },
      goal: {
        status: "completed",
        closeoutSummary: "Browser QA passed.",
      },
    });
  });

  it("blocks goal completion when required goal evidence is missing from linked work items", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-goal-evidence",
      summary: "Complete item evidence only.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    const goal = goalRunStore.create({
      id: "goal-evidence-closeout",
      objective: "Close only with goal-level evidence.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [
        { id: "tests", description: "Focused tests pass.", required: true },
        { id: "typecheck", description: "Typecheck passes.", required: true },
      ],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
      closeoutSummary: "Should not close without typecheck.",
    });

    expect(blocked).toMatchObject({
      missingEvidence: [],
      missingGoalEvidence: ["typecheck"],
      goal: {
        status: "active",
        currentPhase: "paused:goal-closeout",
      },
      item: {
        status: "completed",
      },
    });
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
        missingGoalEvidence: [],
        missingVerificationGates: [],
        failedVerificationGates: [],
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
