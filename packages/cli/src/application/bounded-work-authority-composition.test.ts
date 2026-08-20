import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adoptBoundedWorkContractRevision, createBoundedWorkCandidate, startGoalExecutionAttempt, GoalRunStore, WorkItemStore } from "@kilnai/core/work-governance";
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

const { captureCandidate } = vi.hoisted(() => ({
  captureCandidate: vi.fn(),
}));

vi.mock("@kilnai/runtime", async () => {
  const actual = await vi.importActual<typeof import("@kilnai/runtime")>("@kilnai/runtime");
  const invocationState = await import("../../../runtime/src/work-governance/formal-verification-invocation-state.js");
  return {
    ...actual,
    captureGitWorktreeCandidate: captureCandidate,
    isRuntimeOwnedFormalVerificationFinishInvocation: invocationState.isRuntimeOwnedFormalVerificationFinishInvocation,
    readRuntimeFormalVerificationFinishTransport: invocationState.readRuntimeFormalVerificationFinishTransport,
  };
});

describe("bounded-work authority composition", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    captureCandidate.mockReset();
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
    const authority = createProjectBoundedWorkAuthority(root);
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
        candidate,
        candidateEvidence: [],
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

    const authority = createProjectBoundedWorkAuthority(root);
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
      boundedWorkContractRevision: boundedWorkRevision("goal-runtime-finish", [item.id]),
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

    const authority = createProjectBoundedWorkAuthority(root);
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
          checks: [{ symbol: "RuntimeFinish", check: "correctness", outcome: "proved" }],
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
      };
      const execution = await finishExecutor(executionContext.toolCall.input, executionContext);
      expect(execution.isError, execution.output).toBe(false);
      const finishedAttempt = workItemStore.get(item.id)?.executionAttempts.find((entry) => entry.id === started.attempt.id);
      expect(finishedAttempt?.candidateEvidence).toHaveLength(1);
      expect(finishedAttempt?.candidateEvidence[0]).toMatchObject({
        schema: "kiln.bounded-work-candidate-evidence/v2",
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
});

const goalId = "goal-composition";

function boundedWorkRevision(id: string, workItemIds: readonly string[]) {
  return adoptBoundedWorkContractRevision({
    accountingLineageId: id,
    adoptedAt: "2026-08-19T12:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: `${id}:decision` },
    contract: {
      schema: "kiln.bounded-work-contract/v1",
      intent: { objective: "Capture verifier observations.", acceptanceCriteria: ["formal verification"], nonGoals: [] },
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
      tripwires: {},
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
          checks: [{ symbol: "aProved", check: "correctness", outcome: "proved" }],
        }),
        toolCallScopeId: "scope-proved",
        toolCallId: "call-proved",
        executionScope,
      },
      {
        metadata: formalVerificationToolMetadata({
          verifier: { name: "dafny", version: "4.11.0" },
          artifact: { contentDigest: digest("d") },
          checks: [{ symbol: "bRefuted", check: "correctness", outcome: "refuted", detail: "Counterexample." }],
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
  return `sha256:${character.repeat(64)}`;
}

function fixedNow(): string {
  return "2026-08-19T12:00:00.000Z";
}
