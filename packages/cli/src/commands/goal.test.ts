import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GoalRun, PlanSubmissionInput, WorkItem } from "@kilnai/core";
import { PlanStateStore } from "@kilnai/core";
import { goalCommand, loadGoalSnapshotFromTranscript } from "./goal.js";
import { TranscriptStore } from "../wrapper/session-store.js";

const roots: string[] = [];

describe("goal command", () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("replays persisted canonical goal events from the transcript store", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));

    const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, "session-1");

    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.goals[0]).toMatchObject({
      id: "goal-1",
      objective: "Finish Slice 10 CLI goal commands.",
      status: "active",
      planId: "plan-1",
    });
  });

  it("lists and inspects goals from canonical session events", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await goalCommand({ createRegistry: (() => undefined) as never }, "list", ["--session", "session-1"], { projectPath: root });
    await goalCommand({ createRegistry: (() => undefined) as never }, "inspect", ["goal-1", "--session", "session-1"], { projectPath: root });

    expect(log.mock.calls[0]?.[0]).toContain("goal-1");
    expect(log.mock.calls[0]?.[0]).toContain("active");
    expect(log.mock.calls[1]?.[0]).toContain("Objective: Finish Slice 10 CLI goal commands.");
    expect(log.mock.calls[1]?.[0]).toContain("Authority: audited");
  });

  it("cancels an active goal by appending a canonical cancellation event", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await goalCommand(
      { createRegistry: (() => undefined) as never },
      "cancel",
      ["goal-1", "--session", "session-1", "--reason", "Operator stopped this goal.", "--cancelled-by", "alex"],
      {
        projectPath: root,
        now: () => new Date("2026-05-12T22:00:00.000Z"),
        eventId: () => "event-goal-cancelled",
      },
    );

    const snapshot = await loadGoalSnapshotFromTranscript(transcriptStore, "session-1");
    expect(snapshot.goals).toHaveLength(1);
    expect(snapshot.goals[0]).toMatchObject({
      id: "goal-1",
      status: "cancelled",
      terminalReason: "Operator stopped this goal. (alex)",
      updatedAt: "2026-05-12T22:00:00.000Z",
    });
  });

  it("resumes a goal by reporting the next canonical execution step", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    await appendGoalCreated(transcriptStore, "session-1", makeGoal({ id: "goal-1" }));
    await appendWorkItemUpdated(transcriptStore, "session-1", makeWorkItem({ id: "work-1" }));
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await goalCommand({ createRegistry: (() => undefined) as never }, "resume", ["goal-1", "--session", "session-1"], { projectPath: root });

    expect(log.mock.calls[0]?.[0]).toContain("Goal goal-1 is ready to resume.");
    expect(log.mock.calls[0]?.[0]).toContain("Next work item: work-1");
    expect(log.mock.calls[0]?.[0]).toContain("Execution mode: managed_delegation");
    expect(log.mock.calls[0]?.[0]).toContain("Required evidence: tests");
  });

  it("approves a submitted plan by appending a canonical plan approval event", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    const planStateStore = new PlanStateStore({ now: () => Date.parse("2026-05-12T21:00:00.000Z") });
    const plan = planStateStore.submitPlan(makePlanSubmissionInput({ planId: "plan-1" }));
    await appendPlanSubmitted(transcriptStore, "session-1", plan);
    await appendPlanAnalysisReady(transcriptStore, "session-1", {
      sequence: 2,
      planId: plan.id,
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    await goalCommand(
      { createRegistry: (() => undefined) as never },
      "approve-plan",
      ["plan-1", "--session", "session-1", "--approved-by", "alex"],
      {
        projectPath: root,
        now: () => new Date("2026-05-12T22:00:00.000Z"),
        eventId: () => "event-plan-approved",
      },
    );

    const transcript = await transcriptStore.readTranscript("session-1");
    expect(transcript.at(-1)).toMatchObject({
      eventId: "event-plan-approved",
      kilnSessionId: "session-1",
      sequence: 3,
      timestamp: "2026-05-12T22:00:00.000Z",
      kind: "plan_approved",
      payload: {
        planId: "plan-1",
        approvalId: "approval_1",
        planHash: plan.contentHash,
        approvedBy: "alex",
        approvedAt: "2026-05-12T22:00:00.000Z",
        residualRiskAcknowledged: false,
        fromMode: "plan",
        toMode: "execute",
      },
    });
  });

  it("blocks plan approval when the latest analysis report has blocking findings", async () => {
    const root = await tempRoot();
    const transcriptStore = new TranscriptStore(root);
    const planStateStore = new PlanStateStore({ now: () => Date.parse("2026-05-12T21:00:00.000Z") });
    const plan = planStateStore.submitPlan(makePlanSubmissionInput({ planId: "plan-1" }));
    await appendPlanSubmitted(transcriptStore, "session-1", plan);
    await appendPlanAnalysisBlocked(transcriptStore, "session-1", {
      sequence: 2,
      planId: plan.id,
    });

    await expect(goalCommand(
      { createRegistry: (() => undefined) as never },
      "approve-plan",
      ["plan-1", "--session", "session-1"],
      { projectPath: root },
    )).rejects.toThrow("cannot be approved while blocking analysis findings remain open");
  });
});

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-goal-command-"));
  roots.push(root);
  return root;
}

