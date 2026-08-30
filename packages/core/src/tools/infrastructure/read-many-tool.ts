import { basename, join, relative } from "node:path";
import { type BuiltinFilesystem, unavailableBuiltinFilesystem } from "../contracts/builtin-filesystem.js";
import { fileToolMetadata, type ToolOutputVerbosity } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { looksBinaryFilePath } from "./file-content-helpers.js";
import { parseOutputVerbosity, pluralize } from "./output-verbosity.js";
import {
  getSandboxContext,
  matchesGlob,
  normalizePath,
  optionalBoolean,
  optionalNumber,
  resolvePath,
  toErrorResult,
  validateReadPath,
} from "./tool-helpers.js";

const DEFAULT_MAX_FILES = 50;
const MAX_FILES = 200;
const DEFAULT_MAX_BYTES = 256 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_EXCLUDED_DIRECTORIES = new Set([".git", "build", "coverage", "dist", "node_modules"]);

interface ReadManyFile {
  readonly path: string;
  readonly content: string;
  readonly bytes: number;
  readonly truncated: boolean;
}

interface ReadManySkippedFile {
  readonly path: string;
  readonly reason: "binary" | "excluded" | "gitignored" | "max_files" | "read_denied" | "not_file" | "not_found";
  readonly detail?: string;
}

interface ReadManyOutput {
  readonly root: string;
  readonly files: readonly ReadManyFile[];
  readonly skipped: readonly ReadManySkippedFile[];
  readonly fileCount: number;
  readonly skippedCount: number;
  readonly totalBytes: number;
  readonly truncated: boolean;
}

interface Candidate {
  readonly path: string;
}

export class ReadManyTool implements DevTool {
  readonly name = "read_many";
  readonly description = TOOL_SCHEMAS.read_many.description;
  readonly inputSchema = TOOL_SCHEMAS.read_many.inputSchema;
  private readonly filesystem: BuiltinFilesystem;

  constructor(filesystem: BuiltinFilesystem = unavailableBuiltinFilesystem) {
    this.filesystem = filesystem;
  }

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const paths = parseStringArray(input.input.paths, "paths");
    if (!paths.ok || paths.value.length === 0) {
      return toErrorResult('Invalid input: "paths" must be a non-empty array of strings');
    }
    const include = parseStringArray(input.input.include, "include");
    if (!include.ok) return include.result;
    const exclude = parseStringArray(input.input.exclude, "exclude");
    if (!exclude.ok) return exclude.result;
    const verbosity = parseOutputVerbosity(input);
    if (!verbosity.ok) return verbosity.result;

    const context = getSandboxContext(sandbox);
    const root = context?.cwd ?? process.cwd();
    const recursive = optionalBoolean(input, "recursive") ?? false;
    const respectGitIgnore = optionalBoolean(input, "respectGitIgnore") ?? false;
    const useDefaultExcludes = optionalBoolean(input, "useDefaultExcludes") ?? true;
    const maxFiles = clamp(optionalNumber(input, "maxFiles"), DEFAULT_MAX_FILES, MAX_FILES);
    const maxBytes = clamp(optionalNumber(input, "maxBytes"), DEFAULT_MAX_BYTES, MAX_BYTES);
    const gitignorePatterns = respectGitIgnore ? await readGitignore(this.filesystem, root, sandbox) : [];
    const skipped: ReadManySkippedFile[] = [];
    const candidates = await collectCandidates(this.filesystem, paths.value, root, recursive, useDefaultExcludes, sandbox, skipped);

    const files: ReadManyFile[] = [];
    let totalBytes = 0;
    let truncated = false;

    for (const candidate of candidates) {
      const relativePath = normalizePath(relative(root, candidate.path) || basename(candidate.path));
      const denied = validateReadPath(candidate.path, sandbox);
      if (denied) {
        skipped.push({ path: candidate.path, reason: "read_denied", detail: denied });
        continue;
      }
      if (include.value.length > 0 && !matchesAny(relativePath, include.value)) {
        skipped.push({ path: candidate.path, reason: "excluded" });
        continue;
      }
      if (exclude.value.length > 0 && matchesAny(relativePath, exclude.value)) {
        skipped.push({ path: candidate.path, reason: "excluded" });
        continue;
      }
      if (respectGitIgnore && matchesAny(relativePath, gitignorePatterns)) {
        skipped.push({ path: candidate.path, reason: "gitignored" });
        continue;
      }
      if (looksBinaryFilePath(candidate.path)) {
        skipped.push({ path: candidate.path, reason: "binary" });
        continue;
      }
      if (files.length >= maxFiles) {
        skipped.push({ path: candidate.path, reason: "max_files" });
        truncated = true;
        continue;
      }

      const content = await this.filesystem.readFile(candidate.path);
      if (content.includes(0)) {
        skipped.push({ path: candidate.path, reason: "binary" });
        continue;
      }

      const remainingBytes = maxBytes - totalBytes;
      if (remainingBytes <= 0) {
        skipped.push({ path: candidate.path, reason: "max_files", detail: "maxBytes exhausted" });
        truncated = true;
        continue;
      }

      const slice = content.subarray(0, remainingBytes);
      const fileTruncated = slice.length < content.length;
      totalBytes += slice.length;
      truncated = truncated || fileTruncated;
      files.push({
        path: candidate.path,
        content: slice.toString("utf8"),
        bytes: slice.length,
        truncated: fileTruncated,
      });
    }

