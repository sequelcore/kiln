import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  adoptBoundedWorkContractRevision,
  createBoundedWorkCandidate,
  MANAGED_ORCHESTRATION_REVIEW_GATE,
  startGoalExecutionAttempt,
  GoalRunStore,
  WorkItemStore,
} from "@kilnai/core/work-governance";
import {
  FORMAL_VERIFICATION_FINISH_TRANSPORT,
  DevToolRegistry,
  formalVerificationToolMetadata,
  type DevTool,
} from "@kilnai/core/tools";
import {
  RuntimeSession,
  type RuntimeBuiltinToolExecutionContext,
} from "@kilnai/runtime";
import { createAttachedRuntimeBuiltinToolSurface } from "../../../runtime/src/gateway/attached-runtime-tool-surface.js";
import { collectRuntimeFormalVerificationObservations } from "../../../runtime/src/work-governance/formal-verification-observations.js";
import { createProjectBoundedWorkAuthority } from "./bounded-work-authority-composition.js";
import { createWorkGovernanceTools } from "./work-governance-tool.js";

const { captureCandidate, resolveSubjects } = vi.hoisted(() => ({
  captureCandidate: vi.fn(),
  resolveSubjects: vi.fn(),
}));
const SUBJECT_PATH = "packages/cli/src/application/work-governance-tool.ts";

vi.mock("@kilnai/runtime", async () => {
  const actual = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
  const invocationState = await import("../../../runtime/src/work-governance/formal-verification-invocation-state.js");
  return {
    ...actual,
    captureGitWorktreeCandidate: captureCandidate,
    resolveCandidateSubjectDigests: resolveSubjects,
    isRuntimeOwnedFormalVerificationFinishInvocation: invocationState.isRuntimeOwnedFormalVerificationFinishInvocation,
    readRuntimeFormalVerificationFinishTransport: invocationState.readRuntimeFormalVerificationFinishTransport,
  };
});