async function appendGoalCreated(
  transcriptStore: TranscriptStore,
  sessionId: string,
  goal: GoalRun,
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: `event-${goal.id}`,
    kilnSessionId: sessionId,
    sequence: goal.sequence,
    timestamp: goal.createdAt,
    kind: "goal.created",
    source: { actor: "runtime", surface: "cli", component: "goal-command-test" },
    payload: { goal },
  });
}

async function appendWorkItemUpdated(
  transcriptStore: TranscriptStore,
  sessionId: string,
  workItem: WorkItem,
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: `event-${workItem.id}`,
    kilnSessionId: sessionId,
    sequence: workItem.sequence,
    timestamp: workItem.createdAt,
    kind: "work_item_updated",
    source: { actor: "runtime", surface: "cli", component: "goal-command-test" },
    payload: {
      workItem,
      operation: "update",
    },
  });
}

async function appendPlanSubmitted(
  transcriptStore: TranscriptStore,
  sessionId: string,
  plan: ReturnType<PlanStateStore["submitPlan"]>,
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: `event-${plan.id}`,
    kilnSessionId: sessionId,
    sequence: plan.sequence,
    timestamp: plan.createdAt,
    kind: "plan_submitted",
    source: { actor: "runtime", surface: "cli", component: "goal-command-test" },
    payload: {
      planId: plan.id,
      planHash: plan.contentHash,
      mode: "plan",
      objective: plan.objective,
      nonGoals: plan.nonGoals,
      operatorDecisionsRequired: plan.operatorDecisionsRequired,
      assumptions: plan.assumptions,
      affectedSurfaces: plan.affectedSurfaces,
      riskClassification: plan.riskClassification,
      workflowProfile: plan.workGovernanceRecommendation.workflowProfile,
      workGovernancePosture: plan.workGovernanceRecommendation.posture,
      workGovernanceRationale: plan.workGovernanceRecommendation.rationale,
      expectedEvidence: plan.expectedEvidence,
      verificationGates: plan.verificationGates,
      managedAgentDelegationCandidates: plan.managedAgentDelegationCandidates,
      approvalBoundaries: plan.approvalBoundaries,
      rollbackNotes: plan.rollbackNotes,
      residualRisks: plan.residualRisks,
      sourceSpecificationId: plan.sourceSpecificationId,
      clarificationRecordIds: plan.clarificationRecordIds,
      constitutionSnapshotHash: plan.constitutionSnapshot.instructionProfileHash,
      constitutionSnapshotIds: plan.constitutionSnapshot.instructionProfileIds,
      proposedWorkItemCount: plan.proposedWorkItems.length,
      proposedWorkItems: plan.proposedWorkItems,
      summary: plan.objective,
    },
  });
}

async function appendPlanAnalysisReady(
  transcriptStore: TranscriptStore,
  sessionId: string,
  input: { readonly sequence: number; readonly planId: string },
): Promise<void> {
  await appendPlanAnalysis(transcriptStore, sessionId, {
    ...input,
    status: "ready",
    blockingFindingIds: [],
  });
}

async function appendPlanAnalysisBlocked(
  transcriptStore: TranscriptStore,
  sessionId: string,
  input: { readonly sequence: number; readonly planId: string },
): Promise<void> {
  await appendPlanAnalysis(transcriptStore, sessionId, {
    ...input,
    status: "blocked",
    blockingFindingIds: ["finding-1"],
  });
}

