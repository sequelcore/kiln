import { describe, expect, it } from "vitest";
import {
  createBoundedWorkCandidate,
  createBoundedWorkCandidateEvidence,
  evaluateBoundedWorkAssurance,
  parseBoundedWorkAssuranceEvaluation,
  adoptBoundedWorkContractRevision,
  type BoundedWorkCandidateIdentity,
  type BoundedWorkCandidateEvidence,
  type BoundedWorkContractRevision,
  type CandidateSubjectDigests,
  type FormalProofSubject,
} from "../../src/work-governance/index.js";
import { boundedWorkDigest } from "../../src/work-governance/bounded-work-content.js";
import { formalVerificationToolMetadata } from "../../src/tools/domain/tool-result-metadata.js";
import type { FormalVerificationOutcome } from "../../src/tools/domain/tool-result-metadata.js";

const sha = (value: string): string => boundedWorkDigest(value);

const revisionFor = (
  obligations: readonly { id: string; symbol: string; subjectPaths: readonly string[] }[],
  mappings: readonly { criterionId: string; obligationIds: readonly string[] }[],
): BoundedWorkContractRevision => {
  const criteria = [...new Set(mappings.map(({ criterionId }) => criterionId))].map((id) => ({
    id,
    statement: `Criterion ${id}`,
  }));
  const contract = {
    schema: "kiln.bounded-work-contract/v2" as const,
    intent: {
      objective: "Evaluate a bounded candidate.",
      acceptanceCriteria: criteria,
      nonGoals: [],
    },
    assurance: {
      formalVerification: {
        semantics: "allOf" as const,
        obligations,
        mappings,
      },
    },
    scope: {
      allowedWorkItemIds: ["work-1"],
      permittedEffects: ["modify_source" as const],
      permittedSurfaces: ["core"],
      allowedRoots: ["packages/core"],
      deniedRoots: [],
      refactorAuthority: "scoped" as const,
      migrationAuthority: "none" as const,
      dependencyAuthority: "none" as const,
    },
    limits: {
      maxExecutionAttempts: 3,
      maxManagedInvocations: 3,
      maxConcurrentManagedInvocations: 1,
      maxChildDepth: 0,
      maxReviewRounds: 0,
      maxRemediationRounds: 0,
    },
    tripwires: {},
    policy: {
      scopeExpansion: "deny" as const,
      budgetExhaustion: "pause" as const,
      minimumHarnessCapability: "authoritative" as const,
    },
  };

  return adoptBoundedWorkContractRevision({
    contract,
    adoptedAt: "2026-08-20T12:00:00.000Z",
    adoptedBy: { kind: "operator", actorId: "operator-1", decisionId: "decision-1" },
    accountingLineageId: "lineage-1",
  });
};

const candidateFor = (revision: BoundedWorkContractRevision): BoundedWorkCandidateIdentity =>
  createBoundedWorkCandidate({
    goalRunId: "goal-1",
    workItemId: "work-1",
    contractRevisionDigest: revision.revisionDigest,
    accountingLineageId: revision.accountingLineageId,
    kind: "git_worktree",
    baseline: { kind: "git_tree", digest: sha("b") },
    candidateContentDigest: sha("c"),
    createdAt: "2026-08-20T12:01:00.000Z",
  });

const candidateSubjectsFor = (
  candidate: BoundedWorkCandidateIdentity,
  subjects: readonly FormalProofSubject[],
): CandidateSubjectDigests => ({
  candidateContentDigest: candidate.candidateContentDigest,
  digests: new Map(subjects.map(({ path, contentDigest }) => [path, contentDigest])),
});

const evidenceFor = (
  candidate: BoundedWorkCandidateIdentity,
  checks: readonly { symbol: string; outcome: FormalVerificationOutcome }[],
  subjects: readonly FormalProofSubject[],
  callId: string,
): BoundedWorkCandidateEvidence => createBoundedWorkCandidateEvidence({
  candidate,
  executionAttempt: { goalRunId: candidate.goalRunId, workItemId: candidate.workItemId, attemptId: "attempt-1" },
  invocation: { toolCallScopeId: "scope-1", toolCallId: callId },
  attestation: {
    producer: { kind: "registered_tool", toolName: "formal_verify" },
    payload: formalVerificationToolMetadata({
      verifier: { name: "dafny", version: "4.11.0" },
      artifact: { contentDigest: sha("a") },
      checks: checks.map(({ symbol, outcome }) => ({
        symbol,
        check: "correctness" as const,
        outcome,
        ...(outcome === "proved" ? {} : { detail: "not proved" }),
      })),
      subjects,
    }),
  },
  recordedAt: "2026-08-20T12:02:00.000Z",
});

