import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { isOverPermissiveCredentialMode } from "../credential-acquisition/credential-file-mode.js";

export interface OverPermissiveCredentialFile {
  /** Path relative to the credential root, so diagnostics never leak the operator's home path. */
  readonly relativePath: string;
  /** Octal permission string, such as `644`. */
  readonly mode: string;
}

export interface CredentialPermissionDiagnosticConfig {
  readonly rootDir: string;
  readonly platform?: NodeJS.Platform;
}

/**
 * Reports credential files readable beyond their owner.
 *
 * Write paths enforce owner-only mode, so an actively used credential repairs
 * itself on its next persist. This covers the remainder: credentials that are
 * linked once and never rewritten would otherwise keep a pre-invariant mode
 * indefinitely with nothing surfacing it.
 *
 * Read-only by contract. Operator surfaces report the finding; they do not
 * repair it here, because silently changing permissions during an inspection
 * command would hide the exposure that just occurred rather than explain it.
 */
export async function listOverPermissiveCredentialFiles(
  config: CredentialPermissionDiagnosticConfig,
): Promise<readonly OverPermissiveCredentialFile[]> {
  // Windows does not implement POSIX mode bits, so every file would report the
  // same synthetic mode and the diagnostic would be noise rather than evidence.
  if ((config.platform ?? process.platform) === "win32") return [];
  const findings: OverPermissiveCredentialFile[] = [];
  await collect(config.rootDir, config.rootDir, findings);
  return findings.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collect(
  rootDir: string,
  currentDir: string,
  findings: OverPermissiveCredentialFile[],
): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await collect(rootDir, path, findings);
      continue;
    }
    // Health and usage metadata are operational evidence, not credential secrets.
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (currentDir !== rootDir && isMetadataDirectory(currentDir, rootDir)) continue;
    let mode: number;
    try {
      mode = (await stat(path)).mode & 0o777;
    } catch {
      continue;
    }
    if (!isOverPermissiveCredentialMode(mode)) continue;
    findings.push({
      relativePath: relative(rootDir, path).split(/[\\/]/).join("/"),
      mode: mode.toString(8).padStart(3, "0"),
    });
  }
}

function isMetadataDirectory(currentDir: string, rootDir: string): boolean {
  const segment = relative(rootDir, currentDir).split(/[\\/]/)[0];
  return segment !== undefined && segment.startsWith(".");
}