async function appendPlanAnalysis(
  transcriptStore: TranscriptStore,
  sessionId: string,
  input: {
    readonly sequence: number;
    readonly planId: string;
    readonly status: "ready" | "blocked";
    readonly blockingFindingIds: readonly string[];
  },
): Promise<void> {
  await transcriptStore.append(sessionId, {
    eventId: `event-analysis-${input.sequence}`,
    kilnSessionId: sessionId,
    sequence: input.sequence,
    timestamp: "2026-05-12T21:01:00.000Z",
    kind: "plan_analysis_reported",
    source: { actor: "runtime", surface: "cli", component: "goal-command-test" },
    payload: {
      reportId: `analysis-${input.sequence}`,
      planId: input.planId,
      specificationId: "spec-1",
      status: input.status,
      highestSeverity: input.status === "blocked" ? "critical" : "none",
      findingIds: input.blockingFindingIds,
      blockingFindingIds: input.blockingFindingIds,
      findingCount: input.blockingFindingIds.length,
      findings: [],
      summary: input.status === "blocked" ? "Blocked." : "Ready.",
    },
  });
}

function makeGoal(input: { readonly id: string }): GoalRun {
  return {
    id: input.id,
    objective: "Finish Slice 10 CLI goal commands.",
    ownerSessionId: "session-1",
    planId: "plan-1",
    planHash: "sha256:plan",
    status: "active",
    workItemIds: ["work-1"],
    authorityEnvelope: {
      maximumAuthority: "audited",
      escalationPolicy: "approval_required",
      reason: "Approved plan.",
    },
    routePolicy: {
      workflowProfile: "cli-change",
      preferredRouteId: "codex",
      managedAgentProfile: "coder",
    },
    evidenceRequirements: [
      {
        id: "tests",
        description: "Focused tests pass.",
        required: true,
      },
    ],
    currentPhase: "ready",
    createdAt: "2026-05-12T21:00:00.000Z",
    updatedAt: "2026-05-12T21:00:00.000Z",
    sequence: 1,
  };
}

function makeWorkItem(input: { readonly id: string }): WorkItem {
  return {
    id: input.id,
    summary: "Implement CLI goal resume.",
    status: "pending",
    workflowProfile: "cli-change",
    risk: "medium",
    triggers: ["cross-surface"],
    surface: "cli",
    assignedAgentProfile: "coder",
    routeId: "codex",
    authorityProfile: "foundation-propose-writes",
    expectedEvidence: ["tests"],
    providedEvidence: [],
    verificationGates: ["bun run --filter @kilnai/cli test"],
    skippedVerificationGates: [],
    verificationGateResults: [],
    dependencies: [],
    goalRunId: "goal-1",
    executionAttempts: [],
    createdAt: "2026-05-12T21:01:00.000Z",
    updatedAt: "2026-05-12T21:01:00.000Z",
    sequence: 2,
  };
}

function makePlanSubmissionInput(input: { readonly planId: string }): PlanSubmissionInput {
  return {
    planId: input.planId,
    objective: "Finish Slice 10 CLI goal commands.",
    nonGoals: ["Do not implement SDK snapshots."],
    operatorDecisionsRequired: [],
    assumptions: ["Transcript contains the submitted plan."],
    affectedSurfaces: ["cli"],
    riskClassification: "medium",
    workGovernanceRecommendation: {
      posture: "orchestrate",
      rationale: "CLI workflow surface work.",
      workflowProfile: "ui-change",
    },
    proposedWorkItems: [
      {
        id: "work-1",
        summary: "Implement CLI plan approval.",
        workflowProfile: "ui-change",
        risk: "medium",
        expectedEvidence: ["tests"],
        verificationGates: ["bun run --filter @kilnai/cli test"],
        dependencies: [],
      },
    ],
    expectedEvidence: ["tests"],
    verificationGates: ["bun run --filter @kilnai/cli test"],
    managedAgentDelegationCandidates: [],
    approvalBoundaries: ["Approval only after analysis is ready."],
    rollbackNotes: "Remove appended approval event before execution if needed.",
    residualRisks: [],
    sourceSpecificationId: "spec-1",
    clarificationRecordIds: [],
    constitutionSnapshot: {
      instructionProfileHash: "sha256:constitution",
      instructionProfileIds: ["sequel-engineering"],
    },
  };
}
