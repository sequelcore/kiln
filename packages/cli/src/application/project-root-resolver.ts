import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ProjectRootSource = "git" | "explicit" | "cwd";

export interface ProjectRootResolution {
  readonly rootPath: string;
  readonly source: ProjectRootSource;
  readonly hasGitRoot: boolean;
  readonly projectName: string;
}

export interface ResolveProjectRootOptions {
  readonly cwd?: string;
  readonly explicitPath?: string;
  readonly userHome?: string;
}

/**
 * Resolve a project from explicit path, Git ancestry, or the process cwd.
 *
 * Repository-local `.kiln` state is deliberately not inspected. A Git
 * worktree's `.git` file is a valid root marker; symlinked markers are not.
 * Ancestor discovery stops at the operator home for projects below that home,
 * so a dotfiles repository cannot silently capture every child directory.
 */
export function resolveProjectRoot(options: ResolveProjectRootOptions = {}): ProjectRootResolution {
  const processCwd = resolveExistingDirectory(options.cwd ?? process.cwd(), "cwd");
  const start =
    options.explicitPath === undefined
      ? processCwd
      : resolveExistingDirectory(resolve(processCwd, options.explicitPath), "explicit project path");
  const userHome = resolveOptionalCanonicalDirectory(options.userHome ?? homedir());
  const candidates = collectCandidateRoots(start, userHome);
  const gitRoot = candidates.find(hasGitMarker);
  const rootPath = gitRoot ?? start;

  return {
    rootPath,
    source: gitRoot === undefined ? (options.explicitPath === undefined ? "cwd" : "explicit") : "git",
    hasGitRoot: gitRoot !== undefined,
    projectName: readProjectName(rootPath),
  };
}

function collectCandidateRoots(start: string, userHome: string): readonly string[] {
  const candidates: string[] = [start];
  if (samePath(start, userHome)) return candidates;

  const startIsInsideHome = isInside(userHome, start);
  let current = start;
  while (true) {
    const parent = dirname(current);
    if (parent === current) break;
    if (startIsInsideHome && samePath(parent, userHome)) break;
    candidates.push(parent);
    current = parent;
  }
  return candidates;
}

function hasGitMarker(candidate: string): boolean {
  try {
    const marker = lstatSync(join(candidate, ".git"));
    return marker.isDirectory() || marker.isFile();
  } catch {
    return false;
  }
}

function readProjectName(projectPath: string): string {
  const packageJsonPath = join(projectPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim().length > 0) return parsed.name.trim();
    } catch {
      // The directory name remains a safe display fallback for malformed manifests.
    }
  }
  return basename(projectPath);
}

function resolveExistingDirectory(path: string, label: string): string {
  let canonicalPath: string;
  try {
    canonicalPath = realpathSync(path);
  } catch {
    throw new Error(`${label} does not exist: ${path}`);
  }
  try {
    if (!lstatSync(canonicalPath).isDirectory()) throw new Error(`${label} is not a directory: ${path}`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`${label} is not a directory:`)) throw error;
    throw new Error(`${label} cannot be inspected: ${path}`);
  }
  return canonicalPath;
}

function resolveOptionalCanonicalDirectory(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isInside(ancestor: string, descendant: string): boolean {
  const path = relative(ancestor, descendant);
  return path !== "" && !path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path);
}
