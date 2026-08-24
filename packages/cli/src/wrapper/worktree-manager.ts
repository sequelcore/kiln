import { spawn } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { assertPrivateStateDirectoryTargetSync } from "../application/private-project-state-filesystem.js";

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

  constructor(
    private readonly repoRoot?: string,
    private readonly baseDir?: string,
    private readonly runner: GitRunner = defaultGitRunner(),
    /** Canonical private project-state root that owns baseDir. */
    private readonly privateStateRoot?: string,
  ) {}

  async allocate(sessionId: string): Promise<WorktreeHandle> {
    const { repoRoot, baseDir } = this.requireConfigured();
    const branch = `kiln/${sessionId}-${Date.now()}`;
    const pathInput = resolve(baseDir, sessionId);

    const addResult = await this.exec(
      ["worktree", "add", pathInput, "-b", branch],
      repoRoot,
      pathInput,
    );

    if (addResult.exitCode !== 0) {
      throw new WorktreeError(
        `git worktree add failed`,
        addResult.stdout,
        addResult.stderr,
      );
    }

    const listResult = await this.exec(
      ["worktree", "list", "--porcelain"],
      repoRoot,
    );

    const entries = parseWorktreeList(listResult.stdout);
    const entry = entries.find(
      (e) => e.branch === `refs/heads/${branch}`,
    );
    const worktreePath = entry?.worktree ?? pathInput;
    this.assertWorktreePath(worktreePath);

    const handle: WorktreeHandle = {
      path: worktreePath,
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
    const { repoRoot } = this.requireConfigured();

    await this.exec(
      ["worktree", "remove", "--force", handle.path],
      repoRoot,
      handle.path,
    );

    await this.exec(
      ["branch", "-D", handle.branch],
      repoRoot,
    );

    this.registry.delete(sessionId);
  }

  async pruneStale(): Promise<void> {
    if (this.repoRoot === undefined && this.baseDir === undefined) return;
    const { repoRoot } = this.requireConfigured();
    try {
      await this.exec(["worktree", "prune"], repoRoot);
    } catch {
      // ignore
    }

    try {
      const branchResult = await this.exec(
        ["branch", "--list", "kiln/session-*"],
        repoRoot,
      );

      const branchNames = branchResult.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      for (const branch of branchNames) {
        try {
          await this.exec(["branch", "-D", branch], repoRoot);
        } catch {
          // ignore failures (worktree still exists or already deleted)
        }
      }
    } catch {
      // ignore
    }
  }

  async list(): Promise<WorktreeHandle[]> {
    if (this.repoRoot === undefined || this.baseDir === undefined) return [];
    const result = await this.exec(
      ["worktree", "list", "--porcelain"],
      this.repoRoot,
    );

    const entries = parseWorktreeList(result.stdout);

    return entries
      .filter(
        (e): e is { worktree: string; branch: string } =>
          Boolean(e.branch?.startsWith("refs/heads/kiln/session-") && e.worktree),
      )
      .map((entry) => {
        this.assertWorktreePath(entry.worktree);
        return entry;
      })
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

  private requireConfigured(): {
    readonly repoRoot: string;
    readonly baseDir: string;
    readonly privateStateRoot: string;
  } {
    if (this.repoRoot === undefined || this.baseDir === undefined) {
      throw new WorktreeError("Private worktree state is not configured for this registry.");
    }
    if (this.privateStateRoot === undefined || this.privateStateRoot.trim().length === 0) {
      throw new WorktreeError("Configured private worktrees require a canonical privateStateRoot.");
    }
    return {
      repoRoot: this.repoRoot,
      baseDir: this.baseDir,
      privateStateRoot: this.privateStateRoot,
    };
  }

  /**
   * Run one Git effect only after revalidating the private worktree boundary.
   * The caller may provide a worktree path when the Git operation targets one.
   * Rechecking here is intentional: the base directory may have been replaced
   * by a junction after composition/startup validation.
   */
  private async exec(
    args: string[],
    cwd: string,
    worktreePath?: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    this.assertPrivateWorktreeBase();
    if (worktreePath !== undefined) this.assertWorktreePath(worktreePath);
    return this.runner.exec(args, cwd);
  }

  private assertPrivateWorktreeBase(): void {
    const { baseDir, privateStateRoot } = this.requireConfigured();

    const baseExists = assertPrivateStateDirectoryTargetSync(privateStateRoot, baseDir);
    if (!baseExists) {
      throw new WorktreeError("Private worktree base directory is unavailable.");
    }

    const canonicalRoot = realpathSync(resolve(privateStateRoot));
    const canonicalBase = realpathSync(resolve(baseDir));
    if (!isWithin(canonicalRoot, canonicalBase)) {
      throw new WorktreeError("Private worktree base directory escapes its canonical private state root.");
    }
  }

  /** Validate a Git-returned or caller-derived worktree path before any use. */
  private assertWorktreePath(worktreePath: string): void {
    const { baseDir } = this.requireConfigured();
    const absolutePath = resolve(worktreePath);
    const canonicalBase = this.canonicalPrivateWorktreeBase();
    if (!isWithin(canonicalBase, absolutePath, false)) {
      throw new WorktreeError("Git worktree path escapes the private worktree base directory.");
    }

    let existingPath = absolutePath;
    let existingStat: ReturnType<typeof lstatSync> | undefined;
    while (true) {
      try {
        existingStat = lstatSync(existingPath);
        break;
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
        const parent = dirname(existingPath);
        if (parent === existingPath) {
          throw new WorktreeError("Git worktree path cannot be physically validated.");
        }
        existingPath = parent;
      }
    }

    if (existingStat.isSymbolicLink() || !existingStat.isDirectory()) {
      throw new WorktreeError("Git worktree path contains an unsafe entry.");
    }

    const physicalExistingPath = realpathSync(existingPath);
    if (!isWithin(canonicalBase, physicalExistingPath)) {
      throw new WorktreeError("Git worktree path escapes the physical private worktree base.");
    }

    if (existingPath === absolutePath) {
      const physicalPath = realpathSync(absolutePath);
      if (!isWithin(canonicalBase, physicalPath, false)) {
        throw new WorktreeError("Git worktree path escapes the physical private worktree base.");
      }
    }

    // Keep the lexical base check explicit even though canonicalPrivateWorktreeBase
    // already validated the same directory. This guards against accidental use of
    // the pre-resolved base in future edits.
    if (!isWithin(resolve(baseDir), absolutePath, false)) {
      throw new WorktreeError("Git worktree path escapes the private worktree base directory.");
    }
  }

  private canonicalPrivateWorktreeBase(): string {
    const { baseDir } = this.requireConfigured();
    this.assertPrivateWorktreeBase();
    return realpathSync(resolve(baseDir));
  }
}

function isWithin(parent: string, child: string, allowEqual = true): boolean {
  const path = relative(resolve(parent), resolve(child));
  if (path === "") return allowEqual;
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ((error as NodeJS.ErrnoException).code === "ENOENT"
      || (error as NodeJS.ErrnoException).code === "ENOTDIR");
}
