import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface NativeProjectionBackupInput {
  readonly kilnDir: string;
  readonly targetId: string;
  readonly filePath: string;
  readonly timestamp?: string;
}

export function backupNativeProjectionFile(input: NativeProjectionBackupInput): string | undefined {
  if (!existsSync(input.filePath)) {
    return undefined;
  }

  const timestamp = sanitizeTimestamp(input.timestamp ?? new Date().toISOString());
  const backupPath = join(
    input.kilnDir,
    "backups",
    sanitizeTargetId(input.targetId),
    `${timestamp}-${basename(input.filePath)}.bak`,
  );
  mkdirSync(dirname(backupPath), { recursive: true });
  writeFileSync(backupPath, readFileSync(input.filePath));
  return backupPath;
}

function sanitizeTimestamp(timestamp: string): string {
  return timestamp.replace(/[:.]/g, "-");
}

function sanitizeTargetId(targetId: string): string {
  return targetId.replace(/[^A-Za-z0-9._-]/g, "_");
}