const evaluate = (input: {
  obligations?: readonly { id: string; symbol: string; subjectPaths: readonly string[] }[];
  mappings?: readonly { criterionId: string; obligationIds: readonly string[] }[];
  subjects?: readonly FormalProofSubject[];
  evidence?: readonly BoundedWorkCandidateEvidence[];
}) => {
  const obligations = input.obligations ?? [{ id: "obligation-1", symbol: "Check.Main", subjectPaths: ["src/Main.dfy"] }];
  const mappings = input.mappings ?? [{ criterionId: "criterion-1", obligationIds: [obligations[0]!.id] }];
  const revision = revisionFor(obligations, mappings);
  const candidate = candidateFor(revision);
  const subjects = input.subjects ?? [{ path: "src/Main.dfy", contentDigest: sha("s") }];
  const evidence = input.evidence ?? [evidenceFor(candidate, [{ symbol: obligations[0]!.symbol, outcome: "proved" }], subjects, "call-1")];
  return evaluateBoundedWorkAssurance({
    revision,
    candidate,
    candidateSubjects: candidateSubjectsFor(candidate, subjects),
    candidateEvidence: evidence,
    evaluatedAt: "2026-08-20T12:03:00.000Z",
  });
};

describe("bounded work Assurance evaluation", () => {
  it("establishes a criterion from candidate-bound proof subjects", () => {
    const value = evaluate({});

    expect(value).toMatchObject({
      schema: "kiln.bounded-work-assurance-evaluation/v1",
      obligationEvaluations: [{ obligationId: "obligation-1", outcome: "established", evidenceRecordDigests: [expect.any(String)] }],
      criterionEvaluations: [{ criterionId: "criterion-1", outcome: "established", obligationIds: ["obligation-1"] }],
    });
    expect(value.evaluationDigest).toBe(boundedWorkDigest({ ...value, evaluationDigest: undefined }));
    expect(Object.isFrozen(value)).toBe(true);
    expect(parseBoundedWorkAssuranceEvaluation(value)).toEqual(value);
  });

  it("allows one obligation to establish multiple criteria", () => {
    const value = evaluate({
      mappings: [
        { criterionId: "criterion-a", obligationIds: ["obligation-1"] },
        { criterionId: "criterion-b", obligationIds: ["obligation-1"] },
      ],
    });

    expect(value.criterionEvaluations).toEqual([
      { criterionId: "criterion-a", outcome: "established", obligationIds: ["obligation-1"] },
      { criterionId: "criterion-b", outcome: "established", obligationIds: ["obligation-1"] },
    ]);
  });

  it.each([
    ["partial", "unresolved" as const],
    ["refuted", "unresolved" as const],
  ])("does not establish a %s check", (_label, outcome) => {
    const revision = revisionFor(
      [{ id: "obligation-1", symbol: "Check.Main", subjectPaths: ["src/Main.dfy"] }],
      [{ criterionId: "criterion-1", obligationIds: ["obligation-1"] }],
    );
    const candidate = candidateFor(revision);
    const subjects = [{ path: "src/Main.dfy", contentDigest: sha("s") }];
    const unresolved = evaluateBoundedWorkAssurance({
      revision,
      candidate,
      candidateSubjects: candidateSubjectsFor(candidate, subjects),
      candidateEvidence: [evidenceFor(candidate, [{ symbol: "Check.Main", outcome }], subjects, "call-unresolved")],
      evaluatedAt: "2026-08-20T12:03:00.000Z",
    });

    expect(unresolved.obligationEvaluations[0]).toMatchObject({ outcome: "unresolved", evidenceRecordDigests: [] });
    expect(unresolved.criterionEvaluations[0]?.outcome).toBe("unresolved");
  });

  it("requires every obligation subject and rejects missing subjects", () => {
    const revision = revisionFor(
      [{ id: "obligation-1", symbol: "Check.Main", subjectPaths: ["src/Main.dfy", "src/Helper.dfy"] }],
      [{ criterionId: "criterion-1", obligationIds: ["obligation-1"] }],
    );
    const candidate = candidateFor(revision);
    const subjects = [{ path: "src/Main.dfy", contentDigest: sha("s") }];
    const value = evaluateBoundedWorkAssurance({
      revision,
      candidate,
      candidateSubjects: candidateSubjectsFor(candidate, subjects),
      candidateEvidence: [evidenceFor(candidate, [{ symbol: "Check.Main", outcome: "proved" }], subjects, "call-missing")],
      evaluatedAt: "2026-08-20T12:03:00.000Z",
    });

    expect(value.obligationEvaluations[0]?.outcome).toBe("unresolved");
  });

  it("rejects an extra verifier subject whose digest is stale", () => {
    const revision = revisionFor(
      [{ id: "obligation-1", symbol: "Check.Main", subjectPaths: ["src/Main.dfy"] }],
      [{ criterionId: "criterion-1", obligationIds: ["obligation-1"] }],
    );
    const candidate = candidateFor(revision);
    const candidateSubjects = [{ path: "src/Main.dfy", contentDigest: sha("s") }];
    const evidenceSubjects = [...candidateSubjects, { path: "src/Stale.dfy", contentDigest: sha("wrong") }];
    const value = evaluateBoundedWorkAssurance({
      revision,
      candidate,
      candidateSubjects: candidateSubjectsFor(candidate, candidateSubjects),
      candidateEvidence: [evidenceFor(candidate, [{ symbol: "Check.Main", outcome: "proved" }], evidenceSubjects, "call-stale-subject")],
      evaluatedAt: "2026-08-20T12:03:00.000Z",
    });

    expect(value.obligationEvaluations[0]?.outcome).toBe("unresolved");
  });

  it("throws when the subject map belongs to another candidate content digest", () => {
    const revision = revisionFor(
      [{ id: "obligation-1", symbol: "Check.Main", subjectPaths: ["src/Main.dfy"] }],
      [{ criterionId: "criterion-1", obligationIds: ["obligation-1"] }],
    );
    const candidate = candidateFor(revision);

    expect(() => evaluateBoundedWorkAssurance({
      revision,
      candidate,
      candidateSubjects: { candidateContentDigest: sha("other"), digests: new Map() },
      candidateEvidence: [],
      evaluatedAt: "2026-08-20T12:03:00.000Z",
    })).toThrow(/candidateContentDigest/u);
  });

  it("does not credit evidence from a different candidate lineage", () => {
    const revision = revisionFor(
      [{ id: "obligation-1", symbol: "Check.Main", subjectPaths: ["src/Main.dfy"] }],
      [{ criterionId: "criterion-1", obligationIds: ["obligation-1"] }],
    );
    const candidate = candidateFor(revision);
    const subjects = [{ path: "src/Main.dfy", contentDigest: sha("s") }];
    const foreignCandidate = createBoundedWorkCandidate({
      goalRunId: candidate.goalRunId,
      workItemId: candidate.workItemId,
      contractRevisionDigest: candidate.contractRevisionDigest,
      accountingLineageId: "foreign-lineage",
      kind: candidate.kind,
      baseline: candidate.baseline,
      candidateContentDigest: candidate.candidateContentDigest,
      createdAt: candidate.createdAt,
    });
    const value = evaluateBoundedWorkAssurance({
      revision,
      candidate,
      candidateSubjects: candidateSubjectsFor(candidate, subjects),
      candidateEvidence: [evidenceFor(foreignCandidate, [{ symbol: "Check.Main", outcome: "proved" }], subjects, "call-foreign")],
      evaluatedAt: "2026-08-20T12:03:00.000Z",
    });

    expect(value.obligationEvaluations[0]).toMatchObject({ outcome: "unresolved", evidenceRecordDigests: [] });
    expect(value.consideredEvidenceRecordDigests).toEqual([]);
  });

  it("rejects a tampered evaluation digest through the strict parser", () => {
    const value = evaluate({});

    expect(() => parseBoundedWorkAssuranceEvaluation({ ...value, evaluationDigest: sha("tampered") })).toThrow(/evaluationDigest/u);
    expect(() => parseBoundedWorkAssuranceEvaluation({ ...value, unexpected: true })).toThrow();

    const forged = {
      ...value,
      criterionEvaluations: [{
        ...value.criterionEvaluations[0]!,
        outcome: "unresolved" as const,
      }],
    };
    expect(() => parseBoundedWorkAssuranceEvaluation({
      ...forged,
      evaluationDigest: boundedWorkDigest({ ...forged, evaluationDigest: undefined }),
    })).toThrow(/allOf obligations/u);
  });
});
