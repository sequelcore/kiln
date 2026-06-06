import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

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
}

export function resolveProjectRoot(options: ResolveProjectRootOptions = {}): ProjectRootResolution {
  const cwd = resolve(options.cwd ?? process.cwd());
  const start = normalizeStartPath(resolve(cwd, options.explicitPath ?? "."));
  const kilnRoot = findAncestor(start, (candidate) => existsSync(join(candidate, ".kiln", "kiln.yaml")));

  if (kilnRoot) {
    return {
      rootPath: kilnRoot,
      source: "kiln-yaml",
      hasKilnYaml: true,
      hasGitRoot: hasGitMarker(kilnRoot),
      projectName: readProjectName(kilnRoot),
    };
  }

  const gitRoot = findAncestor(start, hasGitMarker);
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

function findAncestor(start: string, predicate: (candidate: string) => boolean): string | null {
  let current = start;
  while (true) {
    if (predicate(current)) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function hasGitMarker(candidate: string): boolean {
  if (resolve(candidate) === resolve(homedir())) {
    return false;
  }
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
