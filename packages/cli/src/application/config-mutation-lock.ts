import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

interface MutationLockOwner {
  readonly pid: number;
  readonly acquiredAt: string;
  readonly acquisitionId: string;
}

export class ConfigMutationLockUnavailableError extends Error {
  readonly name = "ConfigMutationLockUnavailableError";

  constructor(readonly lockPath: string, cause?: unknown) {
    super(`Configuration mutation is already in progress: ${lockPath}`);
    this.cause = cause;
  }
}

/**
 * Serializes the commit window for one canonical path.
 *
 * Without it, two applies sharing a base revision could both pass the revision
 * fence, overwrite each other, reconcile twice, and each believe it settled the
 * only committed change. The lock is held from the fence recheck through
 * settlement, so exactly one apply can be in that window per path.
 *
 * A lock whose owning process is gone is reclaimed, because a crashed apply must
 * not block the operator forever.
 */
export function withConfigMutationLock<T>(lockPath: string, run: () => T): T {
  const lock = acquire(lockPath);
  try {
    return run();
  } finally {
    release(lockPath, lock);
  }
}

function acquire(lockPath: string): MutationLockOwner & { readonly descriptor: number } {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const owner: MutationLockOwner = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      acquisitionId: randomUUID(),
    };
    try {
      const descriptor = openSync(lockPath, "wx", 0o600);
      writeFileSync(lockPath, JSON.stringify(owner), "utf-8");
      return { ...owner, descriptor };
    } catch (error) {
      if (!isErrorWithCode(error, "EEXIST")) {
        throw new ConfigMutationLockUnavailableError(lockPath, error);
      }
      const existing = readOwner(lockPath);
      if (existing !== null && isProcessAlive(existing.pid)) {
        throw new ConfigMutationLockUnavailableError(lockPath);
      }
      // The previous holder is gone; reclaim the lock and retry.
      try {
        renameSync(lockPath, `${lockPath}.recovery-${randomUUID()}`);
      } catch (claimError) {
        if (!isErrorWithCode(claimError, "ENOENT")) {
          throw new ConfigMutationLockUnavailableError(lockPath, claimError);
        }
      }
    }
  }
  throw new ConfigMutationLockUnavailableError(lockPath);
}

function release(lockPath: string, lock: { readonly descriptor: number; readonly acquisitionId: string }): void {
  try {
    closeSync(lock.descriptor);
  } catch {
    // The descriptor may already be closed by a reclaiming process.
  }
  const owner = readOwner(lockPath);
  if (owner === null || owner.acquisitionId === lock.acquisitionId) {
    rmSync(lockPath, { force: true });
  }
}

function readOwner(lockPath: string): MutationLockOwner | null {
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    const parsed = JSON.parse(readFileSync(lockPath, "utf-8")) as MutationLockOwner;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isErrorWithCode(error, "EPERM");
  }
}

function isErrorWithCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}
