import type { BoundedWorkCandidateIdentity, CandidateSubjectDigests } from "@kilnai/core/work-governance";
import { digestContent, git, gitTreeContentDigest } from "./git-object-access.js";

export interface ResolveCandidateSubjectDigestsInput {
  readonly worktreePath: string;
  readonly candidate: BoundedWorkCandidateIdentity;
  readonly candidateTreeObjectId: string;
}

/**
 * Resolves the content digest of every path a captured Git-worktree
 * candidate contains, keyed by candidate-relative POSIX path. This is what
 * lets a formal-proof verdict's coverage set be checked against a candidate:
 * the verdict names paths and the digest each had when verified, and binding
 * compares those against what this function reports the candidate holds now.
 *
 * Digests are taken over the candidate's Git blob bytes, not over working-tree
 * file bytes read from disk. This repository runs with `core.autocrlf=true`,
 * so for a CRLF text file those two byte sequences differ. Binding is a claim
 * about the candidate — the immutable tree `captureGitWorktreeCandidate`
 * produced — not about whatever currently sits on disk, so coverage must be
 * expressed in the candidate's terms. Reading from disk here would silently
 * change what "the same content" means between recording and binding, and
 * would break the staleness property capture relies on (an edit that changes
 * blob bytes must invalidate coverage; a checkout-only difference must not).
 * Do not "fix" this to read the working tree.
 *
 * The returned `CandidateSubjectDigests.candidateContentDigest` tags the map
 * with the candidate it was resolved from. That field and the fail-closed
 * check below split one guarantee across two places, and neither is
 * redundant: `candidateContentDigest` is what lets a consumer refuse a map
 * resolved from candidate A being checked against candidate B (the *claim*
 * of which candidate a map describes); the check below is what makes that
 * claim true rather than merely asserted, by recomputing the digest from the
 * tree object instead of copying it from the input uninspected. Do not drop
 * either on the grounds that the other makes it look unnecessary.
 */
export async function resolveCandidateSubjectDigests(
  input: ResolveCandidateSubjectDigestsInput,
): Promise<CandidateSubjectDigests> {
  const { worktreePath, candidate, candidateTreeObjectId } = input;

  // Fail closed on a tree that is not the candidate's: without this, the
  // caller could hand any tree object id and have its paths credited to a
  // candidate that never contained them.
  const observedDigest = await gitTreeContentDigest(worktreePath, candidateTreeObjectId);
  if (observedDigest !== candidate.candidateContentDigest) {
    throw new Error("candidate tree object does not match the candidate's content digest");
  }

  const listing = await git(worktreePath, ["ls-tree", "-r", "-z", candidateTreeObjectId]);
  const entries = splitNulSeparated(listing);

  const subjects = new Map<string, string>();
  for (const entry of entries) {
    const { mode, type, objectId, path } = parseTreeEntry(entry);
    if (type === "commit" || mode === "160000") {
      // Capture already refuses candidates containing gitlinks, so a gitlink
      // reaching here means the tree is not what capture would have produced.
      throw new Error(`candidate tree contains a gitlink at "${path}", which capture should have refused`);
    }
    if (type !== "blob") {
      throw new Error(`candidate tree contains unsupported entry type "${type}" at "${path}"`);
    }
    const blob = await git(worktreePath, ["cat-file", "blob", objectId]);
    subjects.set(path, digestContent(blob));
  }
  return { candidateContentDigest: observedDigest, digests: subjects };
}

function splitNulSeparated(buffer: Buffer): readonly string[] {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter((entry) => entry.length > 0);
}

function parseTreeEntry(entry: string): { mode: string; type: string; objectId: string; path: string } {
  const tabIndex = entry.indexOf("\t");
  if (tabIndex === -1) throw new Error(`malformed git ls-tree entry: "${entry}"`);
  const [mode, type, objectId] = entry.slice(0, tabIndex).split(" ");
  const path = entry.slice(tabIndex + 1);
  if (!mode || !type || !objectId) throw new Error(`malformed git ls-tree entry: "${entry}"`);
  return { mode, type, objectId, path };
}
