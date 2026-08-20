import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createBoundedWorkCandidate,
  type BoundedWorkCandidateIdentity,
  type CreateBoundedWorkCandidateInput,
} from "@kilnai/core";
import { digestContent, gitText, gitTreeContentDigest } from "./git-object-access.js";

type CandidateIdentityInput = Omit<
  CreateBoundedWorkCandidateInput,
  "kind" | "baseline" | "candidateContentDigest"
>;

export type GitWorktreeCaptureFailureReason =
  | "git_repository_unavailable"
  | "git_baseline_unavailable"
  | "git_submodules_require_explicit_capture"
  | "git_capture_unstable"
  | "git_capture_failed";

export type BoundedWorkCaptureReconciliation = Readonly<{
  status: "reconciliation_required";
  reason: GitWorktreeCaptureFailureReason | "external_state_not_immutable";
}>;

export interface CaptureGitWorktreeCandidateInput extends CandidateIdentityInput {
  readonly worktreePath: string;
}

export interface CapturedGitWorktreeCandidate {
  readonly status: "captured";
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly snapshot: Readonly<{
    readonly verification: "double_observed_git_tree";
    readonly baselineTreeObjectId: string;
    readonly candidateTreeObjectId: string;
    readonly changedFiles: number;
    readonly changedPaths: readonly string[];
    readonly changedLines: { readonly kind: "observed"; readonly value: number } | { readonly kind: "unavailable" };
  }>;
}

export type CaptureGitWorktreeCandidateResult =
  | CapturedGitWorktreeCandidate
  | BoundedWorkCaptureReconciliation;

export interface CaptureArtifactCandidateInput extends CandidateIdentityInput {
  readonly baselineContent: Uint8Array;
  readonly candidateContent: Uint8Array;
}

export interface CapturedArtifactCandidate {
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly baselineContentDigest: string;
  readonly candidateContentDigest: string;
}

export interface CaptureExternalStateCandidateInput extends CandidateIdentityInput {
  readonly baselineVersionDigest: string;
  readonly candidateVersionDigest: string;
  readonly candidateContent: Uint8Array;
  readonly consistency: "immutable_version" | "observed";
}

export type CaptureExternalStateCandidateResult =
  | Readonly<{
      status: "captured";
      candidate: BoundedWorkCandidateIdentity;
      candidateVersionDigest: string;
    }>
  | BoundedWorkCaptureReconciliation;

/**
 * Captures a Git worktree using an isolated index. The capture includes staged,
 * unstaged, deleted, and non-ignored untracked paths without modifying the
 * caller's index. Two identical tree observations are required before a
 * candidate is admitted. This is a stable observation, not a filesystem lock:
 * callers must reconcile if a stable observation cannot be obtained.
 */
export async function captureGitWorktreeCandidate(
  input: CaptureGitWorktreeCandidateInput,
): Promise<CaptureGitWorktreeCandidateResult> {
  let root: string;
  try {
    const requestedRoot = await realpath(input.worktreePath);
    root = await gitText(requestedRoot, ["rev-parse", "--show-toplevel"]);
    root = await realpath(root.trim());
    if (root !== requestedRoot) return reconciliation("git_repository_unavailable");
  } catch {
    return reconciliation("git_repository_unavailable");
  }

  try {
    if (await hasGitlinks(root)) return reconciliation("git_submodules_require_explicit_capture");
    const baselineTreeObjectId = (await gitText(root, ["rev-parse", "HEAD^{tree}"])).trim();
    const first = await materializeWorktreeTree(root);
    const second = await materializeWorktreeTree(root);
    if (first !== second) return reconciliation("git_capture_unstable");

    const [baselineDigest, candidateContentDigest] = await Promise.all([
      gitTreeContentDigest(root, baselineTreeObjectId),
      gitTreeContentDigest(root, first),
    ]);
    const changeSize = await gitChangeSize(root, baselineTreeObjectId, first);
    return {
      status: "captured",
      candidate: createBoundedWorkCandidate({
        ...identityInput(input),
        kind: "git_worktree",
        baseline: { kind: "git_tree", digest: baselineDigest },
        candidateContentDigest,
      }),
      snapshot: {
        verification: "double_observed_git_tree",
        baselineTreeObjectId,
        candidateTreeObjectId: first,
        ...changeSize,
      },
    };
  } catch (error) {
    return reconciliation(isMissingHead(error) ? "git_baseline_unavailable" : "git_capture_failed");
  }
}

