import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import { resolveProjectRoot } from "./project-root-resolver.js";
import type { ProjectStateBinding } from "./project-state-root.js";

export type ProjectInstructionTarget = "agents" | "claude";

export type ProjectInstructionStatusKind =
  | "missing"
  | "project-owned"
  | "unreadable";

export type ProjectInstructionStatus =
  | {
    readonly target: ProjectInstructionTarget;
    readonly path: string;
    readonly status: Exclude<ProjectInstructionStatusKind, "unreadable">;
  }
  | {
    readonly target: ProjectInstructionTarget;
    readonly path: string;
    readonly status: "unreadable";
    readonly details: string;
  };

export interface ProjectInstructionStatusOptions {
  /** Established project binding used to keep status reads on one root. */
  readonly projectStateBinding?: ProjectStateBinding;
}

interface ProjectInstructionTargetDefinition {
  readonly target: ProjectInstructionTarget;
  readonly filename: string;
}

const PROJECT_INSTRUCTION_TARGETS: readonly ProjectInstructionTargetDefinition[] = [
  { target: "agents", filename: "AGENTS.md" },
  { target: "claude", filename: "CLAUDE.md" },
];
/**
 * Inspect the two project-owned instruction entrypoints without generating,
 * repairing, or otherwise mutating repository files.
 */
export async function readProjectInstructionStatuses(
  projectPath: string,
  options: ProjectInstructionStatusOptions = {},
): Promise<readonly ProjectInstructionStatus[]> {
  const canonicalRoot = resolveProjectInstructionRoot(projectPath, options);
  return PROJECT_INSTRUCTION_TARGETS.map((target) => {
    const path = join(canonicalRoot, target.filename);
    try {
      const content = readProjectInstructionFile(canonicalRoot, path);
      return projectInstructionStatus(target.target, path, content);
    } catch (error) {
      return {
        target: target.target,
        path,
        status: "unreadable",
        details: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function projectInstructionStatus(
  target: ProjectInstructionTarget,
  path: string,
  content: string | null,
): ProjectInstructionStatus {
  if (content === null) {
    return { target, path, status: "missing" };
  }
  return { target, path, status: "project-owned" };
}

function resolveProjectInstructionRoot(
  projectPath: string,
  options: ProjectInstructionStatusOptions,
): string {
  const root = options.projectStateBinding?.canonicalRoot
    ?? resolveProjectRoot({ explicitPath: projectPath }).rootPath;
  return assertProjectInstructionRepositoryRootSync(root);
}

function readProjectInstructionFile(root: string, path: string): string | null {
  assertProjectInstructionTargetSync(root, path);
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (isMissingPathError(error)) return null;
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error("Project instruction target is not a regular file.");
  }

  const content = readFileSync(path, "utf-8");
  assertProjectInstructionTargetSync(root, path);
  return content;
}

function assertProjectInstructionTargetSync(rootPath: string, targetPath: string): void {
  const canonicalRoot = assertProjectInstructionRepositoryRootSync(rootPath);
  const target = resolve(targetPath);
  const path = relative(canonicalRoot, target);
  if (
    path.length === 0
    || path === ".."
    || path.startsWith(`..${sep}`)
    || isAbsolute(path)
  ) {
    throw new Error("Project instruction target escapes its canonical root.");
  }

  try {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Project instruction target is not a regular file.");
    }
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
}

function assertProjectInstructionRepositoryRootSync(rootPath: string): string {
  const canonicalRoot = resolve(rootPath);
  let rootStat;
  try {
    rootStat = lstatSync(canonicalRoot);
  } catch (error) {
    throw new Error(`Project instruction repository root cannot be inspected: ${canonicalRoot}`, { cause: error });
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Project instruction repository root is not a canonical directory.");
  }

  let observedRoot: string;
  try {
    observedRoot = realpathSync(canonicalRoot);
  } catch (error) {
    throw new Error(`Project instruction repository root cannot be canonicalized: ${canonicalRoot}`, { cause: error });
  }
  if (!sameRepositoryPath(observedRoot, canonicalRoot)) {
    throw new Error("Project instruction repository root changed from its established canonical path.");
  }
  return canonicalRoot;
}

function sameRepositoryPath(left: string, right: string): boolean {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error
    && "code" in error
    && ((error as NodeJS.ErrnoException).code === "ENOENT"
      || (error as NodeJS.ErrnoException).code === "ENOTDIR");
}
