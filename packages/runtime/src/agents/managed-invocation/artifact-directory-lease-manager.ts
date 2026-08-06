import { mkdir, rmdir } from "node:fs/promises";
import { join as joinPath } from "node:path";
import type { ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { ManagedAgentLeaseAcquireError } from "./lease-errors.js";
import { normalizeLeasePath } from "./lease-path-support.js";
import { isNodeError, pathExists, toError, uniqueStrings } from "./runtime-primitives.js";
import type {
  ManagedAgentWorktreeLeaseManagerInput as ManagedAgentArtifactDirectoryLeaseManagerInputBase,
  ManagedAgentWorktreeLeaseReleaseInput as ManagedAgentArtifactDirectoryLeaseReleaseInputBase,
} from "./worktree-lease-manager.js";

export type ManagedAgentArtifactDirectoryLeaseManagerInput = ManagedAgentArtifactDirectoryLeaseManagerInputBase;

export type ManagedAgentArtifactDirectoryLeaseReleaseInput = ManagedAgentArtifactDirectoryLeaseReleaseInputBase;

export interface ManagedAgentArtifactDirectoryLeaseManager {
  acquire(input: ManagedAgentArtifactDirectoryLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence>;
  release(input: ManagedAgentArtifactDirectoryLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence>;
}

export interface ManagedFilesystemArtifactDirectoryLeaseManagerConfig {
  readonly artifactRootPath: string;
}

class ManagedAgentArtifactDirectoryLeaseAcquireError extends ManagedAgentLeaseAcquireError {}

export class ManagedFilesystemArtifactDirectoryLeaseManager implements ManagedAgentArtifactDirectoryLeaseManager {
  private readonly artifactRootPath: string;

  constructor(config: ManagedFilesystemArtifactDirectoryLeaseManagerConfig) {
    this.artifactRootPath = config.artifactRootPath;
  }

  async acquire(input: ManagedAgentArtifactDirectoryLeaseManagerInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const artifactDirectoryPath = this.artifactDirectoryPath(input.request.invocationId);
    this.assertArtifactDirectoryPath(artifactDirectoryPath);
    await this.ensureArtifactDirectory(artifactDirectoryPath);
    return {
      ...input.lease,
      healthStatus: "healthy",
      cleanupStatus: "pending",
      resourceUris: uniqueStrings([
        ...input.lease.resourceUris,
        `kiln://artifacts/${input.request.invocationId}/artifact-directory`,
      ]),
    };
  }

  async release(input: ManagedAgentArtifactDirectoryLeaseReleaseInput): Promise<ManagedAgentResourceLeaseEvidence> {
    const artifactDirectoryPath = this.artifactDirectoryPath(input.request.invocationId);
    this.assertArtifactDirectoryPath(artifactDirectoryPath);
    try {
      await rmdir(artifactDirectoryPath);
    } catch (error) {
      if (!isNonEmptyDirectoryError(error)) {
        throw error;
      }
      return {
        ...input.lease,
        healthStatus: "leaked",
        cleanupStatus: "failed",
        diagnosticUris: uniqueStrings([
          ...input.lease.diagnosticUris,
          `kiln://artifacts/${input.request.invocationId}/artifact-directory-preserved`,
        ]),
      };
    }
    return {
      ...input.lease,
      healthStatus: "released",
      cleanupStatus: "completed",
      diagnosticUris: uniqueStrings([
        ...input.lease.diagnosticUris,
        `kiln://artifacts/${input.request.invocationId}/artifact-directory-cleanup`,
      ]),
    };
  }

  private async ensureArtifactDirectory(path: string): Promise<void> {
    if (await pathExists(path)) {
      throw new ManagedAgentArtifactDirectoryLeaseAcquireError(
        "Managed artifact-directory lease path already exists; refusing to adopt unmanaged artifact directory",
        false,
      );
    }
    try {
      await mkdir(this.artifactRootPath, { recursive: true });
      await mkdir(path);
    } catch (error) {
      throw new ManagedAgentArtifactDirectoryLeaseAcquireError(toError(error).message, true);
    }
  }

  private artifactDirectoryPath(invocationId: string): string {
    return joinPath(this.artifactRootPath, invocationId);
  }

  private assertArtifactDirectoryPath(path: string): void {
    const normalizedRoot = normalizeLeasePath(this.artifactRootPath);
    const normalizedPath = normalizeLeasePath(path);
    if (normalizedPath === normalizedRoot || !normalizedPath.startsWith(`${normalizedRoot}/`)) {
      throw new ManagedAgentArtifactDirectoryLeaseAcquireError(
        "Managed artifact-directory lease path is outside configured artifact root",
        false,
      );
    }
  }
}

function isNonEmptyDirectoryError(error: unknown): boolean {
  return isNodeError(error) && (error.code === "ENOTEMPTY" || error.code === "EEXIST");
}