async function gitChangeSize(root: string, baseline: string, candidate: string): Promise<{
  readonly changedFiles: number;
  readonly changedPaths: readonly string[];
  readonly changedLines: { readonly kind: "observed"; readonly value: number } | { readonly kind: "unavailable" };
}> {
  const output = await gitText(root, ["diff-tree", "--no-commit-id", "--numstat", "-r", baseline, candidate]);
  const rows = output.split("\n").filter((row) => row.trim().length > 0);
  const changedPaths = rows.map((row) => row.split("\t").at(-1)!).sort();
  let value = 0;
  for (const row of rows) {
    const [added, deleted] = row.split("\t");
    if (added === "-" || deleted === "-") return { changedFiles: rows.length, changedPaths, changedLines: { kind: "unavailable" } };
    value += Number(added) + Number(deleted);
  }
  return { changedFiles: rows.length, changedPaths, changedLines: { kind: "observed", value } };
}

export function captureArtifactCandidate(input: CaptureArtifactCandidateInput): CapturedArtifactCandidate {
  const baselineContentDigest = digestContent(input.baselineContent);
  const candidateContentDigest = digestContent(input.candidateContent);
  return {
    candidate: createBoundedWorkCandidate({
      ...identityInput(input),
      kind: "artifact",
      baseline: { kind: "content_snapshot", digest: baselineContentDigest },
      candidateContentDigest,
    }),
    baselineContentDigest,
    candidateContentDigest,
  };
}

export function captureExternalStateCandidate(
  input: CaptureExternalStateCandidateInput,
): CaptureExternalStateCandidateResult {
  if (input.consistency !== "immutable_version") {
    return reconciliation("external_state_not_immutable");
  }
  const candidateContentDigest = digestContent(input.candidateContent);
  return {
    status: "captured",
    candidate: createBoundedWorkCandidate({
      ...identityInput(input),
      kind: "external_state",
      baseline: { kind: "external_version", digest: input.baselineVersionDigest },
      candidateContentDigest,
    }),
    candidateVersionDigest: requireDigest(input.candidateVersionDigest, "candidateVersionDigest"),
  };
}

function identityInput(input: CandidateIdentityInput): CandidateIdentityInput {
  return {
    goalRunId: input.goalRunId,
    workItemId: input.workItemId,
    contractRevisionDigest: input.contractRevisionDigest,
    accountingLineageId: input.accountingLineageId,
    previousCandidate: input.previousCandidate,
    createdAt: input.createdAt,
  };
}

async function materializeWorktreeTree(root: string): Promise<string> {
  const indexDirectory = await mkdtemp(join(tmpdir(), "kiln-bounded-work-index-"));
  const indexPath = join(indexDirectory, "index");
  try {
    await gitText(root, ["read-tree", "HEAD"], indexPath);
    await gitText(root, ["add", "--all", "--", "."], indexPath);
    return (await gitText(root, ["write-tree"], indexPath)).trim();
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

async function hasGitlinks(root: string): Promise<boolean> {
  const entries = await gitText(root, ["ls-files", "--stage"]);
  return entries.split("\n").some((entry) => entry.startsWith("160000 "));
}

function reconciliation(reason: BoundedWorkCaptureReconciliation["reason"]): BoundedWorkCaptureReconciliation {
  return { status: "reconciliation_required", reason };
}

function requireDigest(value: string, field: string): string {
  if (!/^sha256:[a-f0-9]{64}$/u.test(value)) throw new TypeError(`${field} is invalid`);
  return value;
}

function isMissingHead(error: unknown): boolean {
  return error instanceof Error && /unknown revision|ambiguous argument|needed a single revision/iu.test(error.message);
}
