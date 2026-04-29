import { readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { inspectionToolMetadata } from "../domain/tool-result-metadata.js";
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

const DEFAULT_DEPTH = 2;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 500;
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
  entryCount: number;
  truncated: boolean;
}

export class TreeTool implements DevTool {
  readonly name = "tree";
  readonly description = TOOL_SCHEMAS.tree.description;
  readonly inputSchema = TOOL_SCHEMAS.tree.inputSchema;
  readonly annotations = TOOL_SCHEMAS.tree.annotations;

  async execute(input: ToolInput, sandbox?: unknown): Promise<ToolResult> {
    const context = getSandboxContext(sandbox);
    const rootPath = resolvePath(
      optionalString(input, "path") ?? context?.cwd ?? process.cwd(),
      sandbox,
    );
    const depth = clampDepth(optionalNumber(input, "depth"));
    const includeFiles = optionalBoolean(input, "includeFiles") ?? true;
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
        }));
      }

      const state: TreeState = {
        lines: ["."],
        entryCount: 0,
        truncated: false,
      };
      await appendDirectoryEntries(rootPath, 1, depth, includeFiles, state, sandbox);

      return toSuccessResult(state.lines.join("\n"), inspectionToolMetadata("tree", {
        operation: "tree",
        path: rootPath,
        depth,
        includeFiles,
        entryCount: state.entryCount,
        truncated: state.truncated,
        ignoredDirectories: IGNORED_DIRECTORIES,
      }));
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