describe("bounded-work authority composition", () => {
  const roots: string[] = [];

  beforeEach(() => {
    resolveSubjects.mockImplementation(async ({ candidate }: { readonly candidate: { readonly candidateContentDigest: string } }) => ({
      candidateContentDigest: candidate.candidateContentDigest,
      digests: new Map([[SUBJECT_PATH, digest("subject")]]),
    }));
  });

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    captureCandidate.mockReset();
    resolveSubjects.mockReset();
  });

  it("defaults formal verification capability to unavailable without consuming accounting, and accepts an explicit available observation", () => {
    const unavailableRoot = mkdtempSync(join(tmpdir(), "kiln-bounded-work-capability-unavailable-"));
    const availableRoot = mkdtempSync(join(tmpdir(), "kiln-bounded-work-capability-available-"));
    roots.push(unavailableRoot, availableRoot);
    const revision = boundedWorkRevision("goal-capability", ["work-capability"]);
    const request = {
      projectRuntimeId: "project:capability",
      goalRunId: "goal-capability",
      workItemId: "work-capability",
      contractRevision: revision,
      idempotencyKey: "attempt-capability",
      route: { routeId: "kiln-test", harnessId: "kiln-runtime" },
      harnessCapability: "authoritative" as const,
      reservation: { kind: "execution_attempt" as const, amount: 1 },
    };

    const unavailable = createProjectBoundedWorkAuthority(unavailableRoot);
    const blocked = unavailable.surface.authority.reserve(request);
    expect(blocked.decision).toMatchObject({
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["formal_verification"],
    });
    expect(blocked.accounting).toMatchObject({ revision: 0, executionAttempts: 0 });
    unavailable.close();

    const available = createProjectBoundedWorkAuthority(availableRoot, {
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    expect(available.surface.authority.reserve(request).decision.kind).toBe("admitted");
    available.close();
  });

  it("rejects a caller-fabricated transport before candidate capture", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-bounded-work-composition-"));
    roots.push(root);
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-composition",
      summary: "Capture verifier observations.",
      workflowProfile: "verification-heavy",
      triggers: ["formal-proof-candidate"],
      expectedEvidence: ["formal-proof"],
      verificationGates: [],
      goalRunId: "goal-composition",
    });
    const goal = goalRunStore.create({
      id: "goal-composition",
      objective: "Capture verifier observations.",
      ownerSessionId: "session-1",
      source: { kind: "approved_plan", planId: "plan-composition" },
      boundedWorkContractRevision: boundedWorkRevision(goalId, [item.id]),
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
    const candidate = createBoundedWorkCandidate({
      goalRunId: goal.id,
      workItemId: item.id,
      contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      accountingLineageId: goal.boundedWorkContractRevision.accountingLineageId,
      kind: "git_worktree",
      baseline: { kind: "git_tree", digest: digest("a") },
      candidateContentDigest: digest("b"),
      createdAt: started.attempt.startedAt,
    });
    captureCandidate.mockResolvedValue({
      status: "captured",
      candidate,
      snapshot: {
        verification: "double_observed_git_tree",
        baselineTreeObjectId: "baseline-tree",
        candidateTreeObjectId: "candidate-tree",
        changedFiles: 1,
        changedPaths: ["packages/cli/src/application/work-governance-tool.ts"],
        changedLines: { kind: "observed", value: 2 },
      },
    });
    const authority = createProjectBoundedWorkAuthority(root, {
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    try {
      const transport = formalFinishTransport(goal.id, item.id, started.attempt.id);
      const captured = await authority.closeoutCandidate({
        goal,
        workItem: item,
        attempt: started.attempt,
        providedEvidence: [],
        verificationGateResults: [],
        [FORMAL_VERIFICATION_FINISH_TRANSPORT]: transport,
      });

      expect(captured).toMatchObject({
        captured: false,
        code: "formal_verification_transport_untrusted",
      });
      expect(captureCandidate).not.toHaveBeenCalled();

      const labelsOnly = await authority.closeoutCandidate({
        goal,
        workItem: item,
        attempt: started.attempt,
        providedEvidence: ["formal-proof"],
        verificationGateResults: [],
      });
      expect(labelsOnly).toMatchObject({ captured: true, evidence: [] });

      const arbitraryReviewText = await authority.closeoutCandidate({
        goal,
        workItem: item,
        attempt: started.attempt,
        providedEvidence: ["contains-review-word"],
        verificationGateResults: [],
      });
      expect(arbitraryReviewText).toMatchObject({ captured: true });
      expect(authority.surface.authority.inspect({
        projectRuntimeId: authority.surface.projectRuntimeId,
        accountingLineageId: goal.id,
      })?.reviewRounds ?? 0).toBe(0);

      const structuredReview = await authority.closeoutCandidate({
        goal,
        workItem: item,
        attempt: started.attempt,
        providedEvidence: [],
        verificationGateResults: [{ gate: MANAGED_ORCHESTRATION_REVIEW_GATE, status: "passed" }],
      });
      expect(structuredReview).toMatchObject({ captured: true });
      if (!structuredReview.captured) throw new Error("expected structured review capture");
      expect(authority.surface.authority.inspect({
        projectRuntimeId: authority.surface.projectRuntimeId,
        accountingLineageId: goal.id,
      })?.reviewRounds).toBe(1);

      const admission = authority.admitExecutionAttempt({
        goal,
        workItem: item,
        attemptId: started.attempt.id,
      });
      expect(admission.admitted).toBe(true);
      if (!admission.admitted) throw new Error("expected execution admission");
      admission.commit();
      const closeout = await authority.closeoutGoal({
        goal,
        candidate: structuredReview.candidate,
        candidateEvidence: structuredReview.evidence,
        assuranceEvaluation: structuredReview.assuranceEvaluation,
      });
      expect(closeout.kind).toBe("pause_acceptance_incomplete");
    } finally {
      authority.close();
    }
  });

  it("does not let a directly invoked registry-registered finish tool mint evidence", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-bounded-work-direct-finish-"));
    roots.push(root);
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-direct-finish",
      summary: "Reject direct finish provenance forgery.",
      workflowProfile: "verification-heavy",
      triggers: ["formal-proof-candidate"],
      expectedEvidence: ["formal-proof"],
      verificationGates: [],
      goalRunId: "goal-direct-finish",
    });
    const goal = goalRunStore.create({
      id: "goal-direct-finish",
      objective: "Capture verifier observations.",
      ownerSessionId: "session-direct-finish",
      source: { kind: "approved_plan", planId: "plan-direct-finish" },
      boundedWorkContractRevision: boundedWorkRevision("goal-direct-finish", [item.id]),
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
    const candidate = createBoundedWorkCandidate({
      goalRunId: goal.id,
      workItemId: item.id,
      contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      accountingLineageId: goal.boundedWorkContractRevision.accountingLineageId,
      kind: "git_worktree",
      baseline: { kind: "git_tree", digest: digest("a") },
      candidateContentDigest: digest("b"),
      createdAt: started.attempt.startedAt,
    });
    captureCandidate.mockResolvedValue({
      status: "captured",
      candidate,
      snapshot: {
        verification: "double_observed_git_tree",
        baselineTreeObjectId: "baseline-direct-finish",
        candidateTreeObjectId: "candidate-direct-finish",
        changedFiles: 1,
        changedPaths: ["packages/cli/src/application/work-governance-tool.ts"],
        changedLines: { kind: "observed", value: 2 },
      },
    });

    const authority = createProjectBoundedWorkAuthority(root, {
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    const publicCompositionValues = Object.values({ ...authority });
    const publicSurfaceValues = Object.values({ ...authority.surface });
    expect(publicCompositionValues).toHaveLength(5);
    expect(publicSurfaceValues).toHaveLength(2);
    try {
      const closeoutCalls = vi.fn();
      const finishTool = createWorkGovernanceTools(undefined, {
        workItemStore,
        goalRunStore,
        boundedWorkCandidateCloseout: async () => {
          closeoutCalls();
          throw new Error("direct invocation reached candidate closeout");
        },
      }).find((tool) => tool.name === "work_item.execution.finish");
      if (!finishTool) throw new Error("expected actual CLI finish tool");
      new DevToolRegistry().register(finishTool);

      // A direct caller can inspect every public composition/surface value;
      // none may provide Runtime invocation state or an evidence authority.
      const fabricatedTransport = formalFinishTransport(goal.id, item.id, started.attempt.id);

      const result = await finishTool.execute({
        name: finishTool.name,
        input: {
          goalRunId: goal.id,
          workItemId: item.id,
          attemptId: started.attempt.id,
          providedEvidence: ["formal-proof"],
        },
      }, undefined, {
        [FORMAL_VERIFICATION_FINISH_TRANSPORT]: fabricatedTransport,
      });

      expect(result.isError).toBe(true);
      expect(closeoutCalls).not.toHaveBeenCalled();
      expect(captureCandidate).not.toHaveBeenCalled();
      expect(workItemStore.get(item.id)?.executionAttempts[0]?.candidateEvidence).toBeUndefined();
    } finally {
      authority.close();
    }
  });

  it("requires a structured review result for a tripwire", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-bounded-work-tripwire-"));
    roots.push(root);
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-tripwire",
      summary: "Require explicit review gate result.",
      workflowProfile: "verification-heavy",
      triggers: ["formal-proof-candidate"],
      expectedEvidence: ["formal-proof"],
      verificationGates: [],
      goalRunId: "goal-tripwire",
    });
    const goal = goalRunStore.create({
      id: "goal-tripwire",
      objective: "Capture verifier observations.",
      ownerSessionId: "session-tripwire",
      source: { kind: "approved_plan", planId: "plan-tripwire" },
      boundedWorkContractRevision: boundedWorkRevision("goal-tripwire", [item.id], { changedLines: 1 }),
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
    captureCandidate.mockResolvedValue({
      status: "captured",
      candidate: createBoundedWorkCandidate({
        goalRunId: goal.id,
        workItemId: item.id,
        contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
        accountingLineageId: goal.boundedWorkContractRevision.accountingLineageId,
        kind: "git_worktree",
        baseline: { kind: "git_tree", digest: digest("a") },
        candidateContentDigest: digest("b"),
        createdAt: started.attempt.startedAt,
      }),
      snapshot: {
        verification: "double_observed_git_tree",
        baselineTreeObjectId: "baseline-tripwire",
        candidateTreeObjectId: "candidate-tripwire",
        changedFiles: 1,
        changedPaths: ["packages/cli/src/application/work-governance-tool.ts"],
        changedLines: { kind: "observed", value: 2 },
      },
    });
    const authority = createProjectBoundedWorkAuthority(root, {
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    try {
      const textOnly = await authority.closeoutCandidate({
        goal,
        workItem: item,
        attempt: started.attempt,
        providedEvidence: ["contains-review-word"],
        verificationGateResults: [],
      });
      expect(textOnly).toMatchObject({ captured: false, code: "candidate_tripwire_review_required" });

      const structured = await authority.closeoutCandidate({
        goal,
        workItem: item,
        attempt: started.attempt,
        providedEvidence: [],
        verificationGateResults: [{ gate: MANAGED_ORCHESTRATION_REVIEW_GATE, status: "passed" }],
      });
      expect(structured).toMatchObject({ captured: true });
    } finally {
      authority.close();
    }
  });

  it("creates v2 evidence through the attached Runtime and registered finish tool", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-bounded-work-runtime-finish-"));
    roots.push(root);
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-runtime-finish",
      summary: "Capture Runtime verifier output.",
      workflowProfile: "verification-heavy",
      triggers: ["formal-proof-candidate"],
      expectedEvidence: ["formal-proof"],
      verificationGates: [],
      goalRunId: "goal-runtime-finish",
    });
    const goal = goalRunStore.create({
      id: "goal-runtime-finish",
      objective: "Capture verifier observations.",
      ownerSessionId: "session-runtime-finish",
      source: { kind: "approved_plan", planId: "plan-runtime-finish" },
      boundedWorkContractRevision: boundedWorkRevision("goal-runtime-finish", [item.id], {}, "RuntimeFinish"),
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
    const candidate = createBoundedWorkCandidate({
      goalRunId: goal.id,
      workItemId: item.id,
      contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      accountingLineageId: goal.boundedWorkContractRevision.accountingLineageId,
      kind: "git_worktree",
      baseline: { kind: "git_tree", digest: digest("e") },
      candidateContentDigest: digest("f"),
      createdAt: started.attempt.startedAt,
    });
    captureCandidate.mockResolvedValue({
      status: "captured",
      candidate,
      snapshot: {
        verification: "double_observed_git_tree",
        baselineTreeObjectId: "baseline-runtime-finish",
        candidateTreeObjectId: "candidate-runtime-finish",
        changedFiles: 1,
        changedPaths: ["packages/cli/src/application/work-governance-tool.ts"],
        changedLines: { kind: "observed", value: 2 },
      },
    });

    const authority = createProjectBoundedWorkAuthority(root, {
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    const formalVerify: DevTool = {
      name: "formal_verify",
      description: "Return a deterministic formal-verification fact.",
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", minLength: 1 } },
        required: ["file"],
        additionalProperties: false,
      },
      effectEnvelope: {
        operation: "observe",
        boundaries: ["process"],
        reversibility: "reversible",
        dataEgress: "metadata",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "idempotent",
      },
      async execute() {
        return {
          output: "unused",
          isError: false,
        };
      },
    };
    const governanceTools = createWorkGovernanceTools(undefined, {
      workItemStore,
      goalRunStore,
      boundedWorkCandidateCloseout: authority.closeoutCandidate,
    });
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { additionalTools: [formalVerify, ...governanceTools] },
      boundedWork: authority.surface,
    });
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test",
      userId: "operator",
      systemPrompt: "test",
      sessionId: "session-runtime-finish",
    });
    const executionScope = {
      kind: "work_item" as const,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
    };
    const [observation] = collectRuntimeFormalVerificationObservations({
      currentScope: executionScope,
      currentTurnToolExecutions: [{
        toolCallScopeId: "runtime-finish-turn:response:1",
        toolCallId: "formal-runtime-finish",
        toolName: "formal_verify",
        success: true,
        metadata: formalVerificationToolMetadata({
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: digest("a") },
          subjects: [{ path: SUBJECT_PATH, contentDigest: digest("subject") }],
          checks: [{ symbol: "RuntimeFinish", check: "correctness", outcome: "proved", durationMs: 0, resourceCount: 0 }],
        }),
        executionScope,
      }],
    });
    if (!observation) throw new Error("expected Runtime-owned formal observation");

    try {
      const finishExecutor = runtimeSurface.callBuiltinTools.get("work_item.execution.finish");
      if (!finishExecutor) throw new Error("expected attached Runtime finish executor");
      const executionContext: RuntimeBuiltinToolExecutionContext = {
        session,
        toolCall: {
          id: "finish-runtime-finish",
          name: "work_item.execution.finish",
          input: {
            goalRunId: goal.id,
            workItemId: item.id,
            attemptId: started.attempt.id,
            providedEvidence: ["formal-proof"],
          },
        },
        executionScope,
        formalVerificationObservations: Object.freeze([observation]),
        authority: { level: 1, allowed: true, requiresApproval: false, reason: "test authority" },
        resolvedEffect: {
          operation: "mutate",
          boundaries: ["workspace"],
          reversibility: "compensatable",
          dataEgress: "metadata",
          identityUse: "none",
          consequences: ["local-state"],
          idempotency: "non-idempotent",
        },
      };
      const execution = await finishExecutor(executionContext.toolCall.input, executionContext);
      expect(execution.isError, execution.output).toBe(false);
      expect(resolveSubjects).toHaveBeenCalledWith(expect.objectContaining({
        candidateTreeObjectId: "candidate-runtime-finish",
        candidate: expect.objectContaining({ candidateContentDigest: digest("f") }),
      }));
      const finishedAttempt = workItemStore.get(item.id)?.executionAttempts.find((entry) => entry.id === started.attempt.id);
      expect(finishedAttempt?.candidateEvidence).toHaveLength(1);
      expect(finishedAttempt?.assuranceEvaluation).toMatchObject({
        schema: "kiln.bounded-work-assurance-evaluation/v1",
        candidate: { candidateDigest: finishedAttempt?.candidate?.candidateDigest },
      });
      expect(finishedAttempt?.candidateEvidence[0]).toMatchObject({
        schema: "kiln.bounded-work-candidate-evidence/v3",
        invocation: {
          toolCallScopeId: "runtime-finish-turn:response:1",
          toolCallId: "formal-runtime-finish",
        },
        attestation: {
          producer: { kind: "registered_tool", toolName: "formal_verify" },
          establishes: [],
          payload: { checks: [{ outcome: "proved" }] },
        },
      });
    } finally {
      await runtimeSurface.dispose();
      authority.close();
    }
  });

  it("accepts a candidate through Runtime evidence, stored Assurance, and goal.complete", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-bounded-work-positive-closeout-"));
    roots.push(root);
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-positive-closeout",
      summary: "Prove the captured candidate.",
      workflowProfile: "verification-heavy",
      triggers: ["formal-proof-candidate"],
      expectedEvidence: ["formal-proof"],
      verificationGates: [],
      goalRunId: "goal-positive-closeout",
    });
    const goal = goalRunStore.create({
      id: "goal-positive-closeout",
      objective: "Capture verifier observations.",
      ownerSessionId: "session-positive-closeout",
      source: { kind: "approved_plan", planId: "plan-positive-closeout" },
      boundedWorkContractRevision: boundedWorkRevision("goal-positive-closeout", [item.id], {}, "PositiveCloseout"),
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
    const candidate = createBoundedWorkCandidate({
      goalRunId: goal.id,
      workItemId: item.id,
      contractRevisionDigest: goal.boundedWorkContractRevision.revisionDigest,
      accountingLineageId: goal.boundedWorkContractRevision.accountingLineageId,
      kind: "git_worktree",
      baseline: { kind: "git_tree", digest: digest("positive-baseline") },
      candidateContentDigest: digest("positive-candidate"),
      createdAt: started.attempt.startedAt,
    });
    captureCandidate.mockResolvedValue({
      status: "captured",
      candidate,
      snapshot: {
        verification: "double_observed_git_tree",
        baselineTreeObjectId: "baseline-positive-closeout",
        candidateTreeObjectId: "candidate-positive-closeout",
        changedFiles: 1,
        changedPaths: [SUBJECT_PATH],
        changedLines: { kind: "observed", value: 1 },
      },
    });

    const authority = createProjectBoundedWorkAuthority(root, {
      formalVerificationCapability: { metric: "formal_verification", status: "available" },
    });
    const admission = authority.admitExecutionAttempt({ goal, workItem: item, attemptId: started.attempt.id });
    if (!admission.admitted) throw new Error("expected positive closeout execution admission");
    admission.commit();
    const formalVerify: DevTool = {
      name: "formal_verify",
      description: "Return a deterministic formal-verification fact.",
      inputSchema: {
        type: "object",
        properties: { file: { type: "string", minLength: 1 } },
        required: ["file"],
        additionalProperties: false,
      },
      effectEnvelope: {
        operation: "observe",
        boundaries: ["process"],
        reversibility: "reversible",
        dataEgress: "metadata",
        identityUse: "none",
        consequences: ["local-state"],
        idempotency: "idempotent",
      },
      async execute() {
        return { output: "unused", isError: false };
      },
    };
    const governanceTools = createWorkGovernanceTools(undefined, {
      workItemStore,
      goalRunStore,
      boundedWorkCandidateCloseout: authority.closeoutCandidate,
      boundedWorkGoalCloseout: authority.closeoutGoal,
    });
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: { additionalTools: [formalVerify, ...governanceTools] },
      boundedWork: authority.surface,
    });
    const session = new RuntimeSession({
      appName: "kiln",
      tenantId: "test",
      userId: "operator",
      systemPrompt: "test",
      sessionId: "session-positive-closeout",
    });
    const executionScope = {
      kind: "work_item" as const,
      goalRunId: goal.id,
      workItemId: item.id,
      attemptId: started.attempt.id,
    };
    const [observation] = collectRuntimeFormalVerificationObservations({
      currentScope: executionScope,
      currentTurnToolExecutions: [{
        toolCallScopeId: "positive-closeout-turn:response:1",
        toolCallId: "formal-positive-closeout",
        toolName: "formal_verify",
        success: true,
        metadata: formalVerificationToolMetadata({
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: digest("positive-artifact") },
          subjects: [{ path: SUBJECT_PATH, contentDigest: digest("subject") }],
          checks: [{ symbol: "PositiveCloseout", check: "correctness", outcome: "proved", durationMs: 0, resourceCount: 0 }],
        }),
        executionScope,
      }],
    });
    if (!observation) throw new Error("expected positive closeout formal observation");

    try {
      const finishExecutor = runtimeSurface.callBuiltinTools.get("work_item.execution.finish");
      if (!finishExecutor) throw new Error("expected attached Runtime finish executor");
      const executionContext: RuntimeBuiltinToolExecutionContext = {
        session,
        toolCall: {
          id: "finish-positive-closeout",
          name: "work_item.execution.finish",
          input: {
            goalRunId: goal.id,
            workItemId: item.id,
            attemptId: started.attempt.id,
            providedEvidence: ["formal-proof"],
          },
        },
        executionScope,
        formalVerificationObservations: Object.freeze([observation]),
        authority: { level: 1, allowed: true, requiresApproval: false, reason: "test authority" },
        resolvedEffect: {
          operation: "mutate",
          boundaries: ["workspace"],
          reversibility: "compensatable",
          dataEgress: "metadata",
          identityUse: "none",
          consequences: ["local-state"],
          idempotency: "non-idempotent",
        },
      };
      const finished = await finishExecutor(executionContext.toolCall.input, executionContext);
      expect(finished.isError, finished.output).toBe(false);
      const finishedAttempt = workItemStore.get(item.id)?.executionAttempts.at(-1);
      expect(finishedAttempt?.assuranceEvaluation?.criterionEvaluations).toEqual([{
        criterionId: "formal-verification",
        obligationIds: ["formal-proof"],
        outcome: "established",
      }]);

      const completeTool = governanceTools.find((tool) => tool.name === "goal.complete");
      if (!completeTool) throw new Error("expected goal.complete tool");
      const completed = await completeTool.execute({
        name: "goal.complete",
        input: { goalRunId: goal.id },
      });
      expect(completed.isError, completed.output).toBe(false);
      expect(JSON.parse(completed.output)).toMatchObject({
        status: "completed",
        boundedWorkCloseout: {
          kind: "stop_acceptance_complete",
          acceptanceDecision: { outcome: "accepted" },
        },
      });
      expect(goalRunStore.get(goal.id)).toMatchObject({
        status: "completed",
        boundedWorkCloseoutDecision: {
          kind: "stop_acceptance_complete",
          acceptanceDecision: { outcome: "accepted" },
        },
      });
      expect(captureCandidate).toHaveBeenCalledTimes(2);
    } finally {
      await runtimeSurface.dispose();
      authority.close();
    }
  });
});

