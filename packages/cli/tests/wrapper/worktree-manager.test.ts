import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const fixtures: string[] = [];
let activeTestFixture: ReturnType<typeof privateWorktreeFixture>;

beforeEach(() => {
  activeTestFixture = privateWorktreeFixture("unit");
});

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function privateWorktreeFixture(label: string): {
  root: string;
  privateStateRoot: string;
  baseDir: string;
  repoRoot: string;
} {
  const root = mkdtempSync(join(tmpdir(), `kiln-worktree-manager-${label}-`));
  fixtures.push(root);
  const privateStateRoot = join(root, "state");
  const baseDir = join(privateStateRoot, "tmp", "worktrees");
  const repoRoot = join(root, "repo");
  mkdirSync(baseDir, { recursive: true });
  mkdirSync(repoRoot, { recursive: true });
  return { root, privateStateRoot, baseDir, repoRoot };
}

function configuredManager(runner: GitRunner): WorktreeManager {
  return new WorktreeManager(
    activeTestFixture.repoRoot,
    activeTestFixture.baseDir,
    runner,
    activeTestFixture.privateStateRoot,
  );
}

function createJunction(target: string, linkPath: string): void {
  try {
    symlinkSync(target, linkPath, "junction");
  } catch {
    // The Windows-specific adversarial cases are skipped on hosts without
    // junction support; the lexical cases remain portable.
    throw new Error("junctions are unavailable");
  }
}

