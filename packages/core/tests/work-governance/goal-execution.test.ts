import { describe, expect, it } from "vitest";
import {
  completeGoalExecution,
  createBoundedWorkCandidate,
  createBoundedWorkCandidateEvidence,
  decideBoundedWorkCloseout,
  evaluateBoundedWorkAssurance,
  failGoalExecutionAttempt,
  finishGoalExecutionAttempt,
  GoalRunStore,
  projectManagedOrchestrationAdoptionGate,
  reconstructWorkItemsFromSessionEvents,
  selectNextGoalExecutionStep,
  startGoalExecutionAttempt,
  WorkItemStore,
  type BoundedWorkCloseoutDecision,
  type GoalRun,
  type WorkItemExecutionAttempt,
} from "../../src/work-governance/index.js";
import { createSessionEvent } from "../../src/events/index.js";
import { formalVerificationToolMetadata } from "../../src/tools/domain/tool-result-metadata.js";
import { boundedWorkDigest } from "../../src/work-governance/bounded-work-content.js";
import { testBoundedWorkRevision } from "./bounded-work-fixtures.js";

describe("goal execution loop", () => {
  it("binds attempts to one contract revision and rejects stale completion after supersession", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-revision-bound",
      summary: "Finish only under the admitted revision.",
      workflowProfile: "small-fix",
      triggers: [],
      expectedEvidence: [],
      verificationGates: [],
    });
    const goal = goalRunStore.create({
      id: "goal-revision-bound",
      objective: "Bind the attempt revision.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision(
        "goal-revision-bound",
        [item.id],
        "Bind the attempt revision.",
      ),
      workItemIds: [item.id],
      authorityEnvelope: { maximumAuthority: "audited", escalationPolicy: "approval_required", reason: "Test." },
      routePolicy: { workflowProfile: "small-fix" },
      evidenceRequirements: [],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "direct",
    });
    expect(started.attempt.boundedWorkContractRevisionDigest)
      .toBe(goal.boundedWorkContractRevision.revisionDigest);
    goalRunStore.supersedeBoundedWorkContract({
      id: goal.id,
      expectedRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      contract: {
        ...goal.boundedWorkContractRevision.contract,
        limits: { ...goal.boundedWorkContractRevision.contract.limits, maxExecutionAttempts: 2 },
      },
      adoptedAt: "2026-05-12T18:01:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "revision-2" },
    });
    expect(() => finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
    })).toThrow("stale bounded-work contract revision");
  });

  it("accepts a verified direct managed handoff without inventing managed orchestration policy", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-direct-managed-handoff",
      summary: "Inspect through one governed managed child.",
      workflowProfile: "verification-heavy",
      triggers: ["managed-agents"],
      expectedEvidence: ["surface-map"],
      verificationGates: [],
      assignedAgentProfile: "scout",
    });
    const goal = goalRunStore.create({
      id: "goal-direct-managed-handoff",
      objective: "Adopt a direct managed child result.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-direct-managed-handoff", [item.id], "Adopt a direct managed child result."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only inspection.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const handoff = managedResultHandoff();
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-direct-1",
      managedInvocationProof: {
        invocationId: "invocation-direct-1",
        parentSessionId: "session-1",
        goalRunId: goal.id,
        workItemId: item.id,
        resultHandoff: handoff,
        candidateCaptureRoot: "C:/workspace/kiln/.kiln/managed-worktrees/invocation-direct-1",
      },
    });

    const finished = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["surface-map"],
      managedInvocationResultHandoff: handoff,
    });

    expect(finished).toMatchObject({
      item: {
        status: "completed",
        managedOrchestration: undefined,
        managedOrchestrationResultHandoff: undefined,
      },
      attempt: {
        status: "completed",
        managedInvocationId: "invocation-direct-1",
        managedInvocationResultHandoff: handoff,
        candidateCaptureRoot: "C:/workspace/kiln/.kiln/managed-worktrees/invocation-direct-1",
      },
      goal: { status: "active", currentPhase: "paused:bounded-work-acceptance" },
    });
  });

  it("rejects fabricated managed invocation identifiers at the domain boundary", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-proof",
      summary: "Run a verified managed child.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: [],
      verificationGates: [],
      assignedAgentProfile: "coder",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-proof",
      objective: "Require managed invocation provenance.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed-proof", [item.id], "Require managed invocation provenance."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Read-only delegated inspection.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    });

    expect(() => startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "managed_delegation",
      managedInvocationId: "invented-id",
    })).toThrow("Managed delegation requires verified invocation provenance");

    expect(startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-1",
      managedInvocationProof: {
        invocationId: "invocation-1",
        parentSessionId: "session-1",
        goalRunId: goal.id,
        workItemId: item.id,
        resultHandoff: managedResultHandoff(),
        candidateCaptureRoot: "C:/workspace/kiln/.kiln/managed-worktrees/invocation-1",
      },
    }).attempt.managedInvocationId).toBe("invocation-1");
  });

  it("completes a paused goal after explicit goal-level evidence is recorded", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-goal-closeout",
      summary: "Verify the release.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: [],
    });
    const goal = goalRunStore.create({
      id: "goal-closeout",
      objective: "Close with explicit release evidence.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-closeout", [item.id], "Close with explicit release evidence."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "read_only",
        escalationPolicy: "deny",
        reason: "Verification only.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [
        { id: "release-contract", description: "Release contract verified.", required: true },
      ],
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
      ...candidateBinding(goal, item.id, started.attempt),
    });
    expect(finished.goal.currentPhase).toBe("paused:goal-closeout");
    expect(finished.missingGoalEvidence).toEqual(["release-contract"]);

    goalRunStore.recordEvidence({
      id: goal.id,
      requirementId: "release-contract",
      summary: "Exports and package manifests verified.",
      workItemIds: [item.id],
    });
    expect(completeGoalExecution({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      closeoutSummary: "Release contract and work-item evidence verified.",
      boundedWorkCloseoutDecision: acceptanceDecision(goalRunStore.get(goal.id)!, workItemStore, item.id),
    })).toMatchObject({
      status: "completed",
      closeoutSummary: "Release contract and work-item evidence verified.",
    });
  });

  it("rejects an acceptance decision that is not bound to the persisted attempt evaluation", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-assurance-binding",
      summary: "Verify persisted assurance binding.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: [],
      verificationGates: [],
    });
    const goal = goalRunStore.create({
      id: "goal-assurance-binding",
      objective: "Reject stale assurance decisions.",
      ownerSessionId: "session-1",
      source: { kind: "operator_direct", turnId: "turn-assurance-binding" },
      boundedWorkContractRevision: testBoundedWorkRevision(
        "goal-assurance-binding",
        [item.id],
        "Reject stale assurance decisions.",
      ),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "The acceptance record must bind to the persisted evaluation.",
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
    finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      ...candidateBinding(goal, item.id, started.attempt),
    });

    const valid = acceptanceDecision(goalRunStore.get(goal.id)!, workItemStore, item.id);
    const forgedRecordBody = {
      ...valid.acceptanceDecision,
      assuranceEvaluationDigest: `sha256:${"f".repeat(64)}`,
    };
    const forged = {
      ...valid,
      acceptanceDecision: {
        ...forgedRecordBody,
        decisionDigest: boundedWorkDigest({ ...forgedRecordBody, decisionDigest: undefined }),
      },
    };

    expect(() => completeGoalExecution({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      boundedWorkCloseoutDecision: forged,
    })).toThrow("does not reference a completed execution candidate");
  });

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
      source: { kind: "approved_plan", planId: "plan-1", planHash: "sha256:plan" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-execution", [completed.id, ready.id], "Execute approved plan."),
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

  it("records managed child failure as blocked missing evidence on the execution attempt", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-failure",
      summary: "Execute managed child.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-agent-review", "tests"],
      verificationGates: ["managed child live or simulated evidence"],
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-failure",
      objective: "Record managed child failure.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed-failure", [item.id], "Record managed child failure."),
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
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-failed-1",
      managedInvocationProof: managedProof(goal.id, item.id, "invocation-failed-1"),
    });

    const failed = failGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      failureReason: "timed_out",
      summary: "Managed child timed out before producing handoff evidence.",
    });

    expect(failed).toMatchObject({
      missingEvidence: ["managed-agent-review", "tests"],
      missingGoalEvidence: [],
      goal: {
        status: "active",
        currentPhase: "paused:work-managed-failure",
      },
      item: {
        status: "blocked",
      },
      attempt: {
        status: "failed",
        failureReason: "timed_out",
        summary: "Managed child timed out before producing handoff evidence.",
        missingEvidence: ["managed-agent-review", "tests"],
        managedInvocationId: "invocation-failed-1",
      },
    });
  });

  it("records managed child cancellation as cancelled attempt and blocked work item", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-cancelled",
      summary: "Execute managed child.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: ["managed child live or simulated evidence"],
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-cancelled",
      objective: "Record managed child cancellation.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed-cancelled", [item.id], "Record managed child cancellation."),
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
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-cancelled-1",
      managedInvocationProof: managedProof(goal.id, item.id, "invocation-cancelled-1"),
    });

    const cancelled = failGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      terminalStatus: "cancelled",
      failureReason: "cancelled",
      summary: "Operator cancelled the managed child.",
    });

    expect(cancelled).toMatchObject({
      missingEvidence: ["managed-agent-review"],
      item: {
        status: "blocked",
      },
      attempt: {
        status: "cancelled",
        failureReason: "cancelled",
        summary: "Operator cancelled the managed child.",
      },
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-paused", [blocked.id], "Execute approved plan."),
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-needs-input", [item.id], "Execute approved plan."),
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

  it("represents missing harness capability as an unresolved pause requirement", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-needs-harness-capability",
      summary: "Run delegated review only after a capable route is admitted.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: ["managed-agent review"],
      pauseRequirements: [
        {
          id: "missing-managed-review-route",
          kind: "capability",
          summary: "No admitted managed route can perform delegated review in the active harness.",
          status: "pending",
        },
      ],
    });
    const goal = new GoalRunStore({ now: fixedNow }).create({
      id: "goal-needs-harness-capability",
      objective: "Execute governed review.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-needs-harness-capability", [item.id], "Execute governed review."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
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
          id: "missing-managed-review-route",
          kind: "capability",
          status: "pending",
        },
      ],
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-attempts", [item.id], "Execute approved plan."),
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-skipped-gate", [item.id], "Execute closeout-gated work."),
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
        status: "active",
        currentPhase: "paused:bounded-work-acceptance",
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-gate-results", [item.id], "Execute closeout-gated work."),
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
        status: "active",
        currentPhase: "paused:bounded-work-acceptance",
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-review-gate", [item.id], "Execute risky profile work."),
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
        status: "active",
        currentPhase: "paused:bounded-work-acceptance",
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-browser-gate", [item.id], "Execute UI profile work."),
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
        status: "active",
        currentPhase: "paused:bounded-work-acceptance",
      },
    });
  });

  it("keeps goal-level requirements independent from similarly named work-item evidence", () => {
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-evidence-closeout", [item.id], "Close only with goal-level evidence."),
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
      missingGoalEvidence: ["tests", "typecheck"],
      goal: {
        status: "active",
        currentPhase: "paused:goal-closeout",
      },
      item: {
        status: "completed",
      },
    });
  });

  it("counts structured managed orchestration adoption toward goal closeout evidence", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-adoption-goal",
      summary: "Adopt managed orchestration output.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:adoption-gate",
      ],
      verificationGates: ["managed orchestration adoption gate"],
      managedOrchestration: {
        orchestrationId: "orch-adoption-goal",
        mode: "decomposition",
        childId: "orch-adoption-goal:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
        },
      },
    });
    const goal = goalRunStore.create({
      id: "goal-managed-adoption",
      objective: "Close with managed adoption evidence.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed-adoption", [item.id], "Close with managed adoption evidence."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [
        {
          id: "managed-orchestration:adoption-gate",
          description: "Managed child output adopted.",
          required: true,
        },
      ],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-adoption-goal",
      managedInvocationProof: managedProof(goal.id, item.id, "invocation-adoption-goal"),
    });
    goalRunStore.recordEvidence({
      id: goal.id,
      requirementId: "managed-orchestration:adoption-gate",
      summary: "Reviewer adopted the managed child output.",
      resourceUris: ["kiln://artifacts/orch-adoption-goal/adoption"],
      workItemIds: [item.id],
    });

    const completed = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["managed-orchestration:result-handoff"],
      managedInvocationResultHandoff: {
        provenance: {
          delivery: "remote-harness" as const,
          configuredModelId: "gpt-5.6-sol",
          observedModelIds: ["gpt-5.6-sol"],
        },
        summary: "Completed managed child handoff with reviewable resources.",
        resourceUris: ["kiln://artifacts/orch-adoption-goal/handoff"],
        memoryWriteProposalUris: [] as readonly string[],
      },
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-12T10:30:00.000Z",
        resourceUris: ["kiln://artifacts/orch-adoption-goal/adoption"],
      },
      ...candidateBinding(goal, item.id, started.attempt),
    });

    expect(completed).toMatchObject({
      missingEvidence: [],
      missingGoalEvidence: [],
      goal: {
        status: "active",
        currentPhase: "paused:bounded-work-acceptance",
      },
      item: {
        status: "completed",
        providedEvidence: ["managed-orchestration:result-handoff"],
        managedOrchestrationAdoption: {
          target: "slice-6-handoff-review-adoption",
          adoptedBy: "reviewer",
        },
      },
    });
    const closed = completeGoalExecution({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      boundedWorkCloseoutDecision: acceptanceDecision(goalRunStore.get(goal.id)!, workItemStore, item.id),
    });
    expect(closed.closeoutSummary).toContain(
      "Evidence: managed-orchestration:adoption-gate, managed-orchestration:result-handoff.",
    );
  });

  it("keeps managed orchestration adoption blocked until code-writing readiness gates pass", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-readiness-goal",
      summary: "Adopt managed orchestration output after readiness.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed-orchestration:adoption-gate",
      ],
      verificationGates: [
        "managed orchestration diff evidence",
        "managed orchestration verification",
        "managed orchestration review",
        "managed orchestration adoption gate",
      ],
      managedOrchestration: {
        orchestrationId: "orch-readiness-goal",
        mode: "decomposition",
        childId: "orch-readiness-goal:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
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
    const goal = goalRunStore.create({
      id: "goal-managed-readiness",
      objective: "Close only after adoption readiness.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-managed-readiness", [item.id], "Close only after adoption readiness."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [
        {
          id: "managed-orchestration:adoption-gate",
          description: "Managed child output adopted.",
          required: true,
        },
      ],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      executionMode: "managed_delegation",
      managedInvocationId: "invocation-readiness-goal",
      managedInvocationProof: managedProof(goal.id, item.id, "invocation-readiness-goal"),
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
      ],
      verificationGateResults: [
        {
          gate: "managed orchestration diff evidence",
          status: "passed",
        },
        {
          gate: "managed orchestration verification",
          status: "skipped",
          summary: "Skipped verification is not adoption readiness.",
        },
        {
          gate: "managed orchestration review",
          status: "passed",
        },
        {
          gate: "managed orchestration adoption gate",
          status: "passed",
        },
      ],
      managedInvocationResultHandoff: {
        provenance: {
          delivery: "remote-harness",
          configuredModelId: "gpt-5.6-sol",
          observedModelIds: ["gpt-5.6-sol"],
        },
        summary: "Completed managed child handoff with reviewable resources.",
        resourceUris: ["kiln://artifacts/orch-readiness-goal/handoff"],
        memoryWriteProposalUris: [],
      },
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-12T10:30:00.000Z",
        resourceUris: ["kiln://artifacts/orch-readiness-goal/adoption"],
      },
    });

    expect(blocked).toMatchObject({
      missingEvidence: ["managed-orchestration:adoption-gate"],
      missingVerificationGates: ["managed orchestration verification"],
      missingGoalEvidence: [],
      goal: {
        status: "active",
        currentPhase: `paused:${item.id}`,
      },
      item: {
        status: "blocked",
      },
    });
    expect(projectManagedOrchestrationAdoptionGate(blocked.item)).toMatchObject({
      required: true,
      status: "blocked",
      blockingEvidence: [
        "managed orchestration verification",
        "managed-orchestration:adoption-gate",
      ],
    });
  });

  it("derives managed orchestration readiness from merge policy in direct core state", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-readiness-policy",
      summary: "Adopt managed orchestration output from policy.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:adoption-gate"],
      verificationGates: ["managed orchestration adoption gate"],
      managedOrchestration: {
        orchestrationId: "orch-readiness-policy",
        mode: "decomposition",
        childId: "orch-readiness-policy:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
          adoptionReadinessRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
        },
      },
    });

    expect(item.managedOrchestration?.adoptionGate.readiness).toMatchObject({
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
    });
    expect(projectManagedOrchestrationAdoptionGate(item)).toMatchObject({
      required: true,
      status: "pending_review",
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
    expect(() => workItemStore.upsert({
      ...item,
      id: "work-managed-readiness-disabled",
      managedOrchestration: {
        ...item.managedOrchestration!,
        adoptionGate: {
          ...item.managedOrchestration!.adoptionGate,
          readiness: {
            required: false,
            evidence: [],
            verificationGates: [],
          },
        },
      },
    })).toThrow("Managed orchestration adoption readiness cannot be disabled when merge policy requires it.");
    expect(() => workItemStore.upsert({
      ...item,
      id: "work-managed-readiness-weakened",
      managedOrchestration: {
        ...item.managedOrchestration!,
        adoptionGate: {
          ...item.managedOrchestration!.adoptionGate,
          readiness: {
            required: true,
            evidence: ["managed-orchestration:diff"],
            verificationGates: ["managed orchestration diff evidence"],
          },
        },
      },
    })).toThrow("Managed orchestration adoption readiness must match the canonical readiness contract.");
  });

  it("keeps failed managed orchestration readiness gates visible in adoption blockers", () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-readiness-failed",
      summary: "Reject managed orchestration output after failed readiness.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: [
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed-orchestration:adoption-gate",
      ],
      providedEvidence: [
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
      verificationGateResults: [
        { gate: "managed orchestration diff evidence", status: "passed" },
        { gate: "managed orchestration verification", status: "failed", summary: "Verification failed." },
        { gate: "managed orchestration review", status: "passed" },
        { gate: "managed orchestration adoption gate", status: "passed" },
      ],
      managedOrchestration: {
        orchestrationId: "orch-readiness-failed",
        mode: "decomposition",
        childId: "orch-readiness-failed:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
          adoptionReadinessRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
        },
      },
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-12T10:30:00.000Z",
        resourceUris: ["kiln://artifacts/orch-readiness-failed/adoption"],
      },
    });

    expect(projectManagedOrchestrationAdoptionGate(item)).toMatchObject({
      required: true,
      status: "rejected",
      rejection: {
        gate: "managed orchestration verification",
        summary: "Verification failed.",
      },
      blockingEvidence: [
        "managed orchestration verification",
        "managed-orchestration:adoption-gate",
      ],
    });
  });

  it("ignores raw managed orchestration adoption evidence at goal closeout without structured adoption", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-raw-adoption-goal",
      summary: "Attempt raw adoption evidence.",
      status: "completed",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:adoption-gate"],
      providedEvidence: ["managed-orchestration:adoption-gate"],
      verificationGates: ["managed orchestration adoption gate"],
      managedOrchestration: {
        orchestrationId: "orch-raw-adoption-goal",
        mode: "decomposition",
        childId: "orch-raw-adoption-goal:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
        },
      },
    });
    const goal = goalRunStore.create({
      id: "goal-raw-adoption",
      objective: "Do not close with raw adoption evidence.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-raw-adoption", [item.id, "work-trigger-closeout"], "Do not close with raw adoption evidence."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [
        {
          id: "managed-orchestration:adoption-gate",
          description: "Managed child output adopted.",
          required: true,
        },
      ],
    });
    const second = workItemStore.upsert({
      id: "work-trigger-closeout",
      summary: "Trigger closeout.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    const goalWithSecondItem = goalRunStore.attachWorkItems({
      id: goal.id,
      workItemIds: [second.id],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goalWithSecondItem.id,
      workItemId: second.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goalWithSecondItem.id,
      workItemId: second.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
    });

    expect(blocked).toMatchObject({
      missingGoalEvidence: ["managed-orchestration:adoption-gate"],
      goal: {
        status: "active",
        currentPhase: "paused:goal-closeout",
      },
    });
  });

  it("ignores raw managed orchestration result handoff evidence at goal closeout without structured handoff", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-raw-handoff-goal",
      summary: "Attempt raw managed handoff evidence.",
      status: "completed",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:result-handoff"],
      providedEvidence: ["managed-orchestration:result-handoff"],
      verificationGates: ["managed orchestration child handoff"],
      managedOrchestration: {
        orchestrationId: "orch-raw-handoff-goal",
        mode: "decomposition",
        childId: "orch-raw-handoff-goal:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: false,
        },
        adoptionGate: {
          required: false,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption not required.",
        },
      },
    });
    const goal = goalRunStore.create({
      id: "goal-raw-handoff",
      objective: "Do not close with raw handoff evidence.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-raw-handoff", [item.id, "work-trigger-handoff-closeout"], "Do not close with raw handoff evidence."),
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [
        {
          id: "managed-orchestration:result-handoff",
          description: "Managed child returned structured handoff.",
          required: true,
        },
      ],
    });
    const second = workItemStore.upsert({
      id: "work-trigger-handoff-closeout",
      summary: "Trigger closeout.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    const goalWithSecondItem = goalRunStore.attachWorkItems({
      id: goal.id,
      workItemIds: [second.id],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goalWithSecondItem.id,
      workItemId: second.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goalWithSecondItem.id,
      workItemId: second.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
    });

    expect(blocked).toMatchObject({
      missingGoalEvidence: ["managed-orchestration:result-handoff"],
      goal: {
        status: "active",
        currentPhase: "paused:goal-closeout",
      },
    });
  });

  it("normalizes managed orchestration result handoff policy into required work item evidence", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-policy-handoff-goal",
      summary: "Require handoff from managed policy only.",
      status: "completed",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: [],
      providedEvidence: [],
      verificationGates: ["managed orchestration child handoff"],
      managedOrchestration: {
        orchestrationId: "orch-policy-handoff-goal",
        mode: "decomposition",
        childId: "orch-policy-handoff-goal:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: false,
        },
        adoptionGate: {
          required: false,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption not required for this child.",
        },
      },
    });
    expect(item.expectedEvidence).toEqual(["managed-orchestration:result-handoff"]);
    const second = workItemStore.upsert({
      id: "work-policy-handoff-closeout",
      summary: "Trigger goal closeout.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    const goal = goalRunStore.create({
      id: "goal-policy-handoff",
      objective: "Do not close without policy-required managed handoff.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-policy-handoff", [item.id, second.id], "Do not close without policy-required managed handoff."),
      workItemIds: [item.id, second.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [{
        id: "managed-orchestration:result-handoff",
        description: "Structured child result handoff.",
        required: true,
      }],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: second.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: second.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
    });

    expect(blocked.missingGoalEvidence).toEqual(["managed-orchestration:result-handoff"]);
  });

  it("blocks goal closeout when managed orchestration adoption review failed despite structured adoption", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const adoptedButRejected = workItemStore.upsert({
      id: "work-rejected-adoption-goal",
      summary: "Reject managed orchestration adoption.",
      status: "completed",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:adoption-gate"],
      providedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:adoption-gate",
      ],
      verificationGates: ["managed orchestration adoption gate"],
      verificationGateResults: [{
        gate: "managed orchestration adoption gate",
        status: "failed",
        summary: "Reviewer rejected the handoff.",
        evidence: ["kiln://artifacts/orch-rejected-adoption/review"],
        completedAt: "2026-05-12T10:45:00.000Z",
      }],
      managedOrchestration: {
        orchestrationId: "orch-rejected-adoption",
        mode: "decomposition",
        childId: "orch-rejected-adoption:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
        },
      },
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-12T10:30:00.000Z",
        resourceUris: ["kiln://artifacts/orch-rejected-adoption/adoption"],
      },
    });
    const second = workItemStore.upsert({
      id: "work-rejected-adoption-trigger",
      summary: "Trigger closeout after rejected adoption.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
    });
    const goal = goalRunStore.create({
      id: "goal-rejected-adoption",
      objective: "Do not close with rejected adoption.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-rejected-adoption", [adoptedButRejected.id, second.id], "Do not close with rejected adoption."),
      workItemIds: [adoptedButRejected.id, second.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [
        {
          id: "managed-orchestration:adoption-gate",
          description: "Managed child output adopted.",
          required: true,
        },
      ],
    });
    const started = startGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: second.id,
      executionMode: "direct",
    });

    const blocked = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: second.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests"],
    });

    expect(blocked).toMatchObject({
      missingGoalEvidence: ["managed-orchestration:adoption-gate"],
      goal: {
        status: "active",
        currentPhase: "paused:goal-closeout",
      },
    });
  });

  it("drops replayed work items with malformed managed orchestration closeout evidence", () => {
    const replayStore = new WorkItemStore({ now: fixedNow });
    const valid = replayStore.upsert({
      id: "work-replayed-adoption",
      summary: "Replay malformed adoption.",
      status: "completed",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:adoption-gate"],
      providedEvidence: ["managed-orchestration:adoption-gate"],
      verificationGates: ["managed orchestration adoption gate"],
      managedOrchestration: {
        orchestrationId: "orch-replayed-adoption",
        mode: "decomposition",
        childId: "orch-replayed-adoption:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [
          {
            kind: "result-handoff",
            label: "bounded child result handoff",
            required: true,
          },
        ],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required before closeout.",
        },
      },
    });
    const adoptedItem: typeof valid = {
      ...valid,
      managedOrchestrationAdoption: {
        target: "slice-6-handoff-review-adoption",
        adoptedBy: "reviewer",
        adoptedAt: "2026-05-12T10:30:00.000Z",
        resourceUris: [],
      },
    };
    const replayedMalformedAdoption = reconstructWorkItemsFromSessionEvents([
      createSessionEvent<"work_item_updated">({
        kind: "work_item_updated",
        kilnSessionId: "test-session",
        sequence: 1,
        workItem: adoptedItem,
        operation: "update",
      }),
    ]);
    const replayedMalformedHandoff = reconstructWorkItemsFromSessionEvents([
      createSessionEvent<"work_item_updated">({
        kind: "work_item_updated",
        kilnSessionId: "test-session",
        sequence: 2,
        workItem: {
          ...valid,
          managedOrchestrationResultHandoff: {
            orchestrationId: "orch-replayed-adoption",
            childId: "orch-replayed-adoption:child:1",
            workItemId: "other-work-item",
            summary: "Completed child work with reviewable resources.",
            completedAt: "2026-05-12T10:30:00.000Z",
            resourceUris: ["kiln://artifacts/orch-replayed-adoption/handoff"],
          },
        },
        operation: "update",
      }),
    ]);

    expect(replayedMalformedAdoption.items).toEqual([]);
    expect(replayedMalformedHandoff.items).toEqual([]);
  });

  it("generates goal closeout summary from linked work item evidence", () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-closeout-summary",
      summary: "Verify generated closeout summary.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck"],
      verificationGates: ["bun test", "bun run typecheck"],
    });
    const goal = goalRunStore.create({
      id: "goal-closeout-summary",
      objective: "Generate closeout from evidence.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-closeout-summary", [item.id], "Generate closeout from evidence."),
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

    const completed = finishGoalExecutionAttempt({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
      providedEvidence: ["tests", "typecheck"],
      verificationGateResults: [
        { gate: "bun test", status: "passed", summary: "Focused tests passed." },
        { gate: "bun run typecheck", status: "passed", summary: "Typecheck passed." },
      ],
      ...candidateBinding(goal, item.id, started.attempt),
    });

    expect(completed.goal).toMatchObject({
      status: "active",
      currentPhase: "paused:bounded-work-acceptance",
    });
    const closed = completeGoalExecution({
      goalRunStore,
      workItemStore,
      goalRunId: goal.id,
      boundedWorkCloseoutDecision: acceptanceDecision(goalRunStore.get(goal.id)!, workItemStore, item.id),
    });
    expect(closed).toMatchObject({
      status: "completed",
      closeoutSummary: [
        "Goal goal-closeout-summary completed from canonical evidence.",
        "Work items: work-closeout-summary.",
        "Evidence: tests, typecheck.",
        "Passed gates: bun test, bun run typecheck.",
        "Skipped gates: none.",
        "Residual risk: none recorded.",
      ].join("\n"),
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
      source: { kind: "approved_plan", planId: "plan-1" },
      boundedWorkContractRevision: testBoundedWorkRevision("goal-replay", [item.id], "Replay execution."),
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
      createSessionEvent<"work_item_execution_started">({
        kind: "work_item_execution_started",
        kilnSessionId: "test-session",
        sequence: 3,
        workItem: started.item,
        attempt: started.attempt,
      }),
      createSessionEvent<"work_item_execution_finished">({
        kind: "work_item_execution_finished",
        kilnSessionId: "test-session",
        sequence: 4,
        workItem: finished.item,
        attempt: finished.attempt,
        missingEvidence: [] as readonly string[],
        missingGoalEvidence: [] as readonly string[],
        missingVerificationGates: [] as readonly string[],
        failedVerificationGates: [] as readonly string[],
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

function managedProof(goalRunId: string, workItemId: string, invocationId: string) {
  return {
    invocationId,
    parentSessionId: "session-1",
    goalRunId,
    workItemId,
    resultHandoff: managedResultHandoff(),
    candidateCaptureRoot: `C:/workspace/kiln/.kiln/managed-worktrees/${invocationId}`,
  };
}

function candidateBinding(goal: GoalRun, workItemId: string, attempt: WorkItemExecutionAttempt) {
  const candidate = createBoundedWorkCandidate({
    goalRunId: goal.id,
    workItemId,
    contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
    accountingLineageId: goal.id,
    kind: "git_worktree",
    baseline: { kind: "git_tree", digest: `sha256:${"a".repeat(64)}` },
    candidateContentDigest: `sha256:${"b".repeat(64)}`,
    createdAt: attempt.startedAt,
  });
  const subjects = [{ path: "src/Test.dfy", contentDigest: `sha256:${"e".repeat(64)}` }];
  const candidateEvidence = [createBoundedWorkCandidateEvidence({
      candidate,
      executionAttempt: {
        goalRunId: attempt.goalRunId,
        workItemId: attempt.workItemId,
        attemptId: attempt.id,
        ...(Object.prototype.hasOwnProperty.call(attempt, "managedInvocationId")
          ? { managedInvocationId: attempt.managedInvocationId }
          : {}),
      },
      invocation: { toolCallScopeId: "scope-1", toolCallId: "call-1" },
      attestation: {
        producer: { kind: "registered_tool", toolName: "formal_verify" },
        payload: formalVerificationToolMetadata({
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: `sha256:${"c".repeat(64)}` },
          subjects,
          checks: [{ symbol: "Test.Main", check: "correctness", outcome: "proved" }],
        }),
      },
      recordedAt: attempt.startedAt,
    })];
  const assuranceEvaluation = evaluateBoundedWorkAssurance({
    revision: goal.boundedWorkContractRevision,
    candidate,
    candidateSubjects: {
      candidateContentDigest: candidate.candidateContentDigest,
      digests: new Map(subjects.map((subject) => [subject.path, subject.contentDigest])),
    },
    candidateEvidence,
    evaluatedAt: attempt.startedAt,
  });
  return {
    candidate,
    candidateEvidence,
    assuranceEvaluation,
  };
}

function acceptanceDecision(
  goal: GoalRun,
  workItemStore: WorkItemStore,
  workItemId: string,
): Extract<BoundedWorkCloseoutDecision, { readonly kind: "stop_acceptance_complete" }> {
  const attempt = workItemStore.get(workItemId)?.executionAttempts.at(-1);
  const candidate = attempt?.candidate;
  if (!candidate || !attempt?.candidateEvidence || !attempt.assuranceEvaluation) {
    throw new Error("test candidate assurance is required");
  }
  const decision = decideBoundedWorkCloseout({
    revision: goal.boundedWorkContractRevision,
    candidateDigest: candidate.candidateDigest,
    candidateEvidence: attempt.candidateEvidence,
    assuranceEvaluation: attempt.assuranceEvaluation,
    decidedAt: fixedNow(),
    snapshot: {
      schema: "kiln.bounded-work-accounting/v1" as const,
      accountingLineageId: goal.id,
      contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      revision: 1,
      executionAttempts: 1,
      managedInvocations: 0,
      activeManagedInvocations: 0,
      reviewRounds: 0,
      remediationRounds: 0,
      toolCalls: { kind: "unavailable" as const },
      activeDurationMs: { kind: "unavailable" as const },
    },
  });
  if (decision.kind !== "stop_acceptance_complete") {
    throw new Error(`test closeout did not establish all acceptance criteria: ${decision.missingCriteria.join(", ")}`);
  }
  return decision;
}

function managedResultHandoff() {
  return {
    provenance: {
      delivery: "remote-harness" as const,
      configuredModelId: "gpt-5.6-sol",
      observedModelIds: ["gpt-5.6-sol"],
    },
    summary: "Managed child returned substantive evidence.",
    resourceUris: ["kiln://artifacts/managed-child/handoff"],
    memoryWriteProposalUris: [] as readonly string[],
  };
}
