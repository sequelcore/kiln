import {
  boundedWorkDigest,
  freezeBoundedWorkValue,
  requireBoundedWorkDigest,
} from "./bounded-work-content.js";

export type BoundedWorkCandidateKind = "git_worktree" | "artifact" | "external_state";

export type BoundedWorkBaselineIdentity =
  | { readonly kind: "git_tree"; readonly digest: string }
  | { readonly kind: "content_snapshot"; readonly digest: string }
  | { readonly kind: "external_version"; readonly digest: string };

export interface CreateBoundedWorkCandidateInput {
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly contractRevisionDigest: string;
  readonly accountingLineageId: string;
  readonly kind: BoundedWorkCandidateKind;
  readonly baseline: BoundedWorkBaselineIdentity;
  readonly candidateContentDigest: string;
  readonly previousCandidate?: BoundedWorkCandidateIdentity;
  readonly createdAt: string;
}

export interface BoundedWorkCandidateIdentity {
  readonly schema: "kiln.bounded-work-candidate/v1";
  readonly goalRunId: string;
  readonly workItemId: string;
  readonly contractRevisionDigest: string;
  readonly accountingLineageId: string;
  readonly kind: BoundedWorkCandidateKind;
  readonly baseline: BoundedWorkBaselineIdentity;
  readonly candidateContentDigest: string;
  readonly previousCandidateDigest?: string;
  readonly createdAt: string;
  readonly candidateDigest: string;
}

export type BoundedWorkEvidenceKind = "verification" | "review" | "acceptance";

export interface BindBoundedWorkEvidenceInput {
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly kind: BoundedWorkEvidenceKind;
  readonly subjectCandidateDigest: string;
  readonly evidenceDigest: string;
  readonly recordedAt: string;
}

export interface BoundedWorkCandidateEvidence {
  readonly schema: "kiln.bounded-work-candidate-evidence/v1";
  readonly kind: BoundedWorkEvidenceKind;
  readonly candidateDigest: string;
  readonly candidateContentDigest: string;
  readonly contractRevisionDigest: string;
  readonly evidenceDigest: string;
  readonly recordedAt: string;
}

export function createBoundedWorkCandidate(
  input: CreateBoundedWorkCandidateInput,
): BoundedWorkCandidateIdentity {
  const contractRevisionDigest = requireBoundedWorkDigest(
    input.contractRevisionDigest,
    "contractRevisionDigest",
  );
  assertCorrectionLineage(input, contractRevisionDigest);
  const identity = {
    schema: "kiln.bounded-work-candidate/v1" as const,
    goalRunId: requireText(input.goalRunId, "goalRunId"),
    workItemId: requireText(input.workItemId, "workItemId"),
    contractRevisionDigest,
    accountingLineageId: requireText(input.accountingLineageId, "accountingLineageId"),
    kind: requireCandidateKind(input.kind),
    baseline: {
      kind: input.baseline.kind,
      digest: requireBoundedWorkDigest(input.baseline.digest, "baseline.digest"),
    },
    candidateContentDigest: requireBoundedWorkDigest(
      input.candidateContentDigest,
      "candidateContentDigest",
    ),
    ...(input.previousCandidate === undefined
      ? {}
      : {
          previousCandidateDigest: input.previousCandidate.candidateDigest,
        }),
    createdAt: requireTimestamp(input.createdAt, "createdAt"),
  };
  return freezeBoundedWorkValue({
    ...identity,
    candidateDigest: boundedWorkDigest(identity),
  });
}

function assertCorrectionLineage(
  input: CreateBoundedWorkCandidateInput,
  contractRevisionDigest: string,
): void {
  const previous = input.previousCandidate;
  if (!previous) return;
  if (previous.contractRevisionDigest !== contractRevisionDigest) {
    throw new Error("correction must remain on the same contract revision");
  }
  if (previous.accountingLineageId !== input.accountingLineageId) {
    throw new Error("correction must remain on the same accounting lineage");
  }
  if (previous.goalRunId !== input.goalRunId || previous.workItemId !== input.workItemId) {
    throw new Error("correction must remain on the same governed work item");
  }
  if (previous.candidateContentDigest === input.candidateContentDigest) {
    throw new Error("correction must change candidate content");
  }
}

export function bindBoundedWorkEvidence(
  input: BindBoundedWorkEvidenceInput,
): BoundedWorkCandidateEvidence {
  const subject = requireBoundedWorkDigest(input.subjectCandidateDigest, "subjectCandidateDigest");
  if (subject !== input.candidate.candidateDigest) {
    throw new Error("evidence subject does not match candidate");
  }
  return freezeBoundedWorkValue({
    schema: "kiln.bounded-work-candidate-evidence/v1",
    kind: requireEvidenceKind(input.kind),
    candidateDigest: input.candidate.candidateDigest,
    candidateContentDigest: input.candidate.candidateContentDigest,
    contractRevisionDigest: input.candidate.contractRevisionDigest,
    evidenceDigest: requireBoundedWorkDigest(input.evidenceDigest, "evidenceDigest"),
    recordedAt: requireTimestamp(input.recordedAt, "recordedAt"),
  });
}

function requireCandidateKind(value: BoundedWorkCandidateKind): BoundedWorkCandidateKind {
  if (value !== "git_worktree" && value !== "artifact" && value !== "external_state") {
    throw new Error("kind must be git_worktree, artifact, or external_state");
  }
  return value;
}

function requireEvidenceKind(value: BoundedWorkEvidenceKind): BoundedWorkEvidenceKind {
  if (value !== "verification" && value !== "review" && value !== "acceptance") {
    throw new Error("evidence kind must be verification, review, or acceptance");
  }
  return value;
}

function requireTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO timestamp`);
  }
  return value;
}

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new Error(`${field} is required`);
  return normalized;
}