describe("WorktreeManager", () => {
  describe("allocate()", () => {
    it("calls git worktree add with resolved path, -b flag, and correct cwd", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(activeTestFixture.baseDir, "the", "worktree"), "refs/heads/kiln/session-abc-1") },
      ]);

      const manager = configuredManager(runner);
      await manager.allocate("session-abc");

      const addCall = calls[0]!;
      expect(addCall.args.slice(0, 3)).toEqual([
        "worktree",
        "add",
        join(activeTestFixture.baseDir, "session-abc"),
      ]);
      expect(addCall.args).toContain("-b");
      expect(addCall.args[addCall.args.length - 1]).toMatch(/^kiln\/session-abc-\d+$/);
      expect(addCall.cwd).toBe(activeTestFixture.repoRoot);
    });

    it("stores verbatim path from git list output", async () => {
      const mockedNow = vi.spyOn(Date, "now").mockReturnValue(1234567890);
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-x-${timestamp}`;
      const { runner } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(activeTestFixture.baseDir, "real", "git", "worktree", "path"), branch) },
      ]);

      const manager = configuredManager(runner);
      const handle = await manager.allocate("session-x");

      expect(handle.path).toBe(join(activeTestFixture.baseDir, "real", "git", "worktree", "path"));
      mockedNow.mockRestore();
    });

    it("falls back to input path when list output has no matching branch", async () => {
      const { runner } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry("/different/path", "refs/heads/other-branch") },
      ]);

      const manager = configuredManager(runner);
      const handle = await manager.allocate("session-y");

      expect(handle.path).toBe(join(activeTestFixture.baseDir, "session-y"));
    });

    it("throws WorktreeError when git worktree add fails", async () => {
      const { runner } = makeFakeRunner([
        { exitCode: 128, stderr: "fatal: path exists" },
      ]);

      const manager = configuredManager(runner);
      await expect(manager.allocate("session-fail")).rejects.toBeInstanceOf(WorktreeError);
    });

    it("calls git worktree list after add to get verbatim path", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(activeTestFixture.baseDir, "some", "worktree"), "refs/heads/kiln/s-5") },
      ]);

      const manager = configuredManager(runner);
      await manager.allocate("s");

      expect(calls).toHaveLength(2);
      expect(calls[1]!.args).toEqual(["worktree", "list", "--porcelain"]);
    });
  });

  describe("release()", () => {
    it("calls git worktree remove with handle.path and cwd = repoRoot", async () => {
      const mockedNow = vi.spyOn(Date, "now").mockReturnValue(1234567890);
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-r-${timestamp}`;
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(activeTestFixture.baseDir, "the", "verbatim", "path"), branch) },
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = configuredManager(runner);
      const handle = await manager.allocate("session-r");
      await manager.release(handle.sessionId);

      const removeCall = calls.find((c) => c.args.includes("remove"))!;
      expect(removeCall.args).toContain(join(activeTestFixture.baseDir, "the", "verbatim", "path"));
      expect(removeCall.cwd).toBe(activeTestFixture.repoRoot);
      mockedNow.mockRestore();
    });

    it("calls git branch -D with the correct branch name", async () => {
      const mockedNow = vi.spyOn(Date, "now").mockReturnValue(1234567890);
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-b-${timestamp}`;
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(activeTestFixture.baseDir, "p"), branch) },
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = configuredManager(runner);
      const handle = await manager.allocate("session-b");
      await manager.release(handle.sessionId);

      const branchCall = calls.find((c) => c.args.includes("-D"))!;
      expect(branchCall.args).toContain(handle.branch);
      expect(branchCall.cwd).toBe(activeTestFixture.repoRoot);
      mockedNow.mockRestore();
    });

    it("does not throw when session not in registry", async () => {
      const { runner } = makeFakeRunner([]);
      const manager = configuredManager(runner);
      await expect(manager.release("nonexistent")).resolves.toBeUndefined();
    });

    it("removes session from registry so second release is no-op", async () => {
      const mockedNow = vi.spyOn(Date, "now").mockReturnValue(1234567890);
      const timestamp = Date.now();
      const branch = `refs/heads/kiln/session-reg-${timestamp}`;
      const { runner } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(activeTestFixture.baseDir, "p"), branch) },
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = configuredManager(runner);
      const handle = await manager.allocate("session-reg");
      await manager.release(handle.sessionId);
      await expect(manager.release(handle.sessionId)).resolves.toBeUndefined();
      mockedNow.mockRestore();
    });

  });

  describe("pruneStale()", () => {
    it("never throws even when git fails", async () => {
      const { runner } = makeFakeRunner([
        { exitCode: 128 },
        { exitCode: 128 },
      ]);

      const manager = configuredManager(runner);
      await expect(manager.pruneStale()).resolves.toBeUndefined();
    });

    it("calls git worktree prune", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: "" },
      ]);

      const manager = configuredManager(runner);
      await manager.pruneStale();

      expect(calls.some((c) => c.args.includes("prune"))).toBe(true);
      expect(calls[0]!.cwd).toBe(activeTestFixture.repoRoot);
    });

    it("deletes kiln/session-* orphan branches", async () => {
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: "kiln/session-old-1\nkiln/session-old-2\n" },
        { stdout: "", exitCode: 1 },
        { stdout: "", exitCode: 1 },
      ]);

      const manager = configuredManager(runner);
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
            gitPorcelainEntry(join(activeTestFixture.baseDir, "abc"), "refs/heads/kiln/session-abc-123"),
            gitPorcelainEntry(activeTestFixture.repoRoot, "refs/heads/main"),
            gitPorcelainEntry(join(activeTestFixture.baseDir, "xyz"), "refs/heads/kiln/session-xyz-456"),
          ].join(""),
        },
      ]);

      const manager = configuredManager(runner);
      const handles = await manager.list();

      expect(handles).toHaveLength(2);
      const paths = handles.map((h) => h.path);
      expect(paths).toContain(join(activeTestFixture.baseDir, "abc"));
      expect(paths).toContain(join(activeTestFixture.baseDir, "xyz"));
      const ids = handles.map((h) => h.sessionId);
      expect(ids).toContain("abc");
      expect(ids).toContain("xyz");
    });

    it("ignores non-kiln worktrees", async () => {
      const { runner } = makeFakeRunner([
        {
          stdout: gitPorcelainEntry(activeTestFixture.repoRoot, "refs/heads/main"),
        },
      ]);

      const manager = configuredManager(runner);
      const handles = await manager.list();

      expect(handles).toHaveLength(0);
    });

    it("returns empty array when git returns empty output", async () => {
      const { runner } = makeFakeRunner([{ stdout: "" }]);

      const manager = configuredManager(runner);
      const handles = await manager.list();

      expect(handles).toHaveLength(0);
    });
  });

  describe("private worktree containment", () => {
    it("rejects a Git-returned worktree outside the private base before exposing a handle", async () => {
      const fixture = privateWorktreeFixture("returned-escape");
      const external = join(fixture.root, "external");
      mkdirSync(external, { recursive: true });
      const sentinel = join(external, "sentinel.txt");
      writeFileSync(sentinel, "untouched", "utf8");
      const branch = "refs/heads/kiln/session-external-123";
      const mockedNow = vi.spyOn(Date, "now").mockReturnValue(123);
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(external, branch) },
      ]);

      const manager = new WorktreeManager(
        fixture.repoRoot,
        fixture.baseDir,
        runner,
        fixture.privateStateRoot,
      );

      try {
        await expect(manager.allocate("session-external")).rejects.toThrow(/escapes/iu);
        expect(calls.filter((call) => call.args.includes("remove"))).toHaveLength(0);
        expect(readFileSync(sentinel, "utf8")).toBe("untouched");
      } finally {
        mockedNow.mockRestore();
      }
    });

    it("rejects an external Git worktree from list before returning a disposable handle", async () => {
      const fixture = privateWorktreeFixture("list-escape");
      const external = join(fixture.root, "external");
      mkdirSync(external, { recursive: true });
      const sentinel = join(external, "sentinel.txt");
      writeFileSync(sentinel, "untouched", "utf8");
      const { runner, calls } = makeFakeRunner([{
        stdout: gitPorcelainEntry(external, "refs/heads/kiln/session-external-123"),
      }]);
      const manager = new WorktreeManager(
        fixture.repoRoot,
        fixture.baseDir,
        runner,
        fixture.privateStateRoot,
      );

      await expect(manager.list()).rejects.toThrow(/escapes/iu);
      expect(calls.filter((call) => call.args.includes("remove"))).toHaveLength(0);
      expect(readFileSync(sentinel, "utf8")).toBe("untouched");
    });

    it("rejects a Git-returned worktree redirected through a Windows junction", async () => {
      const fixture = privateWorktreeFixture("returned-junction");
      const external = join(fixture.root, "external");
      mkdirSync(external, { recursive: true });
      const sentinel = join(external, "sentinel.txt");
      writeFileSync(sentinel, "untouched", "utf8");
      const returnedPath = join(fixture.baseDir, "session-junction");
      const branch = "refs/heads/kiln/session-junction-123";
      try {
        const probe = join(fixture.root, "junction-probe");
        createJunction(external, probe);
        rmSync(probe, { force: true });
      } catch {
        return;
      }
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(returnedPath, branch) },
      ]);
      const swappingRunner: GitRunner = {
        exec: async (args, cwd) => {
          if (args[0] === "worktree" && args[1] === "add") {
            try {
              createJunction(external, returnedPath);
            } catch { /* capability was checked above */ }
          }
          return runner.exec(args, cwd);
        },
      };

      const manager = new WorktreeManager(
        fixture.repoRoot,
        fixture.baseDir,
        swappingRunner,
        fixture.privateStateRoot,
      );

      await expect(manager.allocate("session-junction")).rejects.toThrow(/unsafe|physical|escapes/iu);
      expect(calls.filter((call) => call.args.includes("remove"))).toHaveLength(0);
      expect(readFileSync(sentinel, "utf8")).toBe("untouched");
    });

    it("revalidates the base directory before release after it is swapped to a junction", async () => {
      const fixture = privateWorktreeFixture("base-swap");
      const external = join(fixture.root, "external");
      mkdirSync(external, { recursive: true });
      const sentinel = join(external, "sentinel.txt");
      writeFileSync(sentinel, "untouched", "utf8");
      const branch = "refs/heads/kiln/session-swap-123";
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(join(fixture.baseDir, "session-swap"), branch) },
      ]);

      const manager = new WorktreeManager(
        fixture.repoRoot,
        fixture.baseDir,
        runner,
        fixture.privateStateRoot,
      );
      const handle = await manager.allocate("session-swap");

      rmSync(fixture.baseDir, { recursive: true, force: true });
      try {
        createJunction(external, fixture.baseDir);
      } catch {
        return;
      }

      await expect(manager.release(handle.sessionId)).rejects.toThrow(/unsafe|private state|canonical/iu);
      expect(calls.filter((call) => call.args.includes("remove"))).toHaveLength(0);
      expect(readFileSync(sentinel, "utf8")).toBe("untouched");
    });

    it("revalidates a registered worktree target before removal after target junction replacement", async () => {
      const fixture = privateWorktreeFixture("target-swap");
      const external = join(fixture.root, "external");
      mkdirSync(external, { recursive: true });
      const sentinel = join(external, "sentinel.txt");
      writeFileSync(sentinel, "untouched", "utf8");
      const target = join(fixture.baseDir, "session-target");
      const branch = "refs/heads/kiln/session-target-123";
      try {
        const probe = join(fixture.root, "junction-probe");
        createJunction(external, probe);
        rmSync(probe, { force: true });
      } catch {
        return;
      }
      const mockedNow = vi.spyOn(Date, "now").mockReturnValue(123);
      const { runner, calls } = makeFakeRunner([
        { stdout: "" },
        { stdout: gitPorcelainEntry(target, branch) },
      ]);
      const manager = new WorktreeManager(
        fixture.repoRoot,
        fixture.baseDir,
        runner,
        fixture.privateStateRoot,
      );

      try {
        const handle = await manager.allocate("session-target");
        createJunction(external, target);
        await expect(manager.release(handle.sessionId)).rejects.toThrow(/unsafe|physical|escapes/iu);
        expect(calls.filter((call) => call.args.includes("remove"))).toHaveLength(0);
        expect(readFileSync(sentinel, "utf8")).toBe("untouched");
      } finally {
        mockedNow.mockRestore();
      }
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

  describe("unconfigured managers", () => {
    it("fails closed when a configured manager omits canonical privateStateRoot", async () => {
      const { runner, calls } = makeFakeRunner([]);
      const manager = new WorktreeManager(
        activeTestFixture.repoRoot,
        activeTestFixture.baseDir,
        runner,
      );

      await expect(manager.allocate("session-missing-root"))
        .rejects.toMatchObject({
          name: "WorktreeError",
          message: "Configured private worktrees require a canonical privateStateRoot.",
        });
      await expect(manager.list()).rejects.toThrow("canonical privateStateRoot");
      expect(calls).toEqual([]);
    });

    it("fail closed on allocation and never invoke git for list or prune", async () => {
      const { runner, calls } = makeFakeRunner([]);
      const manager = new WorktreeManager(undefined, undefined, runner);

      await expect(manager.allocate("session-unconfigured"))
        .rejects.toMatchObject({
          name: "WorktreeError",
          message: "Private worktree state is not configured for this registry.",
        });
      await expect(manager.list()).resolves.toEqual([]);
      await expect(manager.pruneStale()).resolves.toBeUndefined();
      expect(calls).toEqual([]);
    });
  });
});