const goalId = "goal-composition";

function boundedWorkRevision(
  id: string,
  workItemIds: readonly string[],
  tripwires: { readonly changedLines?: number } = {},
  symbol = "aProved",
) {
  return adoptBoundedWorkContractRevision({
    accountingLineageId: id,
    adoptedAt: "2026-08-19T12:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: `${id}:decision` },
    contract: {
      schema: "kiln.bounded-work-contract/v2",
      intent: {
        objective: "Capture verifier observations.",
        acceptanceCriteria: [{ id: "formal-verification", statement: "Formal verification is established." }],
        nonGoals: [],
      },
      assurance: {
        formalVerification: {
          semantics: "allOf",
          obligations: [{ id: "formal-proof", symbol, subjectPaths: [SUBJECT_PATH] }],
          mappings: [{ criterionId: "formal-verification", obligationIds: ["formal-proof"] }],
        },
      },
      scope: {
        allowedWorkItemIds: workItemIds,
        permittedEffects: ["inspect", "modify_source", "run_verification"],
        permittedSurfaces: ["cli"],
        allowedRoots: ["packages/cli"],
        deniedRoots: [],
        refactorAuthority: "scoped",
        migrationAuthority: "none",
        dependencyAuthority: "none",
      },
      limits: {
        maxExecutionAttempts: 10,
        maxManagedInvocations: 10,
        maxConcurrentManagedInvocations: 3,
        maxChildDepth: 2,
        maxReviewRounds: 3,
        maxRemediationRounds: 3,
      },
      tripwires,
      policy: { scopeExpansion: "approval_required", budgetExhaustion: "pause", minimumHarnessCapability: "authoritative" },
    },
  });
}

