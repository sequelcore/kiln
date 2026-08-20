import {
  adoptBoundedWorkContractRevision,
  createBoundedWorkCandidate,
  createBoundedWorkCandidateEvidence,
  decideBoundedWorkCloseout,
  evaluateBoundedWorkAssurance,
  type BoundedWorkCloseoutDecision,
  type BoundedWorkContractRevision,
} from "../../src/work-governance/index.js";
import { formalVerificationToolMetadata } from "../../src/tools/domain/tool-result-metadata.js";

const digest = (value: string): string => `sha256:${value.repeat(64).slice(0, 64)}`;

export function testBoundedWorkRevision(
  goalRunId: string,
  workItemIds: readonly string[] = ["test-work-item"],
  objective = `Bounded test goal ${goalRunId}.`,
): BoundedWorkContractRevision {
  return adoptBoundedWorkContractRevision({
    accountingLineageId: goalRunId,
    adoptedAt: "2026-08-12T18:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "test-operator", decisionId: `decision:${goalRunId}` },
    contract: {
      schema: "kiln.bounded-work-contract/v2",
      intent: {
        objective,
        acceptanceCriteria: [{ id: "test-evidence", statement: "test evidence" }],
        nonGoals: [],
      },
      assurance: {
        formalVerification: {
          semantics: "allOf",
          obligations: [{ id: "test-obligation", symbol: "Test.Main", subjectPaths: ["src/Test.dfy"] }],
          mappings: [{ criterionId: "test-evidence", obligationIds: ["test-obligation"] }],
        },
      },
      scope: {
        allowedWorkItemIds: workItemIds.length > 0 ? workItemIds : ["test-work-item"],
        permittedEffects: ["inspect", "modify_source", "run_verification"],
        permittedSurfaces: ["core", "runtime", "cli", "session"],
        allowedRoots: ["packages/core", "packages/runtime", "packages/cli"],
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
        maxToolCalls: 100,
        maxActiveDurationMs: 3_600_000,
      },
      tripwires: {},
      policy: {
        scopeExpansion: "approval_required",
        budgetExhaustion: "pause",
        minimumHarnessCapability: "authoritative",
      },
    },
  });
}

export function testBoundedWorkCloseoutDecision(
  goalRunId: string,
  revision: BoundedWorkContractRevision,
  candidateContentDigest = digest("d"),
): Extract<BoundedWorkCloseoutDecision, { readonly kind: "stop_acceptance_complete" }> {
  const workItemId = revision.contract.scope.allowedWorkItemIds[0] ?? "test-work-item";
  const candidate = createBoundedWorkCandidate({
    goalRunId,
    workItemId,
    contractRevisionDigest: revision.revisionDigest,
    accountingLineageId: revision.accountingLineageId,
    kind: "git_worktree",
    baseline: { kind: "git_tree", digest: digest("b") },
    candidateContentDigest,
    createdAt: "2026-08-12T18:01:00.000Z",
  });
  const subjects = [{ path: "src/Test.dfy", contentDigest: digest("e") }];
  const candidateEvidence = [createBoundedWorkCandidateEvidence({
    candidate,
    executionAttempt: { goalRunId, workItemId, attemptId: "attempt-1" },
    invocation: { toolCallScopeId: "scope-1", toolCallId: "call-1" },
    attestation: {
      producer: { kind: "registered_tool", toolName: "formal_verify" },
      payload: formalVerificationToolMetadata({
        verifier: { name: "dafny", version: "4.11.0" },
        artifact: { contentDigest: digest("a") },
        subjects,
        checks: [{ symbol: "Test.Main", check: "correctness", outcome: "proved" }],
      }),
    },
    recordedAt: "2026-08-12T18:02:00.000Z",
  })];
  const assuranceEvaluation = evaluateBoundedWorkAssurance({
    revision,
    candidate,
    candidateSubjects: {
      candidateContentDigest: candidate.candidateContentDigest,
      digests: new Map(subjects.map((subject) => [subject.path, subject.contentDigest])),
    },
    candidateEvidence,
    evaluatedAt: "2026-08-12T18:03:00.000Z",
  });
  const decision = decideBoundedWorkCloseout({
    revision,
    candidateDigest: candidate.candidateDigest,
    candidateEvidence,
    assuranceEvaluation,
    snapshot: {
      schema: "kiln.bounded-work-accounting/v1",
      accountingLineageId: goalRunId,
      contractRevisionDigest: revision.revisionDigest,
      revision: 1,
      executionAttempts: 1,
      managedInvocations: 0,
      activeManagedInvocations: 0,
      reviewRounds: 0,
      remediationRounds: 0,
      toolCalls: { kind: "unavailable" },
      activeDurationMs: { kind: "unavailable" },
    },
    decidedAt: "2026-08-12T18:04:00.000Z",
  });
  if (decision.kind !== "stop_acceptance_complete") {
    throw new Error(`test closeout did not establish all acceptance criteria: ${decision.missingCriteria.join(", ")}`);
  }
  return decision;
}
