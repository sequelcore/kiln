import { lstat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/**
 * Check and, when requested, create a Runtime-owned private directory without
 * traversing a symbolic link, junction, or non-directory entry.
 *
 * The directory chain is walked from the filesystem root on every effect. A
 * caller's composition-time check is therefore not treated as authority if a
 * path entry is replaced before a later Runtime read or write.
 */
export async function ensurePrivateStateDirectory(
  privateStateRoot: string,
  targetDirectory: string,
  create: boolean,
): Promise<boolean> {
  const target = assertPrivateTarget(privateStateRoot, targetDirectory);
  const root = parse(target).root;
  let current = root;
  for (const segment of pathSegments(root, target)) {
    current = join(current, segment);
    let stat: Awaited<ReturnType<typeof lstat>>;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      if (!create) return false;
      try {
        await mkdir(current, { recursive: false, mode: 0o700 });
      } catch (mkdirError) {
        if (!isAlreadyExistsError(mkdirError)) throw mkdirError;
      }
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Private project state path contains an unsafe entry.");
    }
  }
  return true;
}

/**
 * Validate a private file target immediately before an effect opens it. A
 * missing file is allowed so a caller can create it after its parent chain has
 * been checked; an existing target must be a regular, non-link file.
 */
export async function assertPrivateStateFileTarget(
  privateStateRoot: string,
  filePath: string,
): Promise<void> {
  const target = assertPrivateTarget(privateStateRoot, filePath);
  if (!await ensurePrivateStateDirectory(privateStateRoot, dirname(target), false)) return;
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Private project state file target is not a regular file.");
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

/** Validate lexical containment before any physical path walk. */
export function assertPrivateStateTarget(privateStateRoot: string, targetPath: string): string {
  return assertPrivateTarget(privateStateRoot, targetPath);
}

function assertPrivateTarget(privateStateRoot: string, targetPath: string): string {
  const root = resolve(privateStateRoot);
  const target = resolve(targetPath);
  const path = relative(root, target);
  if (path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))) return target;
  throw new Error("Private project state target escapes its canonical root.");
}

function pathSegments(root: string, target: string): readonly string[] {
  return relative(root, target).split(/[\\/]+/u).filter((segment) => segment.length > 0 && segment !== ".");
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ((error as NodeJS.ErrnoException).code === "ENOENT"
      || (error as NodeJS.ErrnoException).code === "ENOTDIR");
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && (error as NodeJS.ErrnoException).code === "EEXIST";
}
