import { describe, expect, it } from "vitest";
import {
  adoptBoundedWorkContractRevision,
  createBoundedWorkCandidate,
  createBoundedWorkCandidateEvidence,
  decideBoundedWorkAdmission,
  decideBoundedWorkCloseout,
  type BoundedWorkAccountingSnapshot,
  type BoundedWorkContract,
} from "../../src/work-governance/index.js";
import { parseBoundedWorkAcceptanceDecisionRecord } from "../../src/work-governance/bounded-work-decision.js";
import {
  evaluateBoundedWorkAssurance,
  parseBoundedWorkAssuranceEvaluation,
} from "../../src/work-governance/bounded-work-assurance.js";
import { boundedWorkDigest } from "../../src/work-governance/bounded-work-content.js";
import type { BoundedWorkCandidateIdentity } from "../../src/work-governance/bounded-work-candidate.js";
import type { BoundedWorkCandidateEvidence } from "../../src/work-governance/bounded-work-evidence.js";
import { formalVerificationToolMetadata } from "../../src/tools/domain/tool-result-metadata.js";
import type { FormalVerificationOutcome } from "../../src/tools/domain/tool-result-metadata.js";

const sha = (value: string): string => boundedWorkDigest(value);

const contract: BoundedWorkContract = {
  schema: "kiln.bounded-work-contract/v2",
  intent: {
    objective: "Bound execution.",
    acceptanceCriteria: [
      { id: "review", statement: "Review evidence is established." },
      { id: "tests", statement: "Test evidence is established." },
    ],
    nonGoals: [],
  },
  assurance: {
    formalVerification: {
      semantics: "allOf",
      obligations: [
        { id: "review-proof", symbol: "review.approved", subjectPaths: ["src/review.dfy"] },
        { id: "tests-proof", symbol: "tests.pass", subjectPaths: ["src/tests.dfy"] },
      ],
      mappings: [
        { criterionId: "review", obligationIds: ["review-proof"] },
        { criterionId: "tests", obligationIds: ["tests-proof"] },
      ],
    },
  },
  scope: {
    allowedWorkItemIds: ["work-1"],
    permittedEffects: ["modify_source", "invoke_managed_agent"],
    permittedSurfaces: ["core"],
    allowedRoots: ["packages/core"],
    deniedRoots: [],
    refactorAuthority: "scoped",
    migrationAuthority: "none",
    dependencyAuthority: "none",
  },
  limits: {
    maxExecutionAttempts: 2,
    maxManagedInvocations: 1,
    maxConcurrentManagedInvocations: 1,
    maxChildDepth: 1,
    maxReviewRounds: 1,
    maxRemediationRounds: 1,
    maxToolCalls: 5,
  },
  tripwires: {},
  policy: {
    scopeExpansion: "approval_required",
    budgetExhaustion: "pause",
    minimumHarnessCapability: "authoritative",
  },
};

const revision = adoptBoundedWorkContractRevision({
  contract,
  accountingLineageId: "goal-1",
  adoptedAt: "2026-08-12T18:00:00.000Z",
  adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
});

const snapshot = (overrides: Partial<BoundedWorkAccountingSnapshot> = {}): BoundedWorkAccountingSnapshot => ({
  schema: "kiln.bounded-work-accounting/v1",
  accountingLineageId: "goal-1",
  contractRevisionDigest: revision.revisionDigest,
  revision: 3,
  executionAttempts: 1,
  managedInvocations: 0,
  activeManagedInvocations: 0,
  reviewRounds: 0,
  remediationRounds: 0,
  toolCalls: { kind: "observed", value: 2 },
  activeDurationMs: { kind: "observed", value: 1_000 },
  ...overrides,
});

const request = {
  harnessCapability: "authoritative" as const,
  formalVerificationCapability: {
    metric: "formal_verification" as const,
    status: "available" as const,
  },
  scope: {
    workItemId: "work-1",
    effect: "modify_source" as const,
    surface: "core",
    paths: ["packages/core/src/index.ts"],
  },
};

