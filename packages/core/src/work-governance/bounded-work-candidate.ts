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

function requireCandidateKind(value: BoundedWorkCandidateKind): BoundedWorkCandidateKind {
  if (value !== "git_worktree" && value !== "artifact" && value !== "external_state") {
    throw new Error("kind must be git_worktree, artifact, or external_state");
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
