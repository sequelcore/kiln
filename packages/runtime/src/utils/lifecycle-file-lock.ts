import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOCK_FILE = "lifecycle.lock";
const FILE_MODE = 0o600;
const DIRECTORY_MODE = 0o700;
const DEFAULT_INVALID_LOCK_GRACE_MS = 30_000;
const MAX_ACQUISITION_ATTEMPTS = 8;
const PORTABLE_OWNER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

interface LifecycleLockOwner {
  readonly schemaVersion: 1;
  readonly ownerId: string;
  readonly pid: number;
  readonly acquiredAt: number;
}

export interface LifecycleFileLockOptions {
  readonly runtimeDir: string;
  readonly processId?: number;
  readonly createOwnerId?: () => string;
  readonly nowMilliseconds?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
  readonly invalidLockGraceMs?: number;
  readonly assertFileTarget?: (path: string) => void | Promise<void>;
}

export type LifecycleFileLockResult<T> =
  | { readonly state: "completed"; readonly value: T }
  | { readonly state: "busy" };

/**
 * Serializes lifecycle mutations across processes without leaving an empty
 * authoritative lock if the writer exits during acquisition.
 */
export async function runWithLifecycleFileLock<T>(
  options: LifecycleFileLockOptions,
  action: () => Promise<T>,
): Promise<LifecycleFileLockResult<T>> {
  const runtimeDir = requireNonEmpty(options.runtimeDir, "Runtime directory");
  const processId = requirePositiveInteger(options.processId ?? process.pid, "Process id");
  const ownerId = requireOwnerId((options.createOwnerId ?? randomUUID)());
  const nowMilliseconds = options.nowMilliseconds ?? Date.now;
  const acquiredAt = requireNonNegativeFinite(nowMilliseconds(), "Acquisition time");
  const invalidLockGraceMs = requireNonNegativeFinite(
    options.invalidLockGraceMs ?? DEFAULT_INVALID_LOCK_GRACE_MS,
    "Invalid lock recovery grace",
  );
  const isProcessAlive = options.isProcessAlive ?? isProcessAliveFailClosed;
  const assertFileTarget = options.assertFileTarget ?? (() => undefined);
  const lockPath = join(runtimeDir, LOCK_FILE);
  const temporaryPath = join(runtimeDir, `.${LOCK_FILE}.${processId}.${ownerId}.tmp`);
  const owner: LifecycleLockOwner = { schemaVersion: 1, ownerId, pid: processId, acquiredAt };
  const serializedOwner = `${JSON.stringify(owner)}\n`;

  await mkdir(runtimeDir, { recursive: true, mode: DIRECTORY_MODE });
  await assertFileTarget(lockPath);
  await assertFileTarget(temporaryPath);

  for (let attempt = 0; attempt < MAX_ACQUISITION_ATTEMPTS; attempt += 1) {
    await writeFile(temporaryPath, serializedOwner, { encoding: "utf8", flag: "wx", mode: FILE_MODE });
    let temporaryExists = true;
    try {
      try {
        await assertFileTarget(lockPath);
        await link(temporaryPath, lockPath);
      } catch (error) {
        if (!isFsCode(error, "EEXIST")) throw error;
        const disposition = await inspectExistingLock({
          lockPath,
          nowMilliseconds,
          invalidLockGraceMs,
          isProcessAlive,
          assertFileTarget,
        });
        if (disposition === "busy") return { state: "busy" };
        if (disposition === "retry") continue;
        if (await removeObservedLock(lockPath, disposition.contents, assertFileTarget)) continue;
        continue;
      }

      await assertFileTarget(temporaryPath);
      await rm(temporaryPath);
      temporaryExists = false;
      try {
        return { state: "completed", value: await action() };
      } finally {
        await removeObservedLock(lockPath, serializedOwner, assertFileTarget);
      }
    } finally {
      if (temporaryExists) {
        await assertFileTarget(temporaryPath);
        await rm(temporaryPath, { force: true });
      }
    }
  }

  return { state: "busy" };
}

type ExistingLockDisposition =
  | "busy"
  | "retry"
  | { readonly contents: string };

async function inspectExistingLock(input: {
  readonly lockPath: string;
  readonly nowMilliseconds: () => number;
  readonly invalidLockGraceMs: number;
  readonly isProcessAlive: (pid: number) => boolean;
  readonly assertFileTarget: (path: string) => void | Promise<void>;
}): Promise<ExistingLockDisposition> {
  await input.assertFileTarget(input.lockPath);
  let contents: string;
  try {
    contents = await readFile(input.lockPath, "utf8");
  } catch (error) {
    if (isFsCode(error, "ENOENT")) return "retry";
    throw error;
  }

  const ownerPid = parseOwnerPid(contents);
  if (ownerPid !== null) return input.isProcessAlive(ownerPid) ? "busy" : { contents };

  await input.assertFileTarget(input.lockPath);
  try {
    const metadata = await stat(input.lockPath);
    const age = input.nowMilliseconds() - metadata.mtimeMs;
    return age >= input.invalidLockGraceMs ? { contents } : "busy";
  } catch (error) {
    if (isFsCode(error, "ENOENT")) return "retry";
    throw error;
  }
}

async function removeObservedLock(
  lockPath: string,
  expectedContents: string,
  assertFileTarget: (path: string) => void | Promise<void>,
): Promise<boolean> {
  await assertFileTarget(lockPath);
  let currentContents: string;
  try {
    currentContents = await readFile(lockPath, "utf8");
  } catch (error) {
    if (isFsCode(error, "ENOENT")) return false;
    throw error;
  }
  if (currentContents !== expectedContents) return false;
  await assertFileTarget(lockPath);
  await rm(lockPath);
  return true;
}

function parseOwnerPid(contents: string): number | null {
  if (/^[1-9]\d*\n?$/.test(contents)) {
    const legacyPid = Number.parseInt(contents, 10);
    return Number.isSafeInteger(legacyPid) ? legacyPid : null;
  }
  try {
    const value: unknown = JSON.parse(contents);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const owner = value as Partial<LifecycleLockOwner>;
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== "acquiredAt,ownerId,pid,schemaVersion") return null;
    if (owner.schemaVersion !== 1 || typeof owner.ownerId !== "string" || !PORTABLE_OWNER_ID.test(owner.ownerId)) return null;
    const pid = requirePositiveInteger(owner.pid, "Lock owner process id");
    requireNonNegativeFinite(owner.acquiredAt, "Lock acquisition time");
    return pid;
  } catch {
    return null;
  }
}

function isProcessAliveFailClosed(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isFsCode(error, "ESRCH");
  }
}

function requireNonEmpty(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must not be empty.`);
  return value;
}

function requireOwnerId(value: string): string {
  if (!PORTABLE_OWNER_ID.test(value)) throw new Error("Lifecycle lock owner id is invalid.");
  return value;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer.`);
  return value as number;
}

function requireNonNegativeFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number.`);
  }
  return value;
}

function isFsCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && (error as { readonly code?: unknown }).code === code;
}
