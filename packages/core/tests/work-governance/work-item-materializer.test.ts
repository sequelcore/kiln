import { describe, expect, it } from "vitest";
import { createSessionEvent } from "../../src/events/index.js";
import {
  buildManagedAgentDecompositionOrchestrationRequest,
  buildManagedAgentFanOutOrchestrationRequest,
} from "../../src/agents/managed-invocation/index.js";
import {
  GoalRunStore,
  materializeApprovedPlanWorkItems,
  materializeManagedAgentOrchestrationWorkItems,
  projectManagedOrchestrationAdoptionGate,
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

  it("materializes managed decomposition children with orchestration evidence and adoption gating", () => {
    const workItemStore = new WorkItemStore({ now: () => "2026-05-22T20:00:00.000Z" });
    const request = buildManagedAgentDecompositionOrchestrationRequest({
      orchestrationId: "orch-decompose",
      parentSessionId: "session-1",
      parentTurnId: "turn-1",
      requestedBy: "operator",
      requestSource: "core-test",
      task: "Split implementation work.",
      maxConcurrentChildren: 2,
      childPlans: [
        {
          roleIntent: "runtime-coder",
          task: "Implement runtime helper.",
        },
        {
          roleIntent: "cli-coder",
          task: "Wire CLI surface.",
        },
      ],
    });

    const result = materializeManagedAgentOrchestrationWorkItems({
      orchestrationRequest: request,
      workItemStore,
      goalRunId: "goal-orchestration",
      workflowProfile: "managed-agent-change",
      risk: "high",
      assignedAgentProfile: "coder",
      routeId: "codex-worker",
      authorityProfile: "foundation-apply-approved-writes",
    });

    expect(result.workItems).toHaveLength(2);
    expect(result.workItems.map((item) => item.id)).toEqual([
      "orch-decompose:child:1:work-item",
      "orch-decompose:child:2:work-item",
    ]);
    expect(result.workItems[0]).toMatchObject({
      summary: "Implement runtime helper.",
      workflowProfile: "managed-agent-change",
      risk: "high",
      triggers: ["managed-agent-change", "high", "decomposition", "collect-all"],
      expectedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
        "managed-orchestration:adoption-gate",
      ],
      verificationGates: [
        "managed orchestration child handoff",
        "managed orchestration merge policy: collect-all",
        "managed orchestration adoption gate",
      ],
      goalRunId: "goal-orchestration",
      routeId: "codex-worker",
      assignedAgentProfile: "coder",
      authorityProfile: "foundation-apply-approved-writes",
      managedOrchestration: {
        orchestrationId: "orch-decompose",
        mode: "decomposition",
        childId: "orch-decompose:child:1",
        ordinal: 1,
        roleIntent: "runtime-coder",
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
        },
      },
    });
    expect(projectManagedOrchestrationAdoptionGate(result.workItems[0]!)).toMatchObject({
      required: true,
      status: "pending_review",
      target: "slice-6-handoff-review-adoption",
      orchestrationId: "orch-decompose",
      childId: "orch-decompose:child:1",
      blockingEvidence: ["managed-orchestration:adoption-gate"],
      resourceUris: [],
    });

    const blocked = workItemStore.complete({
      id: result.workItems[0]!.id,
      providedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
      ],
    });
    expect(blocked?.item.status).toBe("blocked");
    expect(blocked?.missingEvidence).toEqual(["managed-orchestration:adoption-gate"]);
    expect(projectManagedOrchestrationAdoptionGate(blocked!.item)).toMatchObject({
      required: true,
      status: "blocked",
      blockingEvidence: ["managed-orchestration:adoption-gate"],
    });

    const spoofedAdoption = workItemStore.complete({
      id: result.workItems[0]!.id,
      providedEvidence: [
        "managed-orchestration:adoption-gate",
      ],
    });
    expect(spoofedAdoption?.item.status).toBe("blocked");
    expect(spoofedAdoption?.missingEvidence).toEqual(["managed-orchestration:adoption-gate"]);
    expect(projectManagedOrchestrationAdoptionGate(spoofedAdoption!.item).status).toBe("blocked");

    expect(() => workItemStore.complete({
      id: result.workItems[0]!.id,
      managedOrchestrationAdoption: {
        target: "other-adoption-workflow" as "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-22T21:00:00.000Z",
        resourceUris: ["kiln://artifacts/orch-decompose/wrong-adoption"],
      },
    })).toThrow("Managed orchestration adoption target must be slice-6-handoff-review-adoption.");

    expect(() => workItemStore.complete({
      id: result.workItems[0]!.id,
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-22T21:00:00.000Z",
        resourceUris: [],
      },
    })).toThrow("Managed orchestration adoption requires at least one resource uri.");

    const adopted = workItemStore.complete({
      id: result.workItems[0]!.id,
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-22T21:00:00.000Z",
        resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
      },
    });
    expect(adopted?.item.status).toBe("completed");
    expect(adopted?.item.managedOrchestrationAdoption).toEqual({
      target: "slice-6-handoff-review-adoption",
      adoptedBy: "reviewer",
      adoptedAt: "2026-05-22T21:00:00.000Z",
      resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
    });
    expect(adopted?.missingEvidence).toEqual([]);
    expect(projectManagedOrchestrationAdoptionGate(adopted!.item)).toMatchObject({
      required: true,
      status: "adopted",
      adoptedBy: "reviewer",
      adoptedAt: "2026-05-22T21:00:00.000Z",
      blockingEvidence: [],
      resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
    });

    const contradictory = workItemStore.upsert({
      ...adopted!.item,
      id: "orch-decompose:child:contradictory:work-item",
      status: "completed",
      verificationGateResults: [{
        gate: "managed orchestration adoption gate",
        status: "failed",
        summary: "Reviewer rejected after replay.",
        evidence: ["kiln://artifacts/orch-decompose/contradictory-review"],
        completedAt: "2026-05-22T21:03:00.000Z",
      }],
    });
    expect(projectManagedOrchestrationAdoptionGate(contradictory)).toMatchObject({
      required: true,
      status: "rejected",
      rejection: {
        gate: "managed orchestration adoption gate",
        summary: "Reviewer rejected after replay.",
        evidence: ["kiln://artifacts/orch-decompose/contradictory-review"],
        completedAt: "2026-05-22T21:03:00.000Z",
      },
      blockingEvidence: ["managed-orchestration:adoption-gate"],
    });

    const rejected = workItemStore.complete({
      id: result.workItems[1]!.id,
      providedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
      ],
      verificationGateResults: [{
        gate: "managed orchestration adoption gate",
        status: "failed",
        summary: "Reviewer rejected the child handoff.",
        evidence: ["kiln://artifacts/orch-decompose/child-2-review"],
        completedAt: "2026-05-22T21:05:00.000Z",
      }],
    });
    expect(rejected?.item.status).toBe("blocked");
    expect(projectManagedOrchestrationAdoptionGate(rejected!.item)).toMatchObject({
      required: true,
      status: "rejected",
      rejection: {
        gate: "managed orchestration adoption gate",
        summary: "Reviewer rejected the child handoff.",
        evidence: ["kiln://artifacts/orch-decompose/child-2-review"],
        completedAt: "2026-05-22T21:05:00.000Z",
      },
      blockingEvidence: ["managed-orchestration:adoption-gate"],
    });
  });

  it("materializes fan-out work items with compare evidence without adoption gating", () => {
    const result = materializeManagedAgentOrchestrationWorkItems({
      orchestrationRequest: buildManagedAgentFanOutOrchestrationRequest({
        orchestrationId: "orch-fan-out",
        parentSessionId: "session-1",
        parentTurnId: "turn-1",
        requestedBy: "operator",
        requestSource: "core-test",
        task: "Generate duplicate candidates.",
        childCount: 2,
        maxConcurrentChildren: 2,
      }),
      workItemStore: new WorkItemStore({ now: () => "2026-05-22T20:00:00.000Z" }),
      goalRunId: "goal-fan-out",
    });

    expect(result.workItems.map((item) => item.expectedEvidence)).toEqual([
      [
        "managed-orchestration:result-handoff",
        "managed-orchestration:comparison-summary",
        "managed-orchestration:merge:compare-and-select",
      ],
      [
        "managed-orchestration:result-handoff",
        "managed-orchestration:comparison-summary",
        "managed-orchestration:merge:compare-and-select",
      ],
    ]);
    expect(result.workItems.map((item) => item.managedOrchestration?.adoptionGate.required)).toEqual([
      false,
      false,
    ]);
    expect(result.workItems.map((item) => projectManagedOrchestrationAdoptionGate(item))).toEqual([
      {
        required: false,
        status: "not_required",
        target: "slice-6-handoff-review-adoption",
        reason: "Managed fan-out orchestration does not require automatic parent adoption.",
        orchestrationId: "orch-fan-out",
        childId: "orch-fan-out:child:1",
        mergePolicyMode: "compare-and-select",
        resourceUris: [],
        blockingEvidence: [],
      },
      {
        required: false,
        status: "not_required",
        target: "slice-6-handoff-review-adoption",
        reason: "Managed fan-out orchestration does not require automatic parent adoption.",
        orchestrationId: "orch-fan-out",
        childId: "orch-fan-out:child:2",
        mergePolicyMode: "compare-and-select",
        resourceUris: [],
        blockingEvidence: [],
      },
    ]);
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
