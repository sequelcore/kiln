import { describe, expect, it } from "vitest";
import { createSessionEvent } from "../../src/events/index.js";
import {
  GoalRunStore,
  materializeApprovedPlanWorkItems,
  reconstructWorkItemMaterializationsFromSessionEvents,
  WorkItemStore,
} from "../../src/work-governance/index.js";
import { PlanStateStore, type PlanSubmissionInput } from "../../src/tools/infrastructure/plan-state-store.js";

describe("materializeApprovedPlanWorkItems", () => {
  it("materializes an approved plan into deterministic governed work items with provenance and recommendations", () => {
    const planStateStore = new PlanStateStore({ now: fixedNow });
    const plan = planStateStore.submitPlan(validPlanInput());
    const approval = planStateStore.approvePlan(plan.id);
    if (!approval.success) throw new Error(approval.message);
    const approvedPlan = planStateStore.getPlan(plan.id);
    if (!approvedPlan) throw new Error("plan missing");

    const workItemStore = new WorkItemStore({ now: () => "2026-05-12T19:00:00.000Z" });
    const goalRunStore = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" });
    const goal = goalRunStore.create({
      id: "goal-slice-7",
      objective: "Execute approved Slice 7 plan.",
      ownerSessionId: "session-1",
      planId: approvedPlan.id,
      planHash: approvedPlan.contentHash,
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan permits audited work.",
      },
      routePolicy: {
        workflowProfile: "architecture-change",
        managedAgentProfile: "coder",
        preferredRouteId: "codex-worker",
      },
      evidenceRequirements: [
        { id: "tests", description: "Focused tests pass.", required: true },
      ],
    });

    const result = materializeApprovedPlanWorkItems({
      plan: approvedPlan,
      goalRun: goal,
      workItemStore,
    });

    expect(result.materialization).toMatchObject({
      planId: approvedPlan.id,
      planHash: approvedPlan.contentHash,
      approvalId: approval.approval.approvalId,
      goalRunId: goal.id,
      sourceWorkItemIds: ["scout", "implement"],
      reusedWorkItemIds: [],
    });
    expect(result.workItems.map((item) => item.id)).toEqual(result.materialization.workItemIds);
    expect(result.workItems).toEqual([
      expect.objectContaining({
        summary: "Scout impacted files.",
        planId: approvedPlan.id,
        planHash: approvedPlan.contentHash,
        goalRunId: goal.id,
        sourceWorkItemId: "scout",
        dependencies: [],
        expectedEvidence: ["surface-map"],
        routingRecommendation: {
          routeId: "codex-worker",
          agentProfile: "coder",
          reasoningEffort: "high",
          modelTaskSuitability: "architecture-change:high",
          rationale: "Derived from plan workflow profile architecture-change and risk high.",
        },
      }),
      expect.objectContaining({
        summary: "Implement materializer.",
        sourceWorkItemId: "implement",
        dependencies: [result.workItems[0]!.id],
        expectedEvidence: ["tests", "typecheck"],
        verificationGates: ["bun run --filter @kilnai/core test", "bun run typecheck"],
      }),
    ]);
    expect(goalRunStore.update({ id: goal.id, workItemIds: result.materialization.workItemIds }).workItemIds)
      .toEqual(result.materialization.workItemIds);
    expect(workItemStore.snapshot().items.map((item) => item.planHash)).toEqual([
      approvedPlan.contentHash,
      approvedPlan.contentHash,
    ]);
  });

  it("is idempotent for the same approved plan hash and goal", () => {
    const planStateStore = new PlanStateStore({ now: fixedNow });
    const plan = planStateStore.submitPlan(validPlanInput());
    const approval = planStateStore.approvePlan(plan.id);
    if (!approval.success) throw new Error(approval.message);
    const approvedPlan = planStateStore.getPlan(plan.id);
    if (!approvedPlan) throw new Error("plan missing");

    const workItemStore = new WorkItemStore({ now: () => "2026-05-12T19:00:00.000Z" });
    const goal = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" }).create({
      id: "goal-idempotent",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: approvedPlan.id,
      planHash: approvedPlan.contentHash,
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [],
    });

    const first = materializeApprovedPlanWorkItems({ plan: approvedPlan, goalRun: goal, workItemStore });
    const firstSnapshot = workItemStore.snapshot();
    const second = materializeApprovedPlanWorkItems({ plan: approvedPlan, goalRun: goal, workItemStore });

    expect(second.materialization.workItemIds).toEqual(first.materialization.workItemIds);
    expect(second.materialization.createdWorkItemIds).toEqual([]);
    expect(second.materialization.reusedWorkItemIds).toEqual(first.materialization.workItemIds);
    expect(workItemStore.snapshot()).toEqual(firstSnapshot);
    expect(() => materializeApprovedPlanWorkItems({
      plan: approvedPlan,
      goalRun: {
        ...goal,
        routePolicy: {
          ...goal.routePolicy,
          preferredRouteId: "other-route",
        },
      },
      workItemStore,
    })).toThrow("conflicts with approved plan materialization: routeId, routingRecommendation");
  });

  it("fails closed unless the plan is approved for its current content hash and matches the goal", () => {
    const planStateStore = new PlanStateStore({ now: fixedNow });
    const plan = planStateStore.submitPlan(validPlanInput());
    const goal = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" }).create({
      id: "goal-unapproved",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      planId: plan.id,
      planHash: plan.contentHash,
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "No execution approval.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [],
    });

    expect(() => materializeApprovedPlanWorkItems({
      plan,
      goalRun: goal,
      workItemStore: new WorkItemStore(),
    })).toThrow("Plan plan_slice7 is not approved for execution");

    const approval = planStateStore.approvePlan(plan.id);
    if (!approval.success) throw new Error(approval.message);
    const approvedPlan = planStateStore.getPlan(plan.id);
    if (!approvedPlan) throw new Error("plan missing");

    expect(() => materializeApprovedPlanWorkItems({
      plan: approvedPlan,
      goalRun: { ...goal, planHash: "sha256:other" },
      workItemStore: new WorkItemStore(),
    })).toThrow("Goal goal-unapproved is not bound to approved plan hash");
  });

  it("fails closed for missing dependencies and dependency cycles", () => {
    const missingDependencyPlan = approvedPlan(validPlanInput({
      proposedWorkItems: [
        workItemDraft({ id: "one", dependencies: ["missing"] }),
      ],
    }));
    const cyclicPlan = approvedPlan(validPlanInput({
      proposedWorkItems: [
        workItemDraft({ id: "one", dependencies: ["two"] }),
        workItemDraft({ id: "two", dependencies: ["one"] }),
      ],
    }));
    const goalRunStore = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" });
    const goal = goalRunStore.create({
      id: "goal-dependencies",
      objective: "Execute dependency-sensitive plan.",
      ownerSessionId: "session-1",
      planId: missingDependencyPlan.id,
      planHash: missingDependencyPlan.contentHash,
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [],
    });

    expect(() => materializeApprovedPlanWorkItems({
      plan: missingDependencyPlan,
      goalRun: goal,
      workItemStore: new WorkItemStore(),
    })).toThrow("Work item one depends on unknown proposed work item missing");

    expect(() => materializeApprovedPlanWorkItems({
      plan: cyclicPlan,
      goalRun: { ...goal, planId: cyclicPlan.id, planHash: cyclicPlan.contentHash },
      workItemStore: new WorkItemStore(),
    })).toThrow("Work item dependency cycle detected: one -> two -> one");
  });

  it("replays materialization records from canonical events", () => {
    const plan = approvedPlan(validPlanInput());
    const goal = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" }).create({
      id: "goal-replay",
      objective: "Replay materialization.",
      ownerSessionId: "session-1",
      planId: plan.id,
      planHash: plan.contentHash,
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "architecture-change" },
      evidenceRequirements: [],
    });
    const result = materializeApprovedPlanWorkItems({
      plan,
      goalRun: goal,
      workItemStore: new WorkItemStore({ now: () => "2026-05-12T19:00:00.000Z" }),
    });

    const snapshot = reconstructWorkItemMaterializationsFromSessionEvents([
      createSessionEvent({
        kind: "work_items.materialized",
        kilnSessionId: "session-1",
        sequence: 1,
        materialization: result.materialization,
      }),
    ]);

    expect(snapshot).toMatchObject({
      sequence: result.materialization.sequence,
      materializations: [result.materialization],
    });
  });
});