function formalFinishTransport(goalRunId: string, workItemId: string, attemptId: string) {
  const executionScope = { kind: "work_item" as const, goalRunId, workItemId, attemptId };
  return {
    executionScope,
    observations: [
      {
        metadata: formalVerificationToolMetadata({
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: digest("c") },
          subjects: [{ path: SUBJECT_PATH, contentDigest: digest("subject") }],
          checks: [{ symbol: "aProved", check: "correctness", outcome: "proved", durationMs: 0, resourceCount: 0 }],
        }),
        toolCallScopeId: "scope-proved",
        toolCallId: "call-proved",
        executionScope,
      },
      {
        metadata: formalVerificationToolMetadata({
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: digest("d") },
          subjects: [{ path: SUBJECT_PATH, contentDigest: digest("subject") }],
          checks: [{ symbol: "bRefuted", check: "correctness", outcome: "refuted", detail: "Counterexample.", durationMs: 0, resourceCount: 0 }],
        }),
        toolCallScopeId: "scope-refuted",
        toolCallId: "call-refuted",
        executionScope,
      },
    ],
    recordedAt: "2026-08-19T12:01:00.000Z",
    producer: { kind: "registered_tool" as const, toolName: "formal_verify" as const },
  };
}

function digest(character: string): string {
  return `sha256:${createHash("sha256").update(character).digest("hex")}`;
}

function fixedNow(): string {
  return "2026-08-19T12:00:00.000Z";
}
