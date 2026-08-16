import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Backups kept per target/file pair when a caller does not choose a depth.
 * Deep enough to roll back a bad sync and the one before it; shallow enough
 * that routine syncing cannot fill a disk.
 */
export const DEFAULT_NATIVE_PROJECTION_BACKUP_RETENTION = 3;

export interface NativeProjectionBackupInput {
  readonly kilnDir: string;
  readonly targetId: string;
  readonly filePath: string;
  readonly timestamp?: string;
  /**
   * Maximum backups to keep for this target/file pair; older ones are pruned.
   * Defaults to `DEFAULT_NATIVE_PROJECTION_BACKUP_RETENTION`. There is no
   * unbounded setting on purpose: every projection rewrites its target on each
   * sync, so retaining all history grows without limit. A caller may choose a
   * different depth for its own source, never an unlimited one.
   */
  readonly retain?: number;
  /**
   * File mode for the written backup. Omit for the default mode. Secret-bearing
   * sources must pass an owner-only mode so a backup is never more readable
   * than the credential it copies.
   */
  readonly mode?: number;
}

export function backupNativeProjectionFile(input: NativeProjectionBackupInput): string | undefined {
  const retain = input.retain ?? DEFAULT_NATIVE_PROJECTION_BACKUP_RETENTION;
  if (!Number.isSafeInteger(retain) || retain < 1) {
    throw new TypeError("Native projection backup retention must be a positive integer.");
  }
  if (!existsSync(input.filePath)) {
    return undefined;
  }

  const timestamp = sanitizeTimestamp(input.timestamp ?? new Date().toISOString());
  const sourceName = basename(input.filePath);
  const backupDir = join(input.kilnDir, "backups", sanitizeTargetId(input.targetId));
  const backupPath = join(backupDir, `${timestamp}-${sourceName}.bak`);
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(backupPath, readFileSync(input.filePath), input.mode === undefined ? undefined : { mode: input.mode });
  pruneBackups(backupDir, sourceName, retain);
  return backupPath;
}

/**
 * Keeps the newest `retain` backups for one source file. Names are
 * `<sanitized-iso-timestamp>-<sourceName>.bak`; the sanitized timestamp keeps
 * fixed-width zero-padded fields, so a lexicographic sort is chronological.
 * Pruning is scoped by source name so unrelated files sharing a target
 * directory never prune each other.
 */
function pruneBackups(backupDir: string, sourceName: string, retain: number): void {
  const suffix = `-${sourceName}.bak`;
  const existing = readdirSync(backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => entry.name)
    .sort();
  for (const name of existing.slice(0, Math.max(0, existing.length - retain))) {
    rmSync(join(backupDir, name), { force: true });
  }
}

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

function sanitizeTargetId(targetId: string): string {
  return targetId.replace(/[^A-Za-z0-9._-]/g, "_");
}
