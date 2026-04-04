import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ContextArtifact } from "@kilnai/core";

const FILE_PATH_PREFIX = "File path touched: ";
const MODULE_PREVIEW_LINE_LIMIT = 20;
const MODULE_PREVIEW_CHAR_LIMIT = 800;

export function extractTouchedFilePaths(exactArtifacts: readonly string[]): string[] {
  const paths = new Set<string>();
  for (const artifact of exactArtifacts) {
    if (artifact.startsWith(FILE_PATH_PREFIX)) {
      const filePath = artifact.slice(FILE_PATH_PREFIX.length).trim();
      if (filePath !== "") paths.add(filePath);
    }
  }
  return [...paths];
}

function resolveProjectRelativePath(
  projectPath: string,
  filePath: string,
): { resolvedProject: string; relativePath: string; resolvedFile: string } | undefined {
  const resolvedProject = resolve(projectPath);
  const resolvedFile = resolve(filePath);
  const relativePath = relative(resolvedProject, resolvedFile);
  if (
    relativePath === ""
    || relativePath.startsWith("..")
    || relativePath.includes(":")
  ) {
    return undefined;
  }
  return { resolvedProject, relativePath, resolvedFile };
}

function buildModulePreview(content: string): string {
  return content
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "")
    .slice(0, MODULE_PREVIEW_LINE_LIMIT)
    .join("\n")
    .slice(0, MODULE_PREVIEW_CHAR_LIMIT)
    .trim();
}

export async function buildModuleArtifactKey(
  projectPath: string,
  filePath: string,
): Promise<string | undefined> {
  const resolved = resolveProjectRelativePath(projectPath, filePath);
  if (!resolved) {
    return undefined;
  }
  try {
    const content = await readFile(resolved.resolvedFile, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    return `module-summary:${resolved.resolvedProject}:${resolved.relativePath}:${hash}`;
  } catch {
    return undefined;
  }
}

export async function buildModuleSummaryArtifact(
  projectPath: string,
  filePath: string,
): Promise<ContextArtifact | undefined> {
  const resolved = resolveProjectRelativePath(projectPath, filePath);
  if (!resolved) {
    return undefined;
  }

  try {
    const content = await readFile(resolved.resolvedFile, "utf-8");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const preview = buildModulePreview(content);
    const now = new Date();
    return {
      key: `module-summary:${resolved.resolvedProject}:${resolved.relativePath}:${hash}`,
      kind: "module-summary",
      content: [
        `Module path: ${resolved.relativePath}`,
        `Content hash: ${hash}`,
        "Summary basis: current file contents",
        "Preview:",
        preview,
      ].join("\n"),
      createdAt: now,
      updatedAt: now,
      tags: [resolved.relativePath, hash],
    };
  } catch {
    return undefined;
  }
}
