import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { execFileSyncMock, spawnMock, spawnSyncMock } = vi.hoisted(() => ({
  execFileSyncMock: vi.fn(() => "opencode 1.2.3"),
  spawnMock: vi.fn(),
  spawnSyncMock: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  execFileSync: execFileSyncMock,
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

import { HookExecutor } from "../../src/wrapper/hook-executor.js";
import { OpenCodeSession } from "../../src/wrapper/opencode-session.js";
import { WorktreeManager } from "../../src/wrapper/worktree-manager.js";

function childProcess(): EventEmitter & {
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly killed: boolean;
  readonly kill: ReturnType<typeof vi.fn>;
  readonly unref: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as EventEmitter & {
    readonly stdout: EventEmitter;
    readonly stderr: EventEmitter;
    readonly killed: boolean;
    readonly kill: ReturnType<typeof vi.fn>;
    readonly unref: ReturnType<typeof vi.fn>;
  };
  Object.assign(child, {
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    killed: false,
    kill: vi.fn(),
    unref: vi.fn(),
  });
  return child;
}

describe("CLI child process visibility options", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("hides synchronous and asynchronous hook consoles while preserving results", async () => {
    spawnSyncMock.mockReturnValueOnce({ status: 7, stdout: "out", stderr: "err" });
    const executor = new HookExecutor();
    const sync = await executor.run(
      [
        {
          type: "command",
          command: "hook-command",
        },
      ],
      {
        event: "PreToolUse",
        workingDirectory: process.cwd(),
      },
    );

    expect(sync[0]).toMatchObject({ exitCode: 7, stdout: "out", stderr: "err" });
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "hook-command",
      [],
      expect.objectContaining({ shell: true, windowsHide: true }),
    );

    const child = childProcess();
    spawnMock.mockReturnValueOnce(child);
    const asyncResult = await executor.run(
      [
        {
          type: "command",
          command: "async-hook",
          async: true,
        },
      ],
      {
        event: "PostToolUse",
        workingDirectory: process.cwd(),
      },
    );

    expect(asyncResult[0]).toMatchObject({ exitCode: 0, timedOut: false });
    expect(spawnMock).toHaveBeenCalledWith(
      "async-hook",
      [],
      expect.objectContaining({ detached: true, shell: true, windowsHide: true }),
    );
  });

  it("hides the default Git worktree runner console", async () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-process-options-"));
    const privateStateRoot = join(root, "state");
    const baseDir = join(privateStateRoot, "worktrees");
    const repoRoot = join(root, "repo");
    mkdirSync(baseDir, { recursive: true });
    mkdirSync(repoRoot, { recursive: true });
    spawnMock.mockImplementation(() => {
      const child = childProcess();
      queueMicrotask(() => child.emit("close", 0));
      return child;
    });

    try {
      await new WorktreeManager(repoRoot, baseDir, undefined, privateStateRoot).pruneStale();
      expect(spawnMock).toHaveBeenCalledWith(
        "git",
        ["worktree", "prune"],
        expect.objectContaining({ cwd: repoRoot, windowsHide: true }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("hides OpenCode serve and bound version probe consoles", async () => {
    const child = childProcess();
    spawnMock.mockImplementationOnce(() => {
      queueMicrotask(() => child.stdout.emit("data", Buffer.from("listening on http://127.0.0.1:4321")));
      return child;
    });
    const session = new OpenCodeSession({
      cwd: process.cwd(),
      task: "test",
      harnessExecutable: "opencode.exe",
      harnessEvidence: { executable: "opencode.exe", version: "1.2.3" },
    });

    await expect(session.spawnAndWaitForServe(4321, process.cwd())).resolves.toBe(4321);
    expect(execFileSyncMock).toHaveBeenCalledWith(
      "opencode.exe",
      ["--version"],
      expect.objectContaining({ windowsHide: true }),
    );

    expect(spawnMock).toHaveBeenCalledWith(
      "opencode.exe",
      ["serve", "--port", "4321"],
      expect.objectContaining({ cwd: process.cwd(), windowsHide: true }),
    );
    await session.dispose();
  });
});