const candidateFor = (candidateRevision = revision): BoundedWorkCandidateIdentity => createBoundedWorkCandidate({
  goalRunId: "run-1",
  workItemId: "work-1",
  contractRevisionDigest: candidateRevision.revisionDigest,
  accountingLineageId: candidateRevision.accountingLineageId,
  kind: "git_worktree",
  baseline: { kind: "git_tree", digest: sha("a") },
  candidateContentDigest: sha("b"),
  createdAt: "2026-08-20T12:00:00.000Z",
});

const subjects = [
  { path: "src/review.dfy", contentDigest: sha("r") },
  { path: "src/tests.dfy", contentDigest: sha("t") },
] as const;

const evidenceFor = (
  candidate: BoundedWorkCandidateIdentity,
  symbol: string,
  outcome: FormalVerificationOutcome = "proved",
  callId = symbol,
): BoundedWorkCandidateEvidence => createBoundedWorkCandidateEvidence({
  candidate,
  executionAttempt: { goalRunId: candidate.goalRunId, workItemId: candidate.workItemId, attemptId: "attempt-1" },
  invocation: { toolCallScopeId: "scope-1", toolCallId: callId },
  attestation: {
    producer: { kind: "registered_tool", toolName: "formal_verify" },
    payload: formalVerificationToolMetadata({
      verifier: { name: "dafny", version: "4.11.0" },
      artifact: { contentDigest: sha("artifact") },
      subjects,
      checks: [{ symbol, check: "correctness", outcome, ...(outcome === "proved" ? {} : { detail: "not proved" }) }],
    }),
  },
  recordedAt: "2026-08-20T12:01:00.000Z",
});

const assuranceFor = (
  candidate: BoundedWorkCandidateIdentity,
  candidateRevision = revision,
  candidateEvidence: readonly BoundedWorkCandidateEvidence[] = [
    evidenceFor(candidate, "review.approved"),
    evidenceFor(candidate, "tests.pass"),
  ],
) => evaluateBoundedWorkAssurance({
  revision: candidateRevision,
  candidate,
  candidateSubjects: {
    candidateContentDigest: candidate.candidateContentDigest,
    digests: new Map(subjects.map(({ path, contentDigest }) => [path, contentDigest])),
  },
  candidateEvidence,
  evaluatedAt: "2026-08-20T12:02:00.000Z",
});