function fixedNow(): number {
  return Date.parse("2026-05-12T18:00:00.000Z");
}

function validPlanInput(overrides: Partial<PlanSubmissionInput> = {}): PlanSubmissionInput {
  return {
    planId: "plan_slice7",
    objective: "Materialize approved plan into governed work items.",
    nonGoals: ["Do not execute work items."],
    operatorDecisionsRequired: ["Approve materialization before execution."],
    assumptions: ["Approved plan content hash is authoritative."],
    affectedSurfaces: ["core", "gateway-contracts"],
    riskClassification: "high",
    workGovernanceRecommendation: {
      posture: "orchestrate",
      rationale: "Cross-surface workflow contract.",
      workflowProfile: "architecture-change",
    },
    proposedWorkItems: [
      workItemDraft({
        id: "scout",
        summary: "Scout impacted files.",
        expectedEvidence: ["surface-map"],
        verificationGates: ["review scout evidence"],
      }),
      workItemDraft({
        id: "implement",
        summary: "Implement materializer.",
        expectedEvidence: ["tests", "typecheck"],
        verificationGates: ["bun run --filter @kilnai/core test", "bun run typecheck"],
        dependencies: ["scout"],
      }),
    ],
    expectedEvidence: ["tests", "typecheck"],
    verificationGates: ["bun run --filter @kilnai/core test", "bun run typecheck"],
    managedAgentDelegationCandidates: ["coder"],
    approvalBoundaries: ["Operator approval before execution."],
    rollbackNotes: "Revert work-governance materializer changes.",
    residualRisks: ["Runtime integration remains later."],
    sourceSpecificationId: "spec-slice-7",
    clarificationRecordIds: [],
    constitutionSnapshot: {
      instructionProfileHash: "hash-slice-7",
      instructionProfileIds: ["sequel-engineering"],
    },
    ...overrides,
  };
}

function workItemDraft(
  overrides: Partial<PlanSubmissionInput["proposedWorkItems"][number]> = {},
): PlanSubmissionInput["proposedWorkItems"][number] {
  return {
    id: "item",
    summary: "Do work.",
    workflowProfile: "architecture-change",
    risk: "high",
    expectedEvidence: ["tests"],
    verificationGates: ["bun test"],
    dependencies: [],
    ...overrides,
  };
}

function approvedPlan(input: PlanSubmissionInput) {
  const store = new PlanStateStore({ now: fixedNow });
  const plan = store.submitPlan(input);
  const approval = store.approvePlan(plan.id);
  if (!approval.success) throw new Error(approval.message);
  const approved = store.getPlan(plan.id);
  if (!approved) throw new Error("plan missing");
  return approved;
}
