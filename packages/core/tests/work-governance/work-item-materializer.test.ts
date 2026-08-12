import { describe, expect, it } from "vitest";

const TEST_BOUNDED_WORK_REVISION_DIGEST = `sha256:${"a".repeat(64)}`;
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
  projectManagedOrchestrationResultHandoff,
  reconstructWorkItemMaterializationsFromSessionEvents,
  WorkItemStore,
} from "../../src/work-governance/index.js";
import { PlanStateStore, type PlanSubmissionInput } from "../../src/tools/infrastructure/plan-state-store.js";
import { testBoundedWorkRevision } from "./bounded-work-fixtures.js";

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
      source: { kind: "approved_plan", planId: approvedPlan.id, planHash: approvedPlan.contentHash },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-slice-7", ["test-work-item"], "Execute approved Slice 7 plan."),
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
          deliberationIntent: {
            mode: "fixed",
            preferredLevel: "high",
            onUnsupported: "deny",
          },
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
    expect(() => goalRunStore.update({
      id: goal.id,
      workItemIds: result.materialization.workItemIds,
    } as never)).toThrow("field workItemIds is immutable");
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
      source: { kind: "approved_plan", planId: approvedPlan.id, planHash: approvedPlan.contentHash },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-idempotent", ["test-work-item"], "Execute approved plan."),
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

  it("copies approved classification provenance and detects idempotent classification conflicts", () => {
    const approvedPlan = approvedPlanForClassification();
    const goal = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" }).create({
      id: "goal-classification",
      objective: "Execute classified approved work.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: approvedPlan.id, planHash: approvedPlan.contentHash },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-classification", ["test-work-item"], "Execute classified approved work."),
      workItemIds: [],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved classified plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const originalStore = new WorkItemStore({ now: () => "2026-05-12T19:00:00.000Z" });

    const original = materializeApprovedPlanWorkItems({
      plan: approvedPlan,
      goalRun: goal,
      workItemStore: originalStore,
    }).workItems[0]!;

    expect(original).toMatchObject({
      sourceWorkItemId: "write-report",
      workClassification: {
        intents: ["write", "edit"],
        artifacts: ["document"],
        domains: ["business"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      workClassificationProvenance: {
        sourceKind: "plan-work-item",
        sourceId: "write-report",
      },
    });

    const classificationConflictStore = new WorkItemStore();
    classificationConflictStore.upsert({
      ...original,
      workClassification: {
        intents: ["code"],
        artifacts: ["code"],
        domains: ["software"],
        effects: ["mutate-workspace"],
        modes: ["automate"],
      },
    });
    expect(() => materializeApprovedPlanWorkItems({
      plan: approvedPlan,
      goalRun: goal,
      workItemStore: classificationConflictStore,
    })).toThrow(/workClassification/);

    const provenanceConflictStore = new WorkItemStore();
    provenanceConflictStore.upsert({
      ...original,
      sourceWorkItemId: "other-plan-item",
      workClassificationProvenance: {
        sourceKind: "plan-work-item",
        sourceId: "other-plan-item",
      },
    });
    expect(() => materializeApprovedPlanWorkItems({
      plan: approvedPlan,
      goalRun: goal,
      workItemStore: provenanceConflictStore,
    })).toThrow(/workClassificationProvenance/);
  });

  it("fails closed unless the plan is approved for its current content hash and matches the goal", () => {
    const planStateStore = new PlanStateStore({ now: fixedNow });
    const plan = planStateStore.submitPlan(validPlanInput());
    const goal = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" }).create({
      id: "goal-unapproved",
      objective: "Execute approved plan.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: plan.id, planHash: plan.contentHash },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-unapproved", ["test-work-item"], "Execute approved plan."),
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
      goalRun: {
        ...goal,
        source: { kind: "approved_plan", planId: approvedPlan.id, planHash: "sha256:other" },
      },
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
      source: { kind: "approved_plan", planId: missingDependencyPlan.id, planHash: missingDependencyPlan.contentHash },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-dependencies", ["test-work-item"], "Execute dependency-sensitive plan."),
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
      goalRun: {
        ...goal,
        source: { kind: "approved_plan", planId: cyclicPlan.id, planHash: cyclicPlan.contentHash },
      },
      workItemStore: new WorkItemStore(),
    })).toThrow("Work item dependency cycle detected: one -> two -> one");
  });

  it("replays materialization records from canonical events", () => {
    const plan = approvedPlan(validPlanInput());
    const goal = new GoalRunStore({ now: () => "2026-05-12T18:30:00.000Z" }).create({
      id: "goal-replay",
      objective: "Replay materialization.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: plan.id, planHash: plan.contentHash },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-replay", ["test-work-item"], "Replay materialization."),
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
      workingDirectoryMode: "isolated-worktree",
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
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed-orchestration:adoption-gate",
      ],
      verificationGates: [
        "managed orchestration child handoff",
        "managed orchestration merge policy: collect-all",
        "managed orchestration diff evidence",
        "managed orchestration verification",
        "managed orchestration review",
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
          adoptionReadinessRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          readiness: {
            required: true,
            evidence: [
              "managed-orchestration:diff",
              "managed-orchestration:verification",
              "managed-orchestration:review",
            ],
            verificationGates: [
              "managed orchestration diff evidence",
              "managed orchestration verification",
              "managed orchestration review",
              "managed orchestration adoption gate",
            ],
          },
        },
      },
    });
    expect(projectManagedOrchestrationAdoptionGate(result.workItems[0]!)).toMatchObject({
      required: true,
      status: "pending_review",
      target: "slice-6-handoff-review-adoption",
      orchestrationId: "orch-decompose",
      childId: "orch-decompose:child:1",
      blockingEvidence: [
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed orchestration diff evidence",
        "managed orchestration verification",
        "managed orchestration review",
        "managed orchestration adoption gate",
        "managed-orchestration:adoption-gate",
      ],
      resourceUris: [],
    });
    expect(projectManagedOrchestrationResultHandoff(result.workItems[0]!)).toMatchObject({
      required: true,
      status: "pending",
      orchestrationId: "orch-decompose",
      childId: "orch-decompose:child:1",
      workItemId: "orch-decompose:child:1:work-item",
      blockingEvidence: ["managed-orchestration:result-handoff"],
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
    expect(blocked?.missingEvidence).toEqual([
      "managed-orchestration:result-handoff",
      "managed-orchestration:diff",
      "managed-orchestration:verification",
      "managed-orchestration:review",
      "managed-orchestration:adoption-gate",
    ]);
    expect(projectManagedOrchestrationResultHandoff(blocked!.item).status).toBe("blocked");
    expect(projectManagedOrchestrationAdoptionGate(blocked!.item)).toMatchObject({
      required: true,
      status: "blocked",
      blockingEvidence: [
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed orchestration diff evidence",
        "managed orchestration verification",
        "managed orchestration review",
        "managed orchestration adoption gate",
        "managed-orchestration:adoption-gate",
      ],
    });

    const spoofedAdoption = workItemStore.complete({
      id: result.workItems[0]!.id,
      providedEvidence: [
        "managed-orchestration:adoption-gate",
      ],
    });
    expect(spoofedAdoption?.item.status).toBe("blocked");
    expect(spoofedAdoption?.missingEvidence).toEqual([
      "managed-orchestration:result-handoff",
      "managed-orchestration:diff",
      "managed-orchestration:verification",
      "managed-orchestration:review",
      "managed-orchestration:adoption-gate",
    ]);
    expect(projectManagedOrchestrationAdoptionGate(spoofedAdoption!.item).status).toBe("blocked");

    expect(() => workItemStore.upsert({
      ...result.workItems[0]!,
      managedOrchestrationResultHandoff: {
        orchestrationId: "orch-decompose",
        childId: "orch-decompose:child:1",
        workItemId: result.workItems[1]!.id,
        summary: "Implemented runtime helper.",
        completedAt: "2026-05-22T20:30:00.000Z",
        resourceUris: ["kiln://artifacts/orch-decompose/child-1-handoff"],
      },
    })).toThrow("Managed orchestration result handoff work item id must match the work item.");

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

    const childOneStarted = workItemStore.startExecutionAttempt({
      id: result.workItems[0]!.id,
      goalRunId: "goal-orchestration",
      boundedWorkContractRevisionDigest: TEST_BOUNDED_WORK_REVISION_DIGEST,
      executionMode: "managed_delegation",
      managedInvocationId: "orch-decompose:child:1",
    });
    expect(childOneStarted).toBeDefined();

    const adopted = workItemStore.finishExecutionAttempt({
      id: result.workItems[0]!.id,
      attemptId: childOneStarted!.attempt.id,
      providedEvidence: [
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
      ],
      managedInvocationResultHandoff: {
        summary: "Implemented runtime helper and captured reviewable handoff evidence.",
        resourceUris: ["kiln://artifacts/orch-decompose/child-1-handoff"],
      },
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-22T21:00:00.000Z",
        resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
      },
    });
    expect(adopted?.item.status).toBe("blocked");
    expect(adopted?.missingEvidence).toEqual([
      "managed-orchestration:diff",
      "managed-orchestration:verification",
      "managed-orchestration:review",
      "managed-orchestration:adoption-gate",
    ]);
    expect(projectManagedOrchestrationAdoptionGate(adopted!.item)).toMatchObject({
      required: true,
      status: "blocked",
      blockingEvidence: [
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed orchestration diff evidence",
        "managed orchestration verification",
        "managed orchestration review",
        "managed orchestration adoption gate",
        "managed-orchestration:adoption-gate",
      ],
    });

    const adoptedWithReadiness = workItemStore.finishExecutionAttempt({
      id: result.workItems[0]!.id,
      attemptId: childOneStarted!.attempt.id,
      providedEvidence: [
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
      ],
      managedInvocationResultHandoff: {
        summary: "Implemented runtime helper and captured reviewable handoff evidence.",
        resourceUris: ["kiln://artifacts/orch-decompose/child-1-handoff"],
      },
      verificationGateResults: [
        {
          gate: "managed orchestration diff evidence",
          status: "passed",
          evidence: ["kiln://artifacts/orch-decompose/child-1-diff"],
        },
        {
          gate: "managed orchestration verification",
          status: "passed",
          evidence: ["kiln://artifacts/orch-decompose/child-1-tests"],
        },
        {
          gate: "managed orchestration review",
          status: "passed",
          evidence: ["kiln://artifacts/orch-decompose/child-1-review"],
        },
        {
          gate: "managed orchestration adoption gate",
          status: "passed",
          evidence: ["kiln://artifacts/orch-decompose/adoption-review"],
        },
      ],
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-22T21:00:00.000Z",
        resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
      },
    });
    expect(adoptedWithReadiness?.item.status).toBe("completed");
    expect(adoptedWithReadiness?.item.managedOrchestrationAdoption).toEqual({
      target: "slice-6-handoff-review-adoption",
      adoptedBy: "reviewer",
      adoptedAt: "2026-05-22T21:00:00.000Z",
      resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
    });
    expect(adoptedWithReadiness?.missingEvidence).toEqual([]);
    expect(projectManagedOrchestrationAdoptionGate(adoptedWithReadiness!.item)).toMatchObject({
      required: true,
      status: "adopted",
      adoptedBy: "reviewer",
      adoptedAt: "2026-05-22T21:00:00.000Z",
      blockingEvidence: [],
      resourceUris: ["kiln://artifacts/orch-decompose/adoption-review"],
    });
    expect(projectManagedOrchestrationResultHandoff(adoptedWithReadiness!.item)).toMatchObject({
      required: true,
      status: "recorded",
      summary: "Implemented runtime helper and captured reviewable handoff evidence.",
      completedAt: "2026-05-22T20:00:00.000Z",
      resourceUris: ["kiln://artifacts/orch-decompose/child-1-handoff"],
      blockingEvidence: [],
    });

    const contradictory = workItemStore.upsert({
      ...adoptedWithReadiness!.item,
      id: "orch-decompose:child:contradictory:work-item",
      status: "completed",
      managedOrchestrationResultHandoff: undefined,
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
      blockingEvidence: [
        "managed orchestration adoption gate",
        "managed-orchestration:adoption-gate",
      ],
    });

    const childTwoStarted = workItemStore.startExecutionAttempt({
      id: result.workItems[1]!.id,
      goalRunId: "goal-orchestration",
      boundedWorkContractRevisionDigest: TEST_BOUNDED_WORK_REVISION_DIGEST,
      executionMode: "managed_delegation",
      managedInvocationId: "orch-decompose:child:2",
    });
    expect(childTwoStarted).toBeDefined();

    const rejected = workItemStore.finishExecutionAttempt({
      id: result.workItems[1]!.id,
      attemptId: childTwoStarted!.attempt.id,
      providedEvidence: [
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
      ],
      managedInvocationResultHandoff: {
        summary: "Implemented CLI surface and captured reviewable handoff evidence.",
        resourceUris: ["kiln://artifacts/orch-decompose/child-2-handoff"],
      },
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
      blockingEvidence: [
        "managed orchestration adoption gate",
        "managed-orchestration:adoption-gate",
      ],
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
        workingDirectoryMode: "isolated-worktree",
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

function approvedPlanForClassification() {
  return approvedPlan(validPlanInput({
    proposedWorkItems: [
      workItemDraft({
        id: "write-report",
        summary: "Write the governed report.",
        workflowProfile: "verification-heavy",
        workClassification: {
          intents: [" write ", "write", "edit"],
          artifacts: [" document ", "document"],
          domains: [" business "],
          effects: [" write-artifact "],
          modes: [" coauthor "],
        },
        workClassificationProvenance: {
          sourceKind: "plan-work-item",
          sourceId: " write-report ",
        },
      }),
    ],
  }));
}
