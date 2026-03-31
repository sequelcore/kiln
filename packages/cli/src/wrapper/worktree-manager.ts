import { spawn } from "node:child_process";
import { resolve } from "node:path";

export interface GitRunner {
  exec(args: string[], cwd: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
}

export class WorktreeError extends Error {
  constructor(
    message: string,
    public readonly stdout: string = "",
    public readonly stderr: string = "",
  ) {
    super(message);
    this.name = "WorktreeError";
  }
}

export interface WorktreeHandle {
  readonly path: string;
  readonly branch: string;
  readonly sessionId: string;
  dispose(): Promise<void>;
}

function defaultGitRunner(): GitRunner {
  return {
    exec: (args, cwd) =>
      new Promise((resolve) => {
        const proc = spawn("git", args, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data: Buffer) => {
          stdout += data.toString();
        });

        proc.stderr?.on("data", (data: Buffer) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          resolve({ stdout, stderr, exitCode: code ?? 1 });
        });

        proc.on("error", (err) => {
          resolve({ stdout, stderr: err.message, exitCode: 1 });
        });
      }),
  };
}

function parseWorktreeList(output: string): Array<{
  worktree: string;
  branch?: string;
}> {
  const entries: Array<{ worktree: string; branch?: string }> = [];
  const lines = output.split("\n").map((l) => l.trimEnd());

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("worktree ")) {
      const worktree = line.slice(9);
      const nextLine = lines[i + 1] ?? "";
      if (nextLine.startsWith("branch ")) {
        entries.push({ worktree, branch: nextLine.slice(7) });
        i++;
      } else {
        entries.push({ worktree });
      }
    }
  }
  return entries;
}

export class WorktreeManager {
  private readonly registry = new Map<string, WorktreeHandle>();
  private readonly baseDir = ".kiln-worktrees";

  constructor(
    private readonly repoRoot: string,
    private readonly runner: GitRunner = defaultGitRunner(),
  ) {}

  async allocate(sessionId: string): Promise<WorktreeHandle> {
    const branch = `kiln/${sessionId}-${Date.now()}`;
    const pathInput = resolve(this.repoRoot, this.baseDir, sessionId);

    const addResult = await this.runner.exec(
      ["worktree", "add", pathInput, "-b", branch],
      this.repoRoot,
    );

    if (addResult.exitCode !== 0) {
      throw new WorktreeError(
        `git worktree add failed`,
        addResult.stdout,
        addResult.stderr,
      );
    }

    const listResult = await this.runner.exec(
      ["worktree", "list", "--porcelain"],
      this.repoRoot,
    );

    const entries = parseWorktreeList(listResult.stdout);
    const entry = entries.find(
      (e) => e.branch === `refs/heads/${branch}`,
    );

    const handle: WorktreeHandle = {
      path: entry?.worktree ?? pathInput,
      branch,
      sessionId,
      dispose: async (): Promise<void> => {
        await this.release(sessionId);
      },
    };

    this.registry.set(sessionId, handle);
    return handle;
  }

  async release(sessionId: string): Promise<void> {
    const handle = this.registry.get(sessionId);
    if (!handle) return;

    await this.runner.exec(
      ["worktree", "remove", "--force", handle.path],
      this.repoRoot,
    );

    await this.runner.exec(
      ["branch", "-D", handle.branch],
      this.repoRoot,
    );

    this.registry.delete(sessionId);
  }

  async pruneStale(): Promise<void> {
    try {
      await this.runner.exec(["worktree", "prune"], this.repoRoot);
    } catch {
      // ignore
    }

    try {
      const branchResult = await this.runner.exec(
        ["branch", "--list", "kiln/session-*"],
        this.repoRoot,
      );

      const branchNames = branchResult.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      for (const branch of branchNames) {
        try {
          await this.runner.exec(["branch", "-D", branch], this.repoRoot);
        } catch {
          // ignore failures (worktree still exists or already deleted)
        }
      }
    } catch {
      // ignore
    }
  }

  async list(): Promise<WorktreeHandle[]> {
    const result = await this.runner.exec(
      ["worktree", "list", "--porcelain"],
      this.repoRoot,
    );

    const entries = parseWorktreeList(result.stdout);

    return entries
      .filter(
        (e): e is { worktree: string; branch: string } =>
          Boolean(e.branch?.startsWith("refs/heads/kiln/session-") && e.worktree),
      )
      .map((e) => {
        const branch = e.branch.replace("refs/heads/", "");
        const sessionId = branch.replace(/^kiln\/session-/, "").replace(/-\d+$/, "").trim();

        return {
          path: e.worktree,
          branch,
          sessionId,
          dispose: async (): Promise<void> => {
            await this.release(sessionId);
          },
        } satisfies WorktreeHandle;
      });
  }
}
