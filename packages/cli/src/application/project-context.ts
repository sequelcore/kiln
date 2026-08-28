import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parse, stringify } from "yaml";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";
import type { ProjectStateBinding, ProjectStateRootOptions } from "./project-state-root.js";
import { resolveProjectStateBinding } from "./project-state-root.js";

export interface ProjectContextEvidence {
  readonly projectName: string;
  readonly packageManager: string | null;
  readonly scripts: readonly [string, string][];
  readonly workspacePackages: readonly string[];
  readonly docs: readonly string[];
}

export interface ProjectContextAdoptionResult {
  readonly written: boolean;
  readonly path: string;
  readonly status: "written" | "blocked" | "unchanged";
  readonly errors: readonly string[];
}

export interface ProjectContextAdoptionOptions {
  readonly force?: boolean;
  readonly projectStateBinding?: ProjectStateBinding;
  readonly kilnHome?: string;
}

interface ProjectContextFrontmatter {
  readonly version: "2";
  readonly source: "reviewed-project-context";
}

export interface ProjectContextAdoption {
  readonly reviewNotes: string;
}


export function projectContextPath(
  projectPath: string,
  options: ProjectStateRootOptions & { readonly projectStateBinding?: ProjectStateBinding } = {},
): string {
  return options.projectStateBinding?.contextPath
    ?? resolveProjectStateBinding(projectPath, options).contextPath;
}

export function collectProjectContextEvidence(projectPath: string): ProjectContextEvidence {
  const packageJson = readPackageJson(projectPath);
  return {
    projectName: packageJson?.name ?? basename(projectPath),
    packageManager: detectPackageManager(projectPath),
    scripts: Object.entries(packageJson?.scripts ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    workspacePackages: readWorkspacePackages(packageJson),
    docs: [
      "README.md",
      "docs/architecture/README.md",
      "docs/architecture/core/engineering-standards.md",
      "docs/research/README.md",
      "docs/roadmap/README.md",
    ].filter((relativePath) => existsSync(join(projectPath, relativePath))),
  };
}

export function renderProjectContextEvidenceMarkdown(evidence: ProjectContextEvidence): string {
  return [
    "# Repository Evidence",
    "",
    `- Project: ${evidence.projectName}`,
    `- Package manager: ${evidence.packageManager ?? "not detected"}`,
    ...evidence.workspacePackages.map((workspace) => `- Workspace: ${workspace}`),
    "",
    "## Commands",
    "",
    ...(evidence.scripts.length > 0
      ? evidence.scripts.map(([name, command]) => `- \`${name}\`: \`${command}\``)
      : ["- none detected"]),
    "",
    "## Canonical References",
    "",
    ...(evidence.docs.length > 0 ? evidence.docs.map((path) => `- ${path}`) : ["- none detected"]),
    "",
  ].join("\n");
}

export function renderProjectContextMarkdown(adoption: ProjectContextAdoption = { reviewNotes: "" }): string {
  const frontmatter: ProjectContextFrontmatter = {
    version: "2",
    source: "reviewed-project-context",
  };

  const lines: string[] = [
    "---",
    stringify(frontmatter).trim(),
    "---",
    "",
    "# Project Context",
    "",
    "This file owns reviewed repository-wide notes that cannot be derived from",
    "executable repository evidence. Package facts, commands, workspaces, and",
    "standard references remain with their canonical repository owners.",
    "Keep durable team guidance in project-owned `AGENTS.md`; reserve this private context for reviewed facts that cannot be derived or shared.",
    "Regenerate this descriptor through `kiln project adopt` when replacement is",
    "intended.",
  ];

  lines.push(
    "",
    "## Agent Review Notes",
    "",
    ...(adoption.reviewNotes ? [adoption.reviewNotes, ""] : [""]),
  );

  return lines.join("\n");
}

export function parseProjectContextMarkdown(content: string): ProjectContextAdoption {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]*)$/u.exec(content.replace(/^\uFEFF/u, ""));
  if (!match) {
    throw new Error("Project context must use version 2 reviewed-project-context frontmatter.");
  }

  let parsed: unknown;
  try {
    parsed = parse(match[1] ?? "");
  } catch {
    throw new Error("Project context must use valid version 2 reviewed-project-context frontmatter.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Project context must use version 2 reviewed-project-context frontmatter.");
  }
  const record = parsed as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => key !== "version" && key !== "source");
  if (record.version !== "2" || record.source !== "reviewed-project-context" || unknown.length > 0) {
    throw new Error("Project context must use version 2 reviewed-project-context frontmatter without derived repository facts.");
  }

  const body = match[2] ?? "";
  const notesHeading = /^## Agent Review Notes[ \t]*\r?\n/mu.exec(body);
  if (!notesHeading) {
    throw new Error("Project context must contain an Agent Review Notes section.");
  }
  const remainder = body.slice((notesHeading.index ?? 0) + notesHeading[0].length);
  const nextSection = /^##\s/mu.exec(remainder);
  return { reviewNotes: remainder.slice(0, nextSection?.index ?? remainder.length).trim() };
}

