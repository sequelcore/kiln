import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  bindCapturedCandidateEvidence,
  captureArtifactCandidate,
  captureExternalStateCandidate,
  captureGitWorktreeCandidate,
} from "../../src/work-governance/bounded-work-candidate-capture.js";

const execFileAsync = promisify(execFile);
const roots: string[] = [];
const digest = (character: string) => `sha256:${character.repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(root: string, ...args: readonly string[]): Promise<string> {
  const result = await execFileAsync("git", [...args], { cwd: root, encoding: "utf8" });
  return result.stdout;
}

async function worktree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kiln-candidate-capture-"));
  roots.push(root);
  await git(root, "init", "--quiet");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "Kiln test");
  await writeFile(join(root, "tracked.txt"), "baseline\n");
  await git(root, "add", "tracked.txt");
  await git(root, "commit", "--quiet", "-m", "baseline");
  return root;
}

const identity = () => ({
  goalRunId: "goal-1",
  workItemId: "work-1",
  contractRevisionDigest: digest("a"),
  accountingLineageId: "goal-1",
  createdAt: "2026-08-12T00:00:00.000Z",
});

describe("bounded work candidate capture", () => {
  it("captures tracked edits and non-ignored untracked files into an immutable Git tree", async () => {
    const root = await worktree();
    await writeFile(join(root, "tracked.txt"), "edited\n");
    await writeFile(join(root, "untracked.txt"), "new\n");
    await writeFile(join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(join(root, "ignored.txt"), "excluded\n");

    const first = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    const second = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });

    expect(first).toMatchObject({ status: "captured", candidate: { kind: "git_worktree", baseline: { kind: "git_tree" } } });
    expect(second).toMatchObject({ status: "captured" });
    if (first.status !== "captured" || second.status !== "captured") throw new Error("expected capture");
    expect(first.candidate.candidateContentDigest).toBe(second.candidate.candidateContentDigest);
    expect(first.candidate.candidateContentDigest).not.toBe(first.candidate.baseline.digest);
    expect(first.snapshot.verification).toBe("double_observed_git_tree");
    expect(await git(root, "status", "--porcelain")).toContain(" M tracked.txt");

    await writeFile(join(root, "untracked.txt"), "changed\n");
    const changed = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (changed.status !== "captured") throw new Error("expected changed capture");
    expect(changed.candidate.candidateContentDigest).not.toBe(first.candidate.candidateContentDigest);
  });

  it("returns a reconciliation requirement instead of inventing a Git candidate outside a worktree", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-candidate-not-git-"));
    roots.push(root);

    await expect(captureGitWorktreeCandidate({ ...identity(), worktreePath: root })).resolves.toMatchObject({
      status: "reconciliation_required",
      reason: "git_repository_unavailable",
    });
  });

  it("binds artifact bytes and immutable external-version content, while refusing unversioned external state", () => {
    const artifact = captureArtifactCandidate({
      ...identity(),
      baselineContent: new TextEncoder().encode("before"),
      candidateContent: new TextEncoder().encode("after"),
    });
    expect(artifact.candidate.kind).toBe("artifact");
    expect(artifact.candidate.baseline.kind).toBe("content_snapshot");
    expect(artifact.candidate.candidateContentDigest).not.toBe(artifact.candidate.baseline.digest);
    expect(bindCapturedCandidateEvidence({
      candidate: artifact.candidate,
      kind: "verification",
      subjectCandidateDigest: artifact.candidate.candidateDigest,
      evidenceDigest: digest("d"),
      recordedAt: "2026-08-12T00:01:00.000Z",
    })).toMatchObject({ candidateDigest: artifact.candidate.candidateDigest });

    expect(captureExternalStateCandidate({
      ...identity(),
      baselineVersionDigest: digest("b"),
      candidateVersionDigest: digest("c"),
      candidateContent: new TextEncoder().encode("version-c"),
      consistency: "immutable_version",
    })).toMatchObject({ status: "captured", candidate: { kind: "external_state" } });
    expect(captureExternalStateCandidate({
      ...identity(),
      baselineVersionDigest: digest("b"),
      candidateVersionDigest: digest("c"),
      candidateContent: new TextEncoder().encode("version-c"),
      consistency: "observed",
    })).toEqual({ status: "reconciliation_required", reason: "external_state_not_immutable" });
  });
});