    const output: ReadManyOutput = {
      root,
      files,
      skipped,
      fileCount: files.length,
      skippedCount: skipped.length,
      totalBytes,
      truncated,
    };

    return {
      output: formatOutput(output, verbosity.value),
      isError: false,
      metadata: fileToolMetadata("read_many", {
        operation: "read_many",
        filePath: root,
        fileCount: files.length,
        skippedCount: skipped.length,
        totalBytes,
        truncated,
        verbosity: verbosity.value,
      }),
      resourcePayload: {
        title: "read_many full output",
        mimeType: "text/plain",
        text: formatOutput(output, "raw"),
      },
    };
  }
}

async function collectCandidates(
  filesystem: BuiltinFilesystem,
  inputPaths: readonly string[],
  root: string,
  recursive: boolean,
  useDefaultExcludes: boolean,
  sandbox: unknown,
  skipped: ReadManySkippedFile[],
): Promise<readonly Candidate[]> {
  const candidates = new Map<string, Candidate>();
  for (const rawPath of inputPaths) {
    const path = resolvePath(rawPath, sandbox);
    const denied = validateReadPath(path, sandbox);
    if (denied) {
      skipped.push({ path, reason: "read_denied", detail: denied });
      continue;
    }
    try {
      const info = await filesystem.lstat(path);
      if (info.isFile()) {
        candidates.set(path, { path });
      } else if (info.isDirectory()) {
        await collectDirectory(filesystem, path, recursive, useDefaultExcludes, sandbox, candidates);
      } else {
        skipped.push({ path, reason: "not_file" });
      }
    } catch (caught) {
      const error = caught as Error;
      skipped.push({ path, reason: "not_found", detail: error.message });
    }
  }
  return Array.from(candidates.values()).sort((left, right) => {
    const leftPath = normalizePath(relative(root, left.path) || left.path);
    const rightPath = normalizePath(relative(root, right.path) || right.path);
    return leftPath.localeCompare(rightPath, "en");
  });
}

async function collectDirectory(
  filesystem: BuiltinFilesystem,
  directory: string,
  recursive: boolean,
  useDefaultExcludes: boolean,
  sandbox: unknown,
  candidates: Map<string, Candidate>,
): Promise<void> {
  const entries = await filesystem.readdir(directory, { withFileTypes: true });
  const sorted = entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
    return left.name.localeCompare(right.name, "en");
  });

  for (const entry of sorted) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && useDefaultExcludes && DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (validateReadPath(path, sandbox)) continue;
    if (entry.isDirectory()) {
      if (recursive) await collectDirectory(filesystem, path, recursive, useDefaultExcludes, sandbox, candidates);
      continue;
    }
    if (entry.isFile()) candidates.set(path, { path });
  }
}

function formatOutput(output: ReadManyOutput, verbosity: ToolOutputVerbosity): string {
  if (verbosity === "structured") return JSON.stringify(output, null, 2);
  if (verbosity === "summary") {
    return `${output.fileCount} ${pluralize(output.fileCount, "file")} read, ${output.skippedCount} skipped, ${output.totalBytes} bytes${output.truncated ? " (truncated)" : ""}`;
  }
  return output.files.map((file) => `--- ${file.path}\n${file.content}`).join("\n");
}

function parseStringArray(value: unknown, key: string): { ok: true; value: readonly string[] } | { ok: false; result: ToolResult } {
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.length === 0)) {
    return { ok: false, result: toErrorResult(`Invalid input: "${key}" must be an array of non-empty strings`) };
  }
  return { ok: true, value };
}

function clamp(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

async function readGitignore(filesystem: BuiltinFilesystem, root: string, sandbox?: unknown): Promise<readonly string[]> {
  const path = join(root, ".gitignore");
  if (validateReadPath(path, sandbox)) return [];
  try {
    const content = await filesystem.readFile(path, "utf8");
    return content.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#"))
      .map((line) => normalizePath(line));
  } catch {
    return [];
  }
}

function matchesAny(relativePath: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(relativePath, pattern));
}