export function readProjectContextAdoption(
  projectPath: string,
  options: ProjectContextAdoptionOptions = {},
): ProjectContextAdoption | null {
  const path = projectContextPath(projectPath, options);
  if (!existsSync(path)) {
    return null;
  }
  return parseProjectContextMarkdown(readFileSync(path, "utf-8"));
}

export function writeProjectContextAdoption(
  projectPath: string,
  options: ProjectContextAdoptionOptions = {},
): ProjectContextAdoptionResult {
  const binding = options.projectStateBinding ?? resolveProjectStateBinding(projectPath, options);
  const path = binding.contextPath;
  ensurePrivateStateDirectorySync(binding.projectStateRoot, binding.projectStateRoot);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, path);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;
  let adoption: ProjectContextAdoption = { reviewNotes: "" };
  if (existing) {
    try {
      adoption = parseProjectContextMarkdown(existing);
    } catch {
      // Explicit force may replace invalid or legacy context after backing it up.
    }
  }
  const content = renderProjectContextMarkdown(adoption);

  if (existing === content) {
    return { written: false, path, status: "unchanged", errors: [] };
  }

  if (existing && !options.force) {
    return {
      written: false,
      path,
      status: "blocked",
      errors: ["existing project context differs; review it or rerun with --force"],
    };
  }

  if (existing && options.force) {
    backupProjectContext(binding, existing);
  }

  writeAtomic(binding.projectStateRoot, path, content);
  return { written: true, path, status: "written", errors: [] };
}

function readPackageJson(projectPath: string): { name?: string; scripts?: Record<string, string>; workspaces?: unknown } | null {
  const path = join(projectPath, "package.json");
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as { name?: string; scripts?: Record<string, string>; workspaces?: unknown };
  } catch {
    return null;
  }
}

function readWorkspacePackages(packageJson: { workspaces?: unknown } | null): readonly string[] {
  const workspaces = packageJson?.workspaces;
  if (Array.isArray(workspaces)) {
    return workspaces.filter((entry): entry is string => typeof entry === "string").sort();
  }
  if (typeof workspaces === "object" && workspaces !== null && Array.isArray((workspaces as { packages?: unknown }).packages)) {
    return (workspaces as { packages: unknown[] }).packages
      .filter((entry): entry is string => typeof entry === "string")
      .sort();
  }
  return [];
}

function detectPackageManager(projectPath: string): string | null {
  if (existsSync(join(projectPath, "bun.lock")) || existsSync(join(projectPath, "bun.lockb"))) return "bun";
  if (existsSync(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectPath, "package-lock.json"))) return "npm";
  return null;
}

function backupProjectContext(binding: ProjectStateBinding, content: string): void {
  const backupDir = join(binding.backupsPath, "project-context");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeAtomic(binding.projectStateRoot, join(backupDir, `project-context.md.${timestamp}.bak`), content);
}

function writeAtomic(projectStateRoot: string, path: string, content: string): void {
  ensurePrivateStateDirectorySync(projectStateRoot, dirname(path));
  assertPrivateStateFileTargetSync(projectStateRoot, path);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf-8", flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
