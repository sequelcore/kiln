import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { stringify } from "yaml";

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
}

interface ProjectContextFrontmatter {
  readonly version: "1";
  readonly source: "deterministic-repo-scout";
  readonly projectName: string;
  readonly packageManager?: string;
  readonly scripts?: Record<string, string>;
  readonly workspacePackages?: readonly string[];
  readonly canonicalDocs?: readonly string[];
}

const PROJECT_CONTEXT_PATH = ".kiln/project-context.md";

export function projectContextPath(projectPath: string): string {
  return join(projectPath, PROJECT_CONTEXT_PATH);
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
      "docs/architecture/engineering-standards.md",
      "docs/research/README.md",
      "docs/roadmap/README.md",
    ].filter((relativePath) => existsSync(join(projectPath, relativePath))),
  };
}

export function renderProjectContextMarkdown(evidence: ProjectContextEvidence): string {
  const frontmatter: ProjectContextFrontmatter = {
    version: "1",
    source: "deterministic-repo-scout",
    projectName: evidence.projectName,
    ...(evidence.packageManager ? { packageManager: evidence.packageManager } : {}),
    ...(evidence.scripts.length > 0 ? { scripts: Object.fromEntries(evidence.scripts) } : {}),
    ...(evidence.workspacePackages.length > 0 ? { workspacePackages: evidence.workspacePackages } : {}),
    ...(evidence.docs.length > 0 ? { canonicalDocs: evidence.docs } : {}),
  };

  const lines: string[] = [
    "---",
    stringify(frontmatter).trim(),
    "---",
    "",
    "# Project Context",
    "",
    "This file is canonical Kiln project context. Edit this file or regenerate it",
    "through `kiln project adopt`; do not put durable repo guidance directly in",
    "`AGENTS.md` or `CLAUDE.md`.",
    "",
    "## Project",
    "",
    `- Name: ${evidence.projectName}`,
  ];

  if (evidence.packageManager) {
    lines.push(`- Package manager: ${evidence.packageManager}`);
  }

  if (evidence.workspacePackages.length > 0) {
    lines.push(...evidence.workspacePackages.map((workspacePackage) => `- Workspace package: \`${workspacePackage}\``));
  }

  if (evidence.scripts.length > 0) {
    lines.push("", "## Commands", "");
    for (const [name, command] of evidence.scripts) {
      lines.push(`- \`${name}\`: \`${command}\``);
    }
  }

  if (evidence.docs.length > 0) {
    lines.push("", "## Canonical References", "");
    lines.push(...evidence.docs.map((doc) => `- ${doc}`));
  }

  lines.push(
    "",
    "## Agent Review Notes",
    "",
    "Add governed repo-specific notes here after review. Keep them factual,",
    "durable, and backed by repository evidence.",
    "",
  );

  return lines.join("\n");
}

export function readProjectContextMarkdown(projectPath: string): string | null {
  const path = projectContextPath(projectPath);
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf-8");
}

export function writeProjectContextAdoption(
  projectPath: string,
  options: ProjectContextAdoptionOptions = {},
): ProjectContextAdoptionResult {
  const path = projectContextPath(projectPath);
  const evidence = collectProjectContextEvidence(projectPath);
  const content = renderProjectContextMarkdown(evidence);
  const existing = existsSync(path) ? readFileSync(path, "utf-8") : null;

  if (existing === content) {
    return { written: false, path, status: "unchanged", errors: [] };
  }

  if (existing && !options.force) {
    return {
      written: false,
      path,
      status: "blocked",
      errors: [`${PROJECT_CONTEXT_PATH}: existing project context differs; review it or rerun with --force`],
    };
  }

  if (existing && options.force) {
    backupProjectContext(projectPath, existing);
  }

  mkdirSync(join(projectPath, ".kiln"), { recursive: true });
  writeFileSync(path, content, "utf-8");
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

function backupProjectContext(projectPath: string, content: string): void {
  const backupDir = join(projectPath, ".kiln", "backups", "project-context");
  mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(backupDir, `project-context.md.${timestamp}.bak`), content, "utf-8");
}