describe("bounded work decision", () => {
  it("pauses for unavailable formal verification before evaluating or reserving budget", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ executionAttempts: 2 }),
      ...request,
      formalVerificationCapability: { metric: "formal_verification", status: "unavailable" },
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["formal_verification"],
      continuation: { action: "select_capable_harness" },
    });
  });

  it("admits only while the cumulative accounting snapshot remains below every ceiling", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({ kind: "admitted", reserved: { executionAttempts: 1 } });

    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ executionAttempts: 2 }),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_budget_exhausted",
      exhaustedLimits: ["execution_attempts"],
      continuation: { action: "request_budget_revision", accountingRevision: 3 },
    });
  });

  it("fails closed when a hard measured limit has unknown usage", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ toolCalls: { kind: "unknown" } }),
      ...request,
      reservation: { kind: "tool_call", amount: 1 },
    })).toMatchObject({
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["tool_calls"],
      continuation: { action: "select_capable_harness" },
    });
  });

  it("applies managed child total, concurrency, and depth limits together", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ managedInvocations: 1, activeManagedInvocations: 1 }),
      ...request,
      reservation: { kind: "managed_invocation", amount: 1, childDepth: 2 },
    })).toMatchObject({
      kind: "pause_budget_exhausted",
      exhaustedLimits: ["managed_invocations", "concurrent_managed_invocations", "child_depth"],
    });
  });

  it("requires semantic scope and the contract's minimum harness capability", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      harnessCapability: "advisory_only",
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_capability_unavailable",
      unavailableMetrics: ["harness_authority"],
    });
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      scope: { ...request.scope, paths: ["packages/runtime/src/index.ts"] },
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "pause_scope_revision_required",
      violations: [{ kind: "path_not_permitted", value: "packages/runtime/src/index.ts" }],
      continuation: { action: "request_scope_revision" },
    });
  });

  it("honors the contract's terminal budget-exhaustion policy", () => {
    const stopRevision = adoptBoundedWorkContractRevision({
      contract: { ...contract, policy: { ...contract.policy, budgetExhaustion: "stop" } },
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-12T18:00:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-stop" },
    });
    expect(decideBoundedWorkAdmission({
      revision: stopRevision,
      snapshot: snapshot({ contractRevisionDigest: stopRevision.revisionDigest, executionAttempts: 2 }),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toMatchObject({
      kind: "stop_budget_exhausted",
      exhaustedLimits: ["execution_attempts"],
    });
  });

  it("requires review and remediation reservations to name exact candidates", () => {
    expect(decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      reservation: { kind: "review_round", amount: 1, candidateDigest: sha("c") },
    })).toMatchObject({ kind: "admitted", reserved: { reviewRounds: 1 } });
    expect(() => decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot(),
      ...request,
      reservation: {
        kind: "remediation_round",
        amount: 1,
        candidateDigest: sha("c"),
        previousCandidateDigest: sha("c"),
      },
    })).toThrow("remediation must create a successor candidate");
  });

  it("fails closed on corrupt durable accounting", () => {
    expect(() => decideBoundedWorkAdmission({
      revision,
      snapshot: snapshot({ executionAttempts: -1 }),
      ...request,
      reservation: { kind: "execution_attempt", amount: 1 },
    })).toThrow("accounting.executionAttempts must be a non-negative integer");
  });

  it("stops only after every policy criterion is established", () => {
    const candidate = candidateFor();
    const candidateEvidence = [
      evidenceFor(candidate, "review.approved"),
      evidenceFor(candidate, "tests.pass"),
    ];
    const assuranceEvaluation = assuranceFor(candidate, revision, candidateEvidence);

    const decision = decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence,
      assuranceEvaluation,
      decidedAt: "2026-08-20T12:03:00.000Z",
    });

    expect(decision).toMatchObject({
      kind: "stop_acceptance_complete",
      candidateDigest: candidate.candidateDigest,
      contractRevisionDigest: revision.revisionDigest,
      acceptanceDecision: {
        schema: "kiln.bounded-work-acceptance-decision/v1",
        outcome: "accepted",
        issuer: { kind: "automatic_policy", policyRevisionDigest: revision.revisionDigest },
        authority: revision.adoptedBy,
      },
    });
    expect(Object.isFrozen(decision.acceptanceDecision)).toBe(true);
    expect(parseBoundedWorkAcceptanceDecisionRecord(decision.acceptanceDecision)).toEqual(
      decision.acceptanceDecision,
    );
  });

  it.each([
    ["partial", [evidenceFor(candidateFor(), "review.approved")]],
    ["refuted", [
      evidenceFor(candidateFor(), "review.approved", "refuted"),
      evidenceFor(candidateFor(), "tests.pass", "refuted"),
    ]],
    ["unresolved", []],
  ] as const)("pauses for %s Assurance outcomes and names unresolved criteria", (label, candidateEvidence) => {
    const candidate = candidateFor();
    const evidence = candidateEvidence.map((entry) => ({
      ...entry,
      candidate: { ...entry.candidate, candidateDigest: candidate.candidateDigest },
    }));
    const assuranceEvaluation = assuranceFor(candidate, revision, evidence);
    const decision = decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence: evidence,
      assuranceEvaluation,
      decidedAt: "2026-08-20T12:03:00.000Z",
    });

    expect(decision.kind).toBe("pause_acceptance_incomplete");
    if (decision.kind !== "pause_acceptance_incomplete") {
      throw new Error("expected incomplete acceptance decision");
    }
    expect(decision.missingCriteria).toEqual(label === "partial" ? ["tests"] : ["review", "tests"]);
    expect(decision.acceptanceDecision.outcome).toBe("incomplete");
  });

  it("rejects stale candidate, revision, and Assurance evaluation bindings", () => {
    const candidate = candidateFor();
    const candidateEvidence = [evidenceFor(candidate, "review.approved"), evidenceFor(candidate, "tests.pass")];
    const assuranceEvaluation = assuranceFor(candidate, revision, candidateEvidence);

    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: sha("other-candidate"),
      candidateEvidence,
      assuranceEvaluation,
      decidedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/candidateDigest/u);

    const otherRevision = adoptBoundedWorkContractRevision({
      contract,
      accountingLineageId: "goal-1",
      adoptedAt: "2026-08-20T12:04:00.000Z",
      adoptedBy: { kind: "operator", actorId: "operator-2", decisionId: "decision-2" },
    });
    const otherCandidate = candidateFor(otherRevision);
    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: otherCandidate.candidateDigest,
      candidateEvidence,
      assuranceEvaluation: assuranceFor(otherCandidate, otherRevision, []),
      decidedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/contractRevisionDigest/u);

    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence,
      assuranceEvaluation: { ...assuranceEvaluation, candidate: { ...assuranceEvaluation.candidate, accountingLineageId: "other-lineage" } },
      decidedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/evaluationDigest/u);
  });

  it("fails closed when the evaluation names evidence absent from the candidate evidence set", () => {
    const candidate = candidateFor();
    const candidateEvidence = [evidenceFor(candidate, "review.approved"), evidenceFor(candidate, "tests.pass")];
    const assuranceEvaluation = assuranceFor(candidate, revision, candidateEvidence);

    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence: [candidateEvidence[0]!],
      assuranceEvaluation,
      decidedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/evidence/u);
  });

  it("does not accept an evaluation whose policy mapping or outcome was forged and re-digested", () => {
    const candidate = candidateFor();
    const candidateEvidence = [evidenceFor(candidate, "review.approved"), evidenceFor(candidate, "tests.pass")];
    const assuranceEvaluation = assuranceFor(candidate, revision, candidateEvidence);
    const forgedMapping = {
      ...assuranceEvaluation,
      criterionEvaluations: assuranceEvaluation.criterionEvaluations.map((evaluation) => ({
        ...evaluation,
        obligationIds: evaluation.criterionId === "review" ? ["tests-proof"] : ["review-proof"],
      })),
    };
    const forgedMappingEvaluation = parseBoundedWorkAssuranceEvaluation({
      ...forgedMapping,
      evaluationDigest: boundedWorkDigest({ ...forgedMapping, evaluationDigest: undefined }),
    });
    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence,
      assuranceEvaluation: forgedMappingEvaluation,
      decidedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/mapping/u);

    const refutedEvidence = [
      evidenceFor(candidate, "review.approved", "refuted"),
      evidenceFor(candidate, "tests.pass", "refuted"),
    ];
    const unresolvedEvaluation = assuranceFor(candidate, revision, refutedEvidence);
    const forgedOutcome = {
      ...unresolvedEvaluation,
      obligationEvaluations: unresolvedEvaluation.obligationEvaluations.map((evaluation, index) => ({
        ...evaluation,
        outcome: "established" as const,
        evidenceRecordDigests: [refutedEvidence[index]!.recordDigest],
      })),
      criterionEvaluations: unresolvedEvaluation.criterionEvaluations.map((evaluation) => ({
        ...evaluation,
        outcome: "established" as const,
      })),
    };
    const forgedOutcomeEvaluation = parseBoundedWorkAssuranceEvaluation({
      ...forgedOutcome,
      evaluationDigest: boundedWorkDigest({ ...forgedOutcome, evaluationDigest: undefined }),
    });
    expect(() => decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence: refutedEvidence,
      assuranceEvaluation: forgedOutcomeEvaluation,
      decidedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/established outcome/u);
  });

  it("rejects a tampered acceptance decision digest and preserves adopted authority provenance", () => {
    const candidate = candidateFor();
    const candidateEvidence = [evidenceFor(candidate, "review.approved"), evidenceFor(candidate, "tests.pass")];
    const decision = decideBoundedWorkCloseout({
      revision,
      snapshot: snapshot(),
      candidateDigest: candidate.candidateDigest,
      candidateEvidence,
      assuranceEvaluation: assuranceFor(candidate, revision, candidateEvidence),
      decidedAt: "2026-08-20T12:03:00.000Z",
    });
    expect(() => parseBoundedWorkAcceptanceDecisionRecord({
      ...decision.acceptanceDecision,
      decisionDigest: sha("tampered"),
    })).toThrow(/decisionDigest/u);
    expect(decision.acceptanceDecision.authority).toEqual(revision.adoptedBy);
    expect(decision.acceptanceDecision.authority).not.toEqual({ kind: "operator", actorId: "automatic-policy", decisionId: "closeout" });
  });
});
