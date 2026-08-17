import { describe, expect, it } from "vitest";
import { createSessionEvent } from "../../src/events/index.js";
import {
  GoalRunStore,
  WorkItemStore,
  completeGoalExecution,
  reconstructGoalRunsFromSessionEvents,
  selectNextGoalExecutionStep,
} from "../../src/work-governance/index.js";
import { testBoundedWorkCloseoutDecision, testBoundedWorkRevision } from "./bounded-work-fixtures.js";

describe("GoalRunStore", () => {
  it("requires bounded-work authority at goal creation and rejects legacy restoration", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const input = {
      id: "goal-requires-revision",
      objective: "Require an immutable bounded contract.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct" as const, turnId: "turn-1" },
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "read_only" as const,
        escalationPolicy: "deny" as const,
        reason: "Inspection only.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    };

    expect(() => store.create(input as never)).toThrow(
      "GoalRun bounded-work contract revision is required",
    );
    expect(() => store.restore({
      ...input,
      status: "active" as const,
      createdAt: "2026-05-12T18:00:00.000Z",
      updatedAt: "2026-05-12T18:00:00.000Z",
      activeDurationMs: 0,
      activeSince: "2026-05-12T18:00:00.000Z",
      sequence: 1,
    } as never)).toThrow("Goal goal-requires-revision requires bounded-work reconciliation");
  });

  it("supersedes bounded-work authority with CAS and preserves the complete revision history", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const goal = store.create({
      id: "goal-revisions",
      objective: "Preserve bounded contract lineage.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-revisions", ["test-work-item"], "Preserve bounded contract lineage."),
      workItemIds: ["test-work-item"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved bounded work.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });
    const first = goal.boundedWorkContractRevision;
    const second = store.supersedeBoundedWorkContract({
      id: goal.id,
      expectedRevisionDigest: first.revisionDigest,
      contract: {
        ...first.contract,
        limits: { ...first.contract.limits, maxExecutionAttempts: 1 },
      },
      adoptedAt: "2026-05-12T18:01:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-2" },
    });

    expect(second.boundedWorkContractRevision.revision).toBe(2);
    expect(second.boundedWorkContractRevision.parentRevisionDigest).toBe(first.revisionDigest);
    expect(second.boundedWorkContractRevisionHistory).toEqual([first, second.boundedWorkContractRevision]);
    expect(() => store.supersedeBoundedWorkContract({
      id: goal.id,
      expectedRevisionDigest: first.revisionDigest,
      contract: first.contract,
      adoptedAt: "2026-08-12T18:02:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "stale-decision" },
    })).toThrow("bounded-work revision conflict");
  });

  it("rejects ordinary authority-field mutation and permits only in-scope explicit work attachment", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const goal = store.create({
      id: "goal-immutable-fields",
      objective: "Keep authority fields immutable.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-immutable-fields", ["test-work-item", "second-work-item"], "Keep authority fields immutable."),
      workItemIds: ["test-work-item"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved bounded work.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });

    expect(() => store.update({ id: goal.id, objective: "Widened." } as never)).toThrow(
      "field objective is immutable",
    );
    expect(store.attachWorkItems({ id: goal.id, workItemIds: ["second-work-item"] }).workItemIds)
      .toEqual(["test-work-item", "second-work-item"]);
    expect(() => store.attachWorkItems({ id: goal.id, workItemIds: ["outside-scope"] })).toThrow(
      "outside the current bounded-work scope",
    );
  });

  it("enforces goal identity, objective, and initial scope bindings and rejects forged history", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const base = {
      id: "goal-bindings",
      objective: "Bind the goal to bounded authority.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct" as const, turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision(
        "goal-bindings",
        ["test-work-item"],
        "Bind the goal to bounded authority.",
      ),
      workItemIds: ["test-work-item"],
      authorityEnvelope: {
        maximumAuthority: "audited" as const,
        escalationPolicy: "approval_required" as const,
        reason: "Approved bounded work.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    };

    expect(() => store.create({
      ...base,
      id: "goal-other-id",
    })).toThrow("accounting lineage must equal the goal id");
    expect(() => store.create({
      ...base,
      objective: "Widen the goal.",
    })).toThrow("objective must equal bounded-work contract intent.objective");
    expect(() => store.create({
      ...base,
      workItemIds: ["outside-scope"],
    })).toThrow("outside the current bounded-work scope");

    const goal = store.create(base);
    const second = store.supersedeBoundedWorkContract({
      id: goal.id,
      expectedRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      contract: goal.boundedWorkContractRevision.contract,
      adoptedAt: "2026-08-12T18:01:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-2" },
    });
    const third = store.supersedeBoundedWorkContract({
      id: goal.id,
      expectedRevisionDigest: second.boundedWorkContractRevision.revisionDigest,
      contract: second.boundedWorkContractRevision.contract,
      adoptedAt: "2026-08-12T18:02:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-3" },
    });
    expect(() => store.restore({
      ...third,
      boundedWorkContractRevisionHistory: [
        third.boundedWorkContractRevisionHistory[0]!,
        third.boundedWorkContractRevision,
      ],
    })).toThrow("bounded-work revision history is not contiguous");
  });

  it("owns foreground goal lifecycle and accumulates only active execution time", () => {
    let now = "2026-05-12T18:00:00.000Z";
    const store = new GoalRunStore({ now: () => now });
    const goal = store.create({
      id: "goal-lifecycle",
      objective: "Control the foreground goal.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-lifecycle", ["test-work-item"], "Control the foreground goal."),
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Operator-controlled implementation.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });

    expect(goal).toMatchObject({
      status: "active",
      activeDurationMs: 0,
      activeSince: "2026-05-12T18:00:00.000Z",
    });

    now = "2026-05-12T18:02:30.000Z";
    const paused = store.pause({ id: goal.id });
    expect(paused).toMatchObject({
      status: "paused",
      currentPhase: "operator_paused",
      activeDurationMs: 150_000,
    });
    expect(paused).not.toHaveProperty("activeSince");
    expect(selectNextGoalExecutionStep({ goalRun: paused, workItems: [] })).toMatchObject({
      status: "paused",
      reasonCode: "operator_paused",
    });
    expect(() => completeGoalExecution({
      goalRunStore: store,
      workItemStore: new WorkItemStore(),
      goalRunId: paused.id,
      boundedWorkCloseoutDecision: testBoundedWorkCloseoutDecision(paused.id, paused.boundedWorkContractRevision),
    })).toThrow("Goal goal-lifecycle is paused and cannot start or close execution");

    now = "2026-05-12T18:12:30.000Z";
    const resumed = store.resume({ id: goal.id });
    expect(resumed).toMatchObject({
      status: "active",
      activeDurationMs: 150_000,
      activeSince: "2026-05-12T18:12:30.000Z",
    });

    now = "2026-05-12T18:13:00.000Z";
    expect(store.complete({
      id: goal.id,
      closeoutSummary: "Done.",
      boundedWorkCloseoutDecision: testBoundedWorkCloseoutDecision(goal.id, goal.boundedWorkContractRevision),
    })).toMatchObject({
      status: "completed",
      activeDurationMs: 180_000,
    });
  });

  it("permits only one non-terminal foreground goal per owner session", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const input = {
      objective: "First goal.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct" as const, turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-1", ["test-work-item"], "First goal."),
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "read_only" as const,
        escalationPolicy: "deny" as const,
        reason: "Inspection only.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    };
    store.create({ ...input, id: "goal-1" });

    expect(() => store.create({ ...input, id: "goal-2" })).toThrow(
      "Session session-1 already has foreground goal goal-1",
    );
  });

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
      boundedWorkContractRevision: testBoundedWorkRevision("goal-1", ["wi-1", "wi-2"], "Execute approved plan through governed work items."),
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
      source: { kind: "approved_plan" as const, planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-terminal", ["test-work-item"], "Complete once."),
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only closeout.",
      },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });

    expect(store.complete({
      id: goal.id,
      closeoutSummary: "All evidence linked.",
      boundedWorkCloseoutDecision: testBoundedWorkCloseoutDecision(goal.id, goal.boundedWorkContractRevision),
    })).toMatchObject({
      status: "completed",
      currentPhase: "completed",
    });
    expect(() => store.update({ id: goal.id, currentPhase: "resume" })).toThrow(
      "Goal goal-terminal is terminal and cannot transition",
    );
    expect(() => store.cancel({ id: goal.id, reason: "operator changed mind" })).toThrow(
      "Goal goal-terminal is terminal and cannot transition",
    );
  });

  it("records structured evidence only for declared goal requirements", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const goal = store.create({
      id: "goal-evidence",
      objective: "Close the governed release.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan" as const, planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-evidence", ["wi-1"], "Close the governed release."),
      workItemIds: ["wi-1"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Release evidence must be explicit.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [
        { id: "release-contract", description: "Release contract is verified.", required: true },
      ],
    });

    const recorded = store.recordEvidence({
      id: goal.id,
      requirementId: "release-contract",
      summary: "Package manifests and public exports match the release contract.",
      resourceUris: ["kiln://artifact/release-contract"],
      workItemIds: ["wi-1"],
    });

    expect(recorded.evidence).toEqual([
      {
        requirementId: "release-contract",
        summary: "Package manifests and public exports match the release contract.",
        resourceUris: ["kiln://artifact/release-contract"],
        workItemIds: ["wi-1"],
        recordedAt: "2026-05-12T18:00:00.000Z",
      },
    ]);
    expect(() => store.recordEvidence({
      id: goal.id,
      requirementId: "undeclared",
      summary: "This must not be accepted.",
    })).toThrow("Goal goal-evidence does not declare evidence requirement undeclared");
  });

  it("fails fast for invalid authority, duplicate work items, and malformed evidence requirements", () => {
    const store = new GoalRunStore({ now: () => "2026-05-12T18:00:00.000Z" });
    const validInput = {
      id: "goal-validation",
      objective: "Validate goal input.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan" as const, planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-validation", ["wi-1"], "Validate goal input."),
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
    const boundedWorkContractRevision = testBoundedWorkRevision("goal-replay", ["wi-1"], "Replay goal from session events.");
    const baseGoal = {
      id: "goal-replay",
      objective: "Replay goal from session events.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan" as const, planId: "plan-1", planHash: "sha256:plan" },
      boundedWorkContractRevision,
      boundedWorkContractRevisionHistory: [boundedWorkContractRevision],
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
      evidence: [],
      activeDurationMs: 0,
      createdAt: created.toISOString(),
      updatedAt: created.toISOString(),
      sequence: 1,
    };

    const snapshot = reconstructGoalRunsFromSessionEvents([
      createSessionEvent<"goal.created">({
        kind: "goal.created",
        kilnSessionId: "session-1",
        sequence: 1,
        goal: baseGoal,
      }),
      createSessionEvent<"goal.updated">({
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
      createSessionEvent<"goal.completed">({
        kind: "goal.completed",
        kilnSessionId: "session-1",
        sequence: 3,
        goal: {
          ...baseGoal,
          status: "completed",
          currentPhase: "verification",
          closeoutSummary: "Evidence linked.",
          boundedWorkCloseoutDecision: testBoundedWorkCloseoutDecision("goal-replay", boundedWorkContractRevision),
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
          boundedWorkCloseoutDecision: expect.objectContaining({
            kind: "stop_acceptance_complete",
            contractRevisionDigest: boundedWorkContractRevision.revisionDigest,
          }),
          workItemIds: ["wi-1"],
        },
      ],
    });
    expect(snapshot.goals[0]).not.toHaveProperty("workItems");
  });
});
