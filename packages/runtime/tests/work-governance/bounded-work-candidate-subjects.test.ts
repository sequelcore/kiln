import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { captureGitWorktreeCandidate } from "../../src/work-governance/bounded-work-candidate-capture.js";
import { resolveCandidateSubjectDigests } from "../../src/work-governance/bounded-work-candidate-subjects.js";

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
  const root = await mkdtemp(join(tmpdir(), "kiln-candidate-subjects-"));
  roots.push(root);
  await git(root, "init", "--quiet");
  await git(root, "config", "user.email", "test@example.invalid");
  await git(root, "config", "user.name", "Kiln test");
  await git(root, "config", "core.autocrlf", "true");
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

function sha256(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

describe("resolveCandidateSubjectDigests", () => {
  it("resolves every tracked and non-ignored untracked path to its blob content digest", async () => {
    const root = await worktree();
    await writeFile(join(root, "tracked.txt"), "edited\n");
    await writeFile(join(root, "untracked.txt"), "new\n");
    await writeFile(join(root, ".gitignore"), "ignored.txt\n");
    await writeFile(join(root, "ignored.txt"), "excluded\n");

    const captured = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (captured.status !== "captured") throw new Error("expected capture");

    const resolved = await resolveCandidateSubjectDigests({
      worktreePath: root,
      candidate: captured.candidate,
      candidateTreeObjectId: captured.snapshot.candidateTreeObjectId,
    });
    const subjects = resolved.digests;

    expect(new Set(subjects.keys())).toEqual(new Set([".gitignore", "tracked.txt", "untracked.txt"]));
    expect(subjects.get("tracked.txt")).toBe(sha256(Buffer.from("edited\n")));
    expect(subjects.get("untracked.txt")).toBe(sha256(Buffer.from("new\n")));
    expect(subjects.has("ignored.txt")).toBe(false);
  });

  it("tags the resolved map with the captured candidate's own content digest", async () => {
    const root = await worktree();
    await writeFile(join(root, "tracked.txt"), "edited\n");

    const captured = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (captured.status !== "captured") throw new Error("expected capture");

    const resolved = await resolveCandidateSubjectDigests({
      worktreePath: root,
      candidate: captured.candidate,
      candidateTreeObjectId: captured.snapshot.candidateTreeObjectId,
    });

    expect(resolved.candidateContentDigest).toBe(captured.candidate.candidateContentDigest);
  });

  it("rejects a tree object id that does not match the candidate's content digest", async () => {
    const root = await worktree();
    await writeFile(join(root, "tracked.txt"), "edited\n");
    const captured = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (captured.status !== "captured") throw new Error("expected capture");

    const baselineTreeObjectId = captured.snapshot.baselineTreeObjectId;
    await expect(resolveCandidateSubjectDigests({
      worktreePath: root,
      candidate: captured.candidate,
      candidateTreeObjectId: baselineTreeObjectId,
    })).rejects.toThrow(/does not match/u);
  });

  it("survives a path containing a space and a path containing non-ASCII characters", async () => {
    const root = await worktree();
    await mkdir(join(root, "dir with space"), { recursive: true });
    await writeFile(join(root, "dir with space", "file.txt"), "spaced\n");
    await writeFile(join(root, "über.txt"), "unicode\n");

    const captured = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (captured.status !== "captured") throw new Error("expected capture");

    const resolved = await resolveCandidateSubjectDigests({
      worktreePath: root,
      candidate: captured.candidate,
      candidateTreeObjectId: captured.snapshot.candidateTreeObjectId,
    });
    const subjects = resolved.digests;

    expect(subjects.get("dir with space/file.txt")).toBe(sha256(Buffer.from("spaced\n")));
    expect(subjects.get("über.txt")).toBe(sha256(Buffer.from("unicode\n")));
  });

  it("digests a CRLF file's Git blob bytes, not its on-disk bytes", async () => {
    const root = await worktree();
    await writeFile(join(root, "crlf.txt"), "line one\r\nline two\r\n");

    const captured = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (captured.status !== "captured") throw new Error("expected capture");

    const resolved = await resolveCandidateSubjectDigests({
      worktreePath: root,
      candidate: captured.candidate,
      candidateTreeObjectId: captured.snapshot.candidateTreeObjectId,
    });
    const subjects = resolved.digests;

    const onDiskDigest = sha256(Buffer.from("line one\r\nline two\r\n"));
    const blobDigest = sha256(Buffer.from("line one\nline two\n"));
    expect(subjects.get("crlf.txt")).toBe(blobDigest);
    expect(subjects.get("crlf.txt")).not.toBe(onDiskDigest);
  });

  it("emits nested subdirectory paths with forward slashes", async () => {
    const root = await worktree();
    await mkdir(join(root, "a", "b"), { recursive: true });
    await writeFile(join(root, "a", "b", "nested.txt"), "nested\n");

    const captured = await captureGitWorktreeCandidate({ ...identity(), worktreePath: root });
    if (captured.status !== "captured") throw new Error("expected capture");

    const resolved = await resolveCandidateSubjectDigests({
      worktreePath: root,
      candidate: captured.candidate,
      candidateTreeObjectId: captured.snapshot.candidateTreeObjectId,
    });
    const subjects = resolved.digests;

    expect(subjects.has("a/b/nested.txt")).toBe(true);
  });
});
