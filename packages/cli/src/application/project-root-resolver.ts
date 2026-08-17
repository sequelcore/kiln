import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export type ProjectRootSource = "kiln-yaml" | "git" | "explicit" | "cwd";

export interface ProjectRootResolution {
  readonly rootPath: string;
  readonly source: ProjectRootSource;
  readonly hasKilnYaml: boolean;
  readonly hasGitRoot: boolean;
  readonly projectName: string;
}

export interface ResolveProjectRootOptions {
  readonly cwd?: string;
  readonly explicitPath?: string;
  readonly userHome?: string;
}

export function resolveProjectRoot(options: ResolveProjectRootOptions = {}): ProjectRootResolution {
  const cwd = resolve(options.cwd ?? process.cwd());
  const start = normalizeStartPath(resolve(cwd, options.explicitPath ?? "."));
  const candidates = collectCandidateRoots(start, resolve(options.userHome ?? homedir()));
  const kilnRoot = candidates.find(hasKilnMarker);

  if (kilnRoot) {
    return {
      rootPath: kilnRoot,
      source: "kiln-yaml",
      hasKilnYaml: true,
      hasGitRoot: hasGitMarker(kilnRoot),
      projectName: readProjectName(kilnRoot),
    };
  }

  const gitRoot = candidates.find(hasGitMarker);
  if (gitRoot) {
    return {
      rootPath: gitRoot,
      source: "git",
      hasKilnYaml: false,
      hasGitRoot: true,
      projectName: readProjectName(gitRoot),
    };
  }

  return {
    rootPath: start,
    source: options.explicitPath ? "explicit" : "cwd",
    hasKilnYaml: false,
    hasGitRoot: false,
    projectName: readProjectName(start),
  };
}

function normalizeStartPath(path: string): string {
  if (!existsSync(path)) {
    return path;
  }
  return statSync(path).isFile() ? dirname(path) : path;
}

/**
 * The directories eligible to be adopted as the project root, nearest first:
 * the starting directory, then each ancestor that stays below the user home.
 *
 * The user home and everything above it hold shared operator state, never a
 * single project. Without that boundary a git-tracked home — an ordinary
 * dotfiles setup — makes every directory nested under it resolve to the home
 * repository, so Kiln reads and writes `.kiln` state outside the workspace the
 * caller is actually in. The Windows temporary directory lives under the home
 * directory, which puts scratch and test runs in that position by default.
 *
 * The starting directory itself always stays eligible: a caller who names a
 * directory has already stated where the project is, and a home directory the
 * operator adopted deliberately still resolves when it is the starting point.
 */
function collectCandidateRoots(start: string, userHome: string): string[] {
  const candidates = [start];
  let current = start;
  while (true) {
    const parent = dirname(current);
    if (parent === current || contains(parent, userHome)) {
      return candidates;
    }
    candidates.push(parent);
    current = parent;
  }
}

function contains(ancestor: string, descendant: string): boolean {
  const relativePath = relative(ancestor, descendant);
  if (relativePath === "") {
    return true;
  }
  if (isAbsolute(relativePath)) {
    return false;
  }
  return relativePath !== ".." && !relativePath.startsWith(`..${sep}`);
}

function hasKilnMarker(candidate: string): boolean {
  return existsSync(join(candidate, ".kiln", "kiln.yaml"));
}

function hasGitMarker(candidate: string): boolean {
  return existsSync(join(candidate, ".git"));
}

function readProjectName(projectPath: string): string {
  const packageJsonPath = join(projectPath, "package.json");
  if (existsSync(packageJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf-8")) as { name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.trim().length > 0) {
        return parsed.name.trim();
      }
    } catch {
      return basename(projectPath);
    }
  }
  return basename(projectPath);
}
