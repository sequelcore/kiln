import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { WorktreeManager, WorktreeError, type GitRunner } from "../../src/wrapper/worktree-manager.js";

interface GitCall {
  args: string[];
  cwd: string;
}

function makeFakeRunner(
  responses: Array<{
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }>,
): { runner: GitRunner; calls: GitCall[] } {
  const calls: GitCall[] = [];
  let callIdx = 0;

  return {
    runner: {
      exec: (args, cwd) => {
        calls.push({ args, cwd });
        const response = responses[callIdx] ?? { stdout: "", exitCode: 0 };
        callIdx++;
        return Promise.resolve({
          stdout: response.stdout ?? "",
          stderr: response.stderr ?? "",
          exitCode: response.exitCode ?? 0,
        });
      },
    },
    calls,
  };
}

function gitPorcelainEntry(worktreePath: string, branch: string): string {
  return `worktree ${worktreePath}\nbranch ${branch}\n\n`;
}

describe("WorktreeManager", () => {
  describe("allocate()", () => {
    it("calls git worktree add with resolved path, -b flag, and correct cwd", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/the/worktree", "refs/heads/kiln/session-abc-1") },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      await manager.allocate("session-abc");

      const addCall = calls[0]!;
      expect(addCall.args.slice(0, 3)).toEqual([
        "worktree",
        "add",
        resolve("/repo", ".kiln-worktrees", "session-abc"),
      ]);
      expect(addCall.args).toContain("-b");
      expect(addCall.args[addCall.args.length - 1]).toMatch(/^kiln\/session-abc-\d+$/);
      expect(addCall.cwd).toBe("/repo");
    });

    it("stores verbatim path from git list output", async () => {
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-x-${timestamp}`;
      const { runner } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/real/git/worktree/path", branch) },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handle = await manager.allocate("session-x");

      expect(handle.path).toBe("/real/git/worktree/path");
    });

    it("falls back to input path when list output has no matching branch", async () => {
      const { runner } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/different/path", "refs/heads/other-branch") },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handle = await manager.allocate("session-y");

      expect(handle.path).toBe(resolve("/repo", ".kiln-worktrees", "session-y"));
    });

    it("throws WorktreeError when git worktree add fails", async () => {
      const { runner } = makeFakeRunner([
        { exitCode: 128, stderr: "fatal: path exists" },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      await expect(manager.allocate("session-fail")).rejects.toBeInstanceOf(WorktreeError);
    });

    it("calls git worktree list after add to get verbatim path", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/some/worktree", "refs/heads/kiln/s-5") },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      await manager.allocate("s");

      expect(calls).toHaveLength(2);
      expect(calls[1]!.args).toEqual(["worktree", "list", "--porcelain"]);
    });
  });

  describe("release()", () => {
    it("calls git worktree remove with handle.path and cwd = repoRoot", async () => {
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-r-${timestamp}`;
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/the/verbatim/path", branch) },
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handle = await manager.allocate("session-r");
      await manager.release(handle.sessionId);

      const removeCall = calls.find((c) => c.args.includes("remove"))!;
      expect(removeCall.args).toContain("/the/verbatim/path");
      expect(removeCall.cwd).toBe("/repo");
    });

    it("calls git branch -D with the correct branch name", async () => {
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-b-${timestamp}`;
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/p", branch) },
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handle = await manager.allocate("session-b");
      await manager.release(handle.sessionId);

      const branchCall = calls.find((c) => c.args.includes("-D"))!;
      expect(branchCall.args).toContain(handle.branch);
      expect(branchCall.cwd).toBe("/repo");
    });

    it("does not throw when session not in registry", async () => {
      const { runner } = makeFakeRunner([]);
      const manager = new WorktreeManager("/repo", runner);
      await expect(manager.release("nonexistent")).resolves.toBeUndefined();
    });

    it("removes session from registry so second release is no-op", async () => {
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-reg-${timestamp}`;
      const { runner } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/p", branch) },
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handle = await manager.allocate("session-reg");
      await manager.release(handle.sessionId);
      await expect(manager.release(handle.sessionId)).resolves.toBeUndefined();
    });
  });

  describe("pruneStale()", () => {
    it("never throws even when git fails", async () => {
      const { runner } = makeFakeRunner([
        { exitCode: 128 },
        { exitCode: 128 },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      await expect(manager.pruneStale()).resolves.toBeUndefined();
    });

    it("calls git worktree prune", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      await manager.pruneStale();

      expect(calls.some((c) => c.args.includes("prune"))).toBe(true);
      expect(calls[0]!.cwd).toBe("/repo");
    });

    it("deletes kiln/session-* orphan branches", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: "kiln/session-old-1\nkiln/session-old-2\n" },
        { stdout: "", exitCode: 1 },
        { stdout: "", exitCode: 1 },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      await manager.pruneStale();

      const branchCalls = calls.filter(
        (c) => c.args.includes("branch") && c.args.includes("-D"),
      );
      expect(branchCalls).toHaveLength(2);
      expect(branchCalls[0]!.args).toContain("kiln/session-old-1");
      expect(branchCalls[1]!.args).toContain("kiln/session-old-2");
    });
  });

  describe("list()", () => {
    it("returns kiln/session-* entries with verbatim paths and sessionIds", async () => {
      const { runner } = makeFakeRunner([
        {
          stdout: [
            gitPorcelainEntry("/worktrees/abc", "refs/heads/kiln/session-abc-123"),
            gitPorcelainEntry("/repo", "refs/heads/main"),
            gitPorcelainEntry("/worktrees/xyz", "refs/heads/kiln/session-xyz-456"),
          ].join(""),
        },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handles = await manager.list();

      expect(handles).toHaveLength(2);
      const paths = handles.map((h) => h.path);
      expect(paths).toContain("/worktrees/abc");
      expect(paths).toContain("/worktrees/xyz");
      const ids = handles.map((h) => h.sessionId);
      expect(ids).toContain("abc");
      expect(ids).toContain("xyz");
    });

    it("ignores non-kiln worktrees", async () => {
      const { runner } = makeFakeRunner([
        {
          stdout: gitPorcelainEntry("/repo", "refs/heads/main"),
        },
      ]);

      const manager = new WorktreeManager("/repo", runner);
      const handles = await manager.list();

      expect(handles).toHaveLength(0);
    });

    it("returns empty array when git returns empty output", async () => {
      const { runner } = makeFakeRunner([{ stdout: "" }]);

      const manager = new WorktreeManager("/repo", runner);
      const handles = await manager.list();

      expect(handles).toHaveLength(0);
    });
  });

  describe("WorktreeError", () => {
    it("captures stdout and stderr fields", () => {
      const err = new WorktreeError("git failed", "out", "err");
      expect(err.stdout).toBe("out");
      expect(err.stderr).toBe("err");
      expect(err.message).toBe("git failed");
      expect(err.name).toBe("WorktreeError");
    });
  });
});
