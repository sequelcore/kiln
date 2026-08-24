import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parse } from "yaml";
import { KilnYamlError } from "../../kiln-yaml.js";
import type { KilnGlobalConfig } from "../global-config-schema.js";
import { validateGlobalConfig } from "./admission/index.js";
import { resolveGlobalConfigPath } from "./path.js";
import { isRecord } from "./admission/shared.js";

/** Owns the single-file read, revision fence, lock, and atomic commit lifecycle. */
export function readGlobalConfig(): KilnGlobalConfig | null {
  const configPath = resolveGlobalConfigPath();
  if (!existsSync(configPath)) {
    return null;
  }
  const raw = readFileSync(configPath, "utf-8");
  try {
    const parsed: unknown = parse(raw);
    validateGlobalConfig(parsed);
    return parsed;
  } catch (err) {
    if (err instanceof KilnYamlError) {
      throw err;
    }
    throw new KilnYamlError(
      `Failed to parse global config: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export type GlobalConfigMutationErrorCode =
  | "GLOBAL_CONFIG_LOCK_UNAVAILABLE"
  | "GLOBAL_CONFIG_REVISION_CONFLICT"
  | "GLOBAL_CONFIG_WRITE_FAILED";

export interface GlobalConfigMutationEvidence {
  readonly configPath: string;
  readonly expectedRevision?: string;
  readonly actualRevision?: string;
  readonly lockOwnerPid?: number;
  readonly lockAcquiredAt?: string;
  readonly invalidBackupPath?: string;
}

function parseGlobalConfigRaw(raw: string | null): KilnGlobalConfig | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = parse(raw);
    validateGlobalConfig(parsed);
    return parsed;
  } catch (error) {
    if (error instanceof KilnYamlError) throw error;
    throw new KilnYamlError(
      `Failed to parse global config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function globalConfigRevision(raw: string | null): string {
  return raw === null ? "absent" : `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function globalConfigMutationMessage(
  code: GlobalConfigMutationErrorCode,
  evidence: GlobalConfigMutationEvidence,
): string {
  if (code === "GLOBAL_CONFIG_LOCK_UNAVAILABLE") {
    return `Global config mutation is already in progress: ${evidence.configPath}`;
  }
  if (code === "GLOBAL_CONFIG_REVISION_CONFLICT") {
    return `Global config revision conflict: expected ${evidence.expectedRevision}, found ${evidence.actualRevision}`;
  }
  return `Global config atomic write failed: ${evidence.configPath}`;
}

export class GlobalConfigMutationError extends Error {
  readonly name = "GlobalConfigMutationError";

  constructor(
    readonly code: GlobalConfigMutationErrorCode,
    readonly evidence: GlobalConfigMutationEvidence,
    cause?: unknown,
  ) {
    super(globalConfigMutationMessage(code, evidence));
    this.cause = cause;
  }
}

export interface GlobalConfigMutationResult {
  readonly config: KilnGlobalConfig;
  readonly previousRevision: string;
  readonly revision: string;
  readonly invalidBackupPath?: string;
}

/**
 * Commits exact canonical bytes for the global configuration file.
 *
 * The configuration mutation authority produces content by editing the YAML
 * document tree, which preserves operator comments, ordering, and scalar style.
 * Re-serializing that content from a plain object would discard exactly what
 * ADR-014 requires be kept, so this writer commits the admitted bytes verbatim
 * under the same lock, revision fence, validation, and atomic replacement as
 * every other global mutation.
 */
export function commitGlobalConfigBytes(input: {
  readonly content: string;
  readonly expectedRevision: string;
  /**
   * Retains the existing bytes before replacing a configuration that no longer
   * validates. Recovery from an unreadable config must never silently discard
   * what the operator had.
   */
  readonly invalidCurrent?: "backup-and-replace";
}): GlobalConfigMutationResult {
  const configPath = resolveGlobalConfigPath();
  mkdirSync(dirname(configPath), { recursive: true });
  const lockPath = `${configPath}.lock`;
  const lock = acquireGlobalConfigLock(configPath, lockPath);
  const temporaryPath = `${configPath}.${lock.acquisitionId}.tmp`;

  try {
    const currentRaw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
    const previousRevision = globalConfigRevision(currentRaw);
    if (input.expectedRevision !== previousRevision) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_REVISION_CONFLICT", {
        configPath,
        expectedRevision: input.expectedRevision,
        actualRevision: previousRevision,
      });
    }

    const next = parseGlobalConfigRaw(input.content);
    if (next === null) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath });
    }
    validateGlobalConfig(next);

    let invalidBackupPath: string | undefined;
    if (currentRaw !== null && input.invalidCurrent === "backup-and-replace" && !isValidGlobalConfigRaw(currentRaw)) {
      invalidBackupPath = `${configPath}.invalid-${lock.acquisitionId}.bak`;
      try {
        writeFileSync(invalidBackupPath, currentRaw, {
          encoding: "utf-8",
          flag: "wx",
          mode: statSync(configPath).mode & 0o777,
        });
      } catch (backupError) {
        throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath, invalidBackupPath }, backupError);
      }
    }

    const mode = currentRaw === null ? 0o600 : statSync(configPath).mode & 0o777;
    try {
      writeFileSync(temporaryPath, input.content, { encoding: "utf-8", mode });
      if (currentRaw !== null) chmodSync(temporaryPath, mode);
      renameSync(temporaryPath, configPath);
    } catch (error) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath }, error);
    } finally {
      rmSync(temporaryPath, { force: true });
    }

    let readBackRaw: string;
    let readBackConfig: KilnGlobalConfig;
    try {
      readBackRaw = readFileSync(configPath, "utf-8");
      const parsed = parseGlobalConfigRaw(readBackRaw);
      if (parsed === null) throw new Error("read-back returned no configuration");
      validateGlobalConfig(parsed);
      readBackConfig = parsed;
    } catch (error) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", { configPath }, error);
    }
    if (readBackRaw !== input.content) {
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_WRITE_FAILED", {
        configPath,
        expectedRevision: globalConfigRevision(input.content),
        actualRevision: globalConfigRevision(readBackRaw),
      });
    }

    return {
      config: readBackConfig,
      previousRevision,
      revision: globalConfigRevision(readBackRaw),
      ...(invalidBackupPath === undefined ? {} : { invalidBackupPath }),
    };
  } finally {
    releaseGlobalConfigLock(lockPath, lock);
  }
}

function isValidGlobalConfigRaw(raw: string): boolean {
  try {
    return parseGlobalConfigRaw(raw) !== null;
  } catch {
    return false;
  }
}

interface GlobalConfigLockOwner {
  readonly pid: number;
  readonly acquiredAt: string;
  readonly acquisitionId: string;
}

interface AcquiredGlobalConfigLock extends GlobalConfigLockOwner {
  readonly descriptor: number;
}

function acquireGlobalConfigLock(configPath: string, lockPath: string): AcquiredGlobalConfigLock {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const owner: GlobalConfigLockOwner = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      acquisitionId: randomUUID(),
    };
    let descriptor: number;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (isNodeErrorWithCode(error, "EEXIST")) {
        const existingOwner = readGlobalConfigLockOwner(lockPath);
        if (existingOwner !== null && !isProcessAlive(existingOwner.pid)) {
          const recoveryPath = `${lockPath}.recovery-${randomUUID()}`;
          try {
            renameSync(lockPath, recoveryPath);
          } catch (claimError) {
            if (isNodeErrorWithCode(claimError, "ENOENT")) continue;
            throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", {
              configPath,
              lockOwnerPid: existingOwner.pid,
              lockAcquiredAt: existingOwner.acquiredAt,
            }, claimError);
          }
          try {
            const claimedOwner = readGlobalConfigLockOwner(recoveryPath);
            if (claimedOwner?.acquisitionId === existingOwner.acquisitionId) {
              rmSync(`${configPath}.${claimedOwner.acquisitionId}.tmp`, { force: true });
            }
          } finally {
            rmSync(recoveryPath, { force: true });
          }
          continue;
        }
        throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", {
          configPath,
          ...(existingOwner === null ? {} : {
            lockOwnerPid: existingOwner.pid,
            lockAcquiredAt: existingOwner.acquiredAt,
          }),
        }, error);
      }
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", { configPath }, error);
    }
    try {
      writeFileSync(descriptor, JSON.stringify(owner), { encoding: "utf-8" });
      fsyncSync(descriptor);
      return { ...owner, descriptor };
    } catch (error) {
      try {
        releaseGlobalConfigLock(lockPath, { ...owner, descriptor });
      } catch {
        // The release path always closes the descriptor and never removes an
        // unclaimed canonical lock path.
      }
      throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", { configPath }, error);
    }
  }
  throw new GlobalConfigMutationError("GLOBAL_CONFIG_LOCK_UNAVAILABLE", { configPath });
}

function releaseGlobalConfigLock(lockPath: string, lock: AcquiredGlobalConfigLock): void {
  const releasePath = `${lockPath}.release-${lock.acquisitionId}`;
  let claimed = false;
  try {
    renameSync(lockPath, releasePath);
    claimed = true;
  } finally {
    closeSync(lock.descriptor);
    if (claimed) rmSync(releasePath, { force: true });
  }
}

function readGlobalConfigLockOwner(lockPath: string): GlobalConfigLockOwner | null {
  try {
    const value = JSON.parse(readFileSync(lockPath, "utf-8")) as unknown;
    if (!isRecord(value)
      || typeof value.pid !== "number"
      || !Number.isSafeInteger(value.pid)
      || value.pid <= 0
      || typeof value.acquiredAt !== "string"
      || Number.isNaN(Date.parse(value.acquiredAt))
      || typeof value.acquisitionId !== "string"
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.acquisitionId)
    ) return null;
    return value as unknown as GlobalConfigLockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isNodeErrorWithCode(error, "ESRCH");
  }
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Atomically reads admitted global configuration and its optimistic revision. */
export function readGlobalConfigSnapshot(): { readonly config: KilnGlobalConfig | null; readonly revision: string } {
  const configPath = resolveGlobalConfigPath();
  const raw = existsSync(configPath) ? readFileSync(configPath, "utf-8") : null;
  return { config: parseGlobalConfigRaw(raw), revision: globalConfigRevision(raw) };
}
