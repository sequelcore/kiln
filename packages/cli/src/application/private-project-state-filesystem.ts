import { lstatSync, mkdirSync } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/**
 * Effect-time guard for operator-private project state. It rejects link,
 * junction, and special-file traversal before a child owner opens its store.
 */
export function ensurePrivateStateDirectorySync(
  projectStateRoot: string,
  targetDirectory: string,
): void {
  const target = assertPrivateTarget(projectStateRoot, targetDirectory);
  walkDirectoryChainSync(target);
}

/**
 * Check an existing private directory without creating missing state.
 *
 * Read-only callers use this immediately before opening or enumerating a
 * directory. A missing directory is an ordinary cache/catalog miss; an
 * existing link or special entry is an unsafe private-state path.
 */
export function assertPrivateStateDirectoryTargetSync(
  projectStateRoot: string,
  targetDirectory: string,
): boolean {
  const target = assertPrivateTarget(projectStateRoot, targetDirectory);
  const root = parse(target).root;
  let current = root;
  for (const segment of pathSegments(root, target)) {
    current = join(current, segment);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isMissingPathError(error)) return false;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Private project state path contains an unsafe entry.");
    }
  }
  return true;
}

export function assertPrivateStateFileTargetSync(
  projectStateRoot: string,
  filePath: string,
): void {
  const target = assertPrivateTarget(projectStateRoot, filePath);
  walkDirectoryChainSync(dirname(target));
  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Private project state file target is not a regular file.");
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

export async function ensurePrivateStateDirectory(
  projectStateRoot: string,
  targetDirectory: string,
  create: boolean,
): Promise<boolean> {
  const target = assertPrivateTarget(projectStateRoot, targetDirectory);
  const root = parse(target).root;
  let current = root;
  for (const segment of pathSegments(root, target)) {
    current = join(current, segment);
    let stat;
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

export async function assertPrivateStateFileTarget(
  projectStateRoot: string,
  filePath: string,
): Promise<void> {
  const target = assertPrivateTarget(projectStateRoot, filePath);
  if (!await ensurePrivateStateDirectory(projectStateRoot, dirname(target), false)) return;
  try {
    const stat = await lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Private project state file target is not a regular file.");
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

function walkDirectoryChainSync(target: string): void {
  const root = parse(target).root;
  let current = root;
  for (const segment of pathSegments(root, target)) {
    current = join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Private project state path contains an unsafe entry.");
      }
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      try {
        mkdirSync(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (!isAlreadyExistsError(mkdirError)) throw mkdirError;
      }
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Private project state path contains an unsafe entry.");
      }
    }
  }
}

function assertPrivateTarget(projectStateRoot: string, targetPath: string): string {
  const root = resolve(projectStateRoot);
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
