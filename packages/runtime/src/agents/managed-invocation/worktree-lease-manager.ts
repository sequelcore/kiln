import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  ManagedAgentInvocationRequest,
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentResourceLeaseEvidence,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { ManagedAgentLeaseAcquireError, ManagedAgentWorktreeReviewRequiredError } from "./lease-errors.js";
import { normalizeLeasePath } from "./lease-path-support.js";
import { pathExists, toError, uniqueStrings } from "./runtime-primitives.js";

export interface ManagedAgentWorktreeLeaseManagerInput {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly lease: ManagedAgentResourceLeaseEvidence;
  readonly abortSignal?: AbortSignal;
}

export interface ManagedAgentWorktreeLeaseReleaseInput extends ManagedAgentWorktreeLeaseManagerInput {
  readonly record: ManagedAgentInvocationRecord;
}

export interface ManagedAgentWorktreeLeaseManager {
  acquire(input: ManagedAgentWorktreeLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentWorktreeLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export interface ManagedGitWorktreeLeaseManagerConfig {
  readonly repositoryPath: string;
  readonly worktreeRootPath: string;
  readonly ref?: string;
  readonly gitBinary?: string;
}

const execFileAsync = promisify(execFile);

class ManagedAgentWorktreeLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

export class ManagedGitWorktreeLeaseManager implements ManagedAgentWorktreeLeaseManager {
  private readonly repositoryPath: string;
  private readonly worktreeRootPath: string;
  private readonly ref: string;
  private readonly gitBinary: string;

  constructor(config: ManagedGitWorktreeLeaseManagerConfig) {
    this.repositoryPath = config.repositoryPath;
    this.worktreeRootPath = config.worktreeRootPath;
    this.ref = config.ref ?? "HEAD";
    this.gitBinary = config.gitBinary ?? "git";
  }

  async acquire(input: ManagedAgentWorktreeLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    if (input.lease.workingDirectoryMode !== "isolated-worktree") {
      throw new ManagedAgentRuntimeAdmissionError("Managed git worktree lease manager only supports isolated worktree leases");
    }
    this.assertWorktreePath(input.lease.workingDirectoryPath);
    await this.ensureWorktree(input.lease.workingDirectoryPath, input.abortSignal);
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        `kiln://artifacts/${input.request.invocationId}/worktree-lease`,
      ]),
    };
  }

  async release(input: ManagedAgentWorktreeLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    this.assertWorktreePath(input.lease.workingDirectoryPath);
    const dirtyStatus = await this.git(["-C", input.lease.workingDirectoryPath, "status", "--porcelain"]);
    if (dirtyStatus.trim().length > 0) {
      throw new ManagedAgentWorktreeReviewRequiredError("Managed git worktree lease is dirty; preserving worktree for review");
    }
    await this.git(["-C", this.repositoryPath, "worktree", "remove", input.lease.workingDirectoryPath]);
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        `kiln://artifacts/${input.request.invocationId}/worktree-cleanup`,
      ]),
    };
  }

  private async ensureWorktree(path: string, abortSignal: AbortSignal | undefined): Promise<void> {
    if (await pathExists(path)) {
      throw new ManagedAgentWorktreeLeaseAcquireError(
        "Managed git worktree lease path already exists; refusing to adopt unmanaged checkout",
        false,
      );
    }
    try {
      await this.git(["-C", this.repositoryPath, "worktree", "add", "--detach", path, this.ref], abortSignal);
    } catch (error) {
      throw new ManagedAgentWorktreeLeaseAcquireError(toError(error).message, true);
    }
  }

  private assertWorktreePath(path: string): void {
    const normalizedRoot = normalizeLeasePath(this.worktreeRootPath);
    const normalizedPath = normalizeLeasePath(path);
    if (normalizedPath === normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      throw new ManagedAgentWorktreeLeaseAcquireError(
        "Managed git worktree lease path is outside configured worktree root",
        false,
      );
    }
  }

  private async git(args: readonly string[], signal?: AbortSignal): Promise<string> {
    const { stdout } = await execFileAsync(this.gitBinary, [...args], {
      windowsHide: true,
      ...(signal ? { signal } : {}),
    });
    return stdout.toString();
  }
}
