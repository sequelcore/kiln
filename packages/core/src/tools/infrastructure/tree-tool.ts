import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { inspectionToolMetadata, type ToolOutputVerbosity } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import {
  getSandboxContext,
  optionalBoolean,
  optionalNumber,
  optionalString,
  resolvePath,
  toErrorResult,
  toSuccessResult,
  validateReadPath,
} from "./tool-helpers.js";
import { parseOutputVerbosity, pluralize } from "./output-verbosity.js";

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 500;
const SUMMARY_LINE_LIMIT = 40;
const IGNORED_DIRECTORIES = [
  ".git",
  ".kiln-worktrees",
  "build",
  "coverage",
  "dist",
  "node_modules",
] as const;

interface TreeEntry {
  readonly name: string;
  readonly path: string;
  readonly isDirectory: boolean;
  readonly isFile: boolean;
  readonly isSymbolicLink: boolean;
}

interface TreeState {
  readonly lines: string[];
  readonly entries: TreeOutputEntry[];
  entryCount: number;
  truncated: boolean;
}

interface TreeOutputEntry {
  readonly name: string;
  readonly type: "directory" | "file";
  readonly depth: number;
}

export class TreeTool implements DevTool {
  readonly name = "tree";
  readonly description = TOOL_SCHEMAS.tree.description;
  readonly inputSchema = TOOL_SCHEMAS.tree.inputSchema;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const context = getSandboxContext(sandbox);
    const rootPath = resolvePath(
      optionalString(input, "path") ?? context?.cwd ?? process.cwd(),
      sandbox,
    );
    const depth = clampDepth(optionalNumber(input, "depth"));
    const includeFiles = optionalBoolean(input, "includeFiles") ?? true;
    const verbosityInput = parseOutputVerbosity(input);
    if (!verbosityInput.ok) {
      return verbosityInput.result;
    }
    const readError = validateReadPath(rootPath, sandbox);
    if (readError) {
      return toErrorResult(readError, inspectionToolMetadata("tree", {
        operation: "tree",
        path: rootPath,
        depth,
        includeFiles,
        entryCount: 0,
        truncated: false,
        ignoredDirectories: IGNORED_DIRECTORIES,
        verbosity: verbosityInput.value,
      }));
    }

    try {
      const info = await lstat(rootPath);
      if (!info.isDirectory()) {
        return toErrorResult(`${rootPath} is not a directory`, inspectionToolMetadata("tree", {
          operation: "tree",
          path: rootPath,
          depth,
          includeFiles,
          entryCount: 0,
          truncated: false,
          ignoredDirectories: IGNORED_DIRECTORIES,
          verbosity: verbosityInput.value,
        }));
      }

      const state: TreeState = {
        lines: ["."],
        entries: [],
        entryCount: 0,
        truncated: false,
      };
      await appendDirectoryEntries(rootPath, 1, depth, includeFiles, state, sandbox);

      const metadata = inspectionToolMetadata("tree", {
        operation: "tree",
        path: rootPath,
        depth,
        includeFiles,
        entryCount: state.entryCount,
        truncated: state.truncated,
        ignoredDirectories: IGNORED_DIRECTORIES,
        verbosity: verbosityInput.value,
      });
      return toSuccessResult(formatTreeOutput(rootPath, state, verbosityInput.value), metadata);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return toErrorResult(err.message, inspectionToolMetadata("tree", {
        operation: "tree",
        path: rootPath,
        depth,
        includeFiles,
        entryCount: 0,
        truncated: false,
        ignoredDirectories: IGNORED_DIRECTORIES,
        code: err.code,
        verbosity: verbosityInput.value,
      }));
    }
  }
}

async function appendDirectoryEntries(
  rootPath: string,
  level: number,
  maxDepth: number,
  includeFiles: boolean,
  state: TreeState,
  sandbox?: unknown,
): Promise<void> {
  if (level > maxDepth || state.truncated) {
    return;
  }

  const entries = await readEntries(rootPath, sandbox);
  for (const entry of entries) {
    if (state.entryCount >= MAX_ENTRIES) {
      state.truncated = true;
      return;
    }

    if (!entry.isDirectory && (!includeFiles || !entry.isFile)) {
      continue;
    }

    state.lines.push(`${"  ".repeat(level - 1)}${entry.name}${entry.isDirectory ? "/" : ""}`);
    state.entries.push({
      name: entry.name,
      type: entry.isDirectory ? "directory" : "file",
      depth: level,
    });
    state.entryCount += 1;

    if (entry.isDirectory && !entry.isSymbolicLink) {
      await appendDirectoryEntries(entry.path, level + 1, maxDepth, includeFiles, state, sandbox);
    }
  }
}

async function readEntries(rootPath: string, sandbox?: unknown): Promise<readonly TreeEntry[]> {
  const dirEntries = await readdir(rootPath, { withFileTypes: true });
  const entries: TreeEntry[] = [];

  for (const entry of dirEntries) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.includes(entry.name as typeof IGNORED_DIRECTORIES[number])) {
      continue;
    }
    const path = join(rootPath, entry.name);
    if (validateReadPath(path, sandbox)) {
      continue;
    }
    entries.push({
      name: entry.name,
      path,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
      isSymbolicLink: entry.isSymbolicLink(),
    });
  }

  return entries.sort(compareTreeEntries);
}

function compareTreeEntries(left: TreeEntry, right: TreeEntry): number {
  if (left.isDirectory !== right.isDirectory) {
    return left.isDirectory ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "en");
}

function clampDepth(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_DEPTH;
  }
  return Math.max(0, Math.min(MAX_DEPTH, Math.trunc(value)));
}

function formatTreeOutput(
  rootPath: string,
  state: TreeState,
  verbosity: ToolOutputVerbosity,
): string {
  if (verbosity === "structured") {
    return JSON.stringify({
      root: rootPath,
      entries: state.entries,
      entryCount: state.entryCount,
      truncated: state.truncated,
    }, null, 2);
  }

  if (verbosity === "summary") {
    const sample = state.lines.slice(1, SUMMARY_LINE_LIMIT + 1);
    const sampleOutput = sample.length > 0 ? `\n${sample.join("\n")}` : "";
    const sampleTruncated = state.lines.length - 1 > sample.length;
    const suffix = sampleTruncated
      ? `\n[tree summary truncated: showing ${sample.length} of ${state.entryCount} entries]`
      : "";
    return `${state.entryCount} ${pluralize(state.entryCount, "entry", "entries")} under ${rootPath}${state.truncated ? " (truncated)" : ""}${sampleOutput}${suffix}`;
  }

  return state.lines.join("\n");
}
