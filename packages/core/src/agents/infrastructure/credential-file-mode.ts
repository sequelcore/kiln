import { chmod } from "node:fs/promises";

/** Owner-only. Credential files must never be readable by other local accounts. */
export const CREDENTIAL_FILE_MODE = 0o600;

/**
 * Enforces owner-only mode on a credential file that already exists.
 *
 * Creation-time mode does not cover files written before this invariant existed,
 * and POSIX `write` does not change the mode of an existing file. Applying it on
 * every persist lets credentials repair themselves on their next refresh instead
 * of requiring a one-shot migration command that would become dead code.
 *
 * Best-effort by design: the write itself already succeeded, so a filesystem
 * that cannot represent POSIX modes must not fail an otherwise valid login.
 * Residual exposure stays visible through credential permission diagnostics
 * rather than being silently accepted.
 */
export async function applyCredentialFileMode(
  path: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  // Windows does not implement POSIX mode bits; these paths are protected by the
  // user-profile ACL instead, so a chmod here would be misleading rather than safe.
  if (platform === "win32") return;
  try {
    await chmod(path, CREDENTIAL_FILE_MODE);
  } catch {
    return;
  }
}

/** True when a stat mode grants any group or other permission. */
export function isOverPermissiveCredentialMode(mode: number): boolean {
  return (mode & 0o077) !== 0;
}
