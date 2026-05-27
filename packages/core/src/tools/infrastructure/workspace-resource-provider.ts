import { lstat, open, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { KilnError } from "../../engine/errors.js";
import { isSubPath, type PathValidator } from "../../sandbox/path-validator.js";
import {
  rejectResourceReadCursor,
  type ToolResourceDescriptor,
  type ToolResourceProvider,
  type ToolResourceReadOptions,
  type ToolResourceReadResult,
  type ToolResourceTemplateDescriptor,
} from "../domain/tool-resource-registry.js";
import { inferFileMimeType, looksBinaryFilePath } from "./file-content-helpers.js";
import { normalizePath } from "./tool-helpers.js";

const JSON_MIME_TYPE = "application/json";
const TEXT_MIME_TYPE = "text/plain";
const DEFAULT_TREE_DEPTH = 2;
const MAX_TREE_DEPTH = 8;
const MAX_TREE_ENTRIES = 500;
const DEFAULT_PREVIEW_LINE_LIMIT = 100;
const MAX_PREVIEW_LINE_LIMIT = 1_000;
const DEFAULT_FILE_BYTES = 256 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const IGNORED_DIRECTORIES = new Set([".git", ".kiln-worktrees", "build", "coverage", "dist", "node_modules"]);

export interface WorkspaceResourceProviderOptions {
  readonly rootPath: string;
  readonly pathValidator?: PathValidator;
  readonly maxFileBytes?: number;
  readonly maxTreeEntries?: number;
  readonly maxTreeDepth?: number;
}

interface ResolvedWorkspacePath {
  readonly absolutePath: string;
  readonly relativePath: string;
}

interface WorkspaceEntryMetadata {
  readonly path: string;
  readonly type: "directory" | "file" | "symlink" | "other";
  readonly size: number;
  readonly modifiedTime: string;
  readonly mimeType: string;
  readonly binary: boolean;
  readonly truncated: boolean;
}

interface TreeEntry {
  readonly path: string;
  readonly name: string;
  readonly type: "directory" | "file" | "symlink" | "other";
  readonly depth: number;
  readonly size: number;
  readonly modifiedTime: string;
  readonly mimeType?: string;
}

interface TreeState {
  readonly entries: TreeEntry[];
  entryCount: number;
  truncated: boolean;
}

export class WorkspaceResourceProvider implements ToolResourceProvider {
  private readonly rootPath: string;
  private readonly pathValidator: PathValidator | undefined;
  private readonly maxFileBytes: number;
  private readonly maxTreeEntries: number;
  private readonly maxTreeDepth: number;
  private readonly rootReadable: boolean;

  constructor(options: WorkspaceResourceProviderOptions) {
    this.rootPath = resolve(options.rootPath);
    this.pathValidator = options.pathValidator;
    this.maxFileBytes = clampPositive(options.maxFileBytes, DEFAULT_FILE_BYTES, MAX_FILE_BYTES);
    this.maxTreeEntries = clampPositive(options.maxTreeEntries, MAX_TREE_ENTRIES, MAX_TREE_ENTRIES);
    this.maxTreeDepth = clampNonNegative(options.maxTreeDepth, DEFAULT_TREE_DEPTH, MAX_TREE_DEPTH);
    this.rootReadable = this.canRead(this.rootPath);
  }

  listResources(): readonly ToolResourceDescriptor[] {
    if (!this.rootReadable) {
      return [];
    }
    return [{
      uri: "kiln://workspace/tree",
      name: "workspace_tree",
      title: "Workspace Tree",
      description: "Read-only bounded tree snapshot for the configured workspace root.",
      mimeType: JSON_MIME_TYPE,
      annotations: { readOnlyHint: true },
    }];
  }

  listTemplates(): readonly ToolResourceTemplateDescriptor[] {
    if (!this.rootReadable) {
      return [];
    }
    return [
      {
        uriTemplate: "kiln://workspace/tree{?path,depth,includeFiles}",
        name: "workspace_tree",
        title: "Workspace Tree",
        description: "Read a bounded deterministic tree snapshot under the configured workspace root.",
        mimeType: JSON_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://workspace/file/{path}",
        name: "workspace_file",
        title: "Workspace File",
        description: "Read one text workspace file by workspace-relative path; binary files return metadata only.",
        mimeType: TEXT_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
      {
        uriTemplate: "kiln://workspace/preview/{path}{?offset,limit}",
        name: "workspace_file_preview",
        title: "Workspace File Preview",
        description: "Read a bounded line preview for one workspace text file.",
        mimeType: TEXT_MIME_TYPE,
        annotations: { readOnlyHint: true },
      },
    ];
  }

  async read(uri: string, options: ToolResourceReadOptions = {}): Promise<ToolResourceReadResult | undefined> {
    const parsed = parseWorkspaceUri(uri);
    if (!parsed) {
      return undefined;
    }
    rejectResourceReadCursor(uri, options);
    if (!this.rootReadable) {
      return undefined;
    }

    if (parsed.operation === "tree") {
      return await this.readTree(uri, parsed);
    }
    if (parsed.operation === "file") {
      return await this.readFileResource(uri, parsed.path);
    }
    if (parsed.operation === "preview") {
      return await this.readPreview(uri, parsed);
    }
    return undefined;
  }

  private async readTree(uri: string, parsed: ParsedWorkspaceUri): Promise<ToolResourceReadResult> {
    const requestedPath = parsed.query.get("path") ?? ".";
    const depth = clampNonNegative(parseNumber(parsed.query.get("depth")), DEFAULT_TREE_DEPTH, this.maxTreeDepth);
    const includeFiles = parseBoolean(parsed.query.get("includeFiles")) ?? true;
    const root = this.resolveWorkspacePath(requestedPath);
    const info = await lstat(root.absolutePath);
    if (!info.isDirectory()) {
      throw workspaceResourceError(`${root.relativePath} is not a workspace directory`, { uri, path: root.relativePath });
    }

    const state: TreeState = {
      entries: [],
      entryCount: 0,
      truncated: false,
    };
    await this.appendTreeEntries(root.absolutePath, root.relativePath, 1, depth, includeFiles, state);
    return jsonContent(uri, {
      root: root.relativePath,
      entries: state.entries,
      entryCount: state.entryCount,
      truncated: state.truncated,
    }, {
      path: root.relativePath,
      depth,
      includeFiles,
      entryCount: state.entryCount,
      truncated: state.truncated,
      ignoredDirectories: Array.from(IGNORED_DIRECTORIES),
    });
  }

  private async appendTreeEntries(
    absoluteRoot: string,
    relativeRoot: string,
    level: number,
    maxDepth: number,
    includeFiles: boolean,
    state: TreeState,
  ): Promise<void> {
    if (level > maxDepth || state.truncated) {
      return;
    }
    const entries = await readdir(absoluteRoot, { withFileTypes: true });
    const sorted = entries
      .filter((entry) => !(entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)))
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) return left.isDirectory() ? -1 : 1;
        return left.name.localeCompare(right.name, "en");
      });

    for (const entry of sorted) {
      if (state.entryCount >= this.maxTreeEntries) {
        state.truncated = true;
        return;
      }
      const absolutePath = join(absoluteRoot, entry.name);
      const relativePath = normalizeWorkspaceRelativePath(relativeRoot === "." ? entry.name : `${relativeRoot}/${entry.name}`);
      if (!this.canRead(absolutePath)) {
        continue;
      }
      const info = await lstat(absolutePath);
      const type = getEntryType(info);
      if (type !== "directory" && (!includeFiles || type !== "file")) {
        continue;
      }
      state.entries.push({
        path: relativePath,
        name: entry.name,
        type,
        depth: level,
        size: info.size,
        modifiedTime: info.mtime.toISOString(),
        ...(type === "file" ? { mimeType: inferFileMimeType(relativePath) } : {}),
      });
      state.entryCount += 1;
      if (type === "directory" && !entry.isSymbolicLink()) {
        await this.appendTreeEntries(absolutePath, relativePath, level + 1, maxDepth, includeFiles, state);
      }
    }
  }

  private async readFileResource(uri: string, requestedPath: string): Promise<ToolResourceReadResult> {
    const resolvedPath = this.resolveWorkspacePath(requestedPath);
    const metadata = await this.readEntryMetadata(resolvedPath);
    if (metadata.type !== "file") {
      throw workspaceResourceError(`${resolvedPath.relativePath} is not a workspace file`, { uri, path: resolvedPath.relativePath });
    }

    if (metadata.binary) {
      return jsonContent(uri, metadata, {
        ...metadata,
        mimeType: metadata.mimeType,
      });
    }

    const readResult = await readPrefix(resolvedPath.absolutePath, this.maxFileBytes);
    const text = readResult.buffer.toString("utf8");
    const truncated = readResult.truncated || metadata.size > readResult.buffer.length;
    return {
      contents: [{
        uri,
        mimeType: metadata.mimeType,
        text,
        _meta: {
          ...metadata,
          truncated,
        },
      }],
    };
  }

  private async readPreview(uri: string, parsed: ParsedWorkspaceUri): Promise<ToolResourceReadResult> {
    const resolvedPath = this.resolveWorkspacePath(parsed.path);
    const metadata = await this.readEntryMetadata(resolvedPath);
    if (metadata.type !== "file") {
      throw workspaceResourceError(`${resolvedPath.relativePath} is not a workspace file`, { uri, path: resolvedPath.relativePath });
    }
    if (metadata.binary) {
      return jsonContent(uri, metadata, {
        ...metadata,
        offset: 0,
        limit: 0,
      });
    }

    const offset = Math.max(0, Math.trunc(parseNumber(parsed.query.get("offset")) ?? 0));
    const limit = clampPositive(parseNumber(parsed.query.get("limit")), DEFAULT_PREVIEW_LINE_LIMIT, MAX_PREVIEW_LINE_LIMIT);
    const readResult = await readPrefix(resolvedPath.absolutePath, this.maxFileBytes);
    const lines = readResult.buffer.toString("utf8").split(/\r?\n/);
    const text = lines.slice(offset, offset + limit).join("\n");
    const truncated = readResult.truncated || offset + limit < lines.length;
    return {
      contents: [{
        uri,
        mimeType: metadata.mimeType,
        text,
        _meta: {
          ...metadata,
          offset,
          limit,
          totalLines: lines.length,
          truncated,
        },
      }],
    };
  }

  private async readEntryMetadata(path: ResolvedWorkspacePath): Promise<WorkspaceEntryMetadata> {
    const info = await lstat(path.absolutePath);
    const type = getEntryType(info);
    const mimeType = type === "file" ? inferFileMimeType(path.relativePath) : JSON_MIME_TYPE;
    const binary = type === "file" && (looksBinaryFilePath(path.relativePath) || await filePrefixHasNull(path.absolutePath));
    return {
      path: path.relativePath,
      type,
      size: info.size,
      modifiedTime: info.mtime.toISOString(),
      mimeType,
      binary,
      truncated: false,
    };
  }

  private resolveWorkspacePath(requestedPath: string): ResolvedWorkspacePath {
    const normalizedInput = normalizeWorkspaceRelativePath(requestedPath || ".");
    if (isAbsolute(normalizedInput) || /^[a-zA-Z]:/.test(normalizedInput)) {
      throw workspaceResourceError("Workspace resource path escapes the configured root", { path: requestedPath });
    }
    const segments = normalizedInput.split("/");
    if (segments.some((segment) => segment === "..")) {
      throw workspaceResourceError("Workspace resource path escapes the configured root", { path: requestedPath });
    }
    const absolutePath = resolve(this.rootPath, normalizedInput);
    if (!isSubPath(absolutePath, this.rootPath)) {
      throw workspaceResourceError("Workspace resource path escapes the configured root", { path: requestedPath });
    }
    if (!this.canRead(absolutePath)) {
      throw workspaceResourceError(`Read access denied: ${normalizedInput}`, { path: normalizedInput });
    }
    return {
      absolutePath,
      relativePath: normalizeWorkspaceRelativePath(relative(this.rootPath, absolutePath) || "."),
    };
  }

  private canRead(path: string): boolean {
    return this.pathValidator?.validateRead(path).allowed ?? true;
  }
}

interface ParsedWorkspaceUri {
  readonly operation: "tree" | "file" | "preview";
  readonly path: string;
  readonly query: URLSearchParams;
}

function parseWorkspaceUri(uri: string): ParsedWorkspaceUri | undefined {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "kiln:" || parsed.hostname !== "workspace") {
    return undefined;
  }
  const rawPath = uri.slice("kiln://workspace".length).split(/[?#]/, 1)[0] ?? "";
  const pathSegments = rawPath.replace(/^\/+/, "").split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  const operation = pathSegments[0];
  if (operation !== "tree" && operation !== "file" && operation !== "preview") {
    return undefined;
  }
  return {
    operation,
    path: pathSegments.slice(1).join("/") || ".",
    query: parsed.searchParams,
  };
}

function jsonContent(uri: string, value: unknown, meta: Record<string, unknown>): ToolResourceReadResult {
  return {
    contents: [{
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(value, null, 2),
      _meta: meta,
    }],
  };
}

async function readPrefix(path: string, limit: number): Promise<{ readonly buffer: Buffer; readonly truncated: boolean }> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(limit + 1);
    const result = await handle.read(buffer, 0, limit + 1, 0);
    return {
      buffer: buffer.subarray(0, Math.min(result.bytesRead, limit)),
      truncated: result.bytesRead > limit,
    };
  } finally {
    await handle.close();
  }
}

async function filePrefixHasNull(path: string): Promise<boolean> {
  const result = await readPrefix(path, 8 * 1024);
  return result.buffer.includes(0);
}

function getEntryType(info: Awaited<ReturnType<typeof lstat>>): WorkspaceEntryMetadata["type"] {
  if (info.isDirectory()) return "directory";
  if (info.isFile()) return "file";
  if (info.isSymbolicLink()) return "symlink";
  return "other";
}

function normalizeWorkspaceRelativePath(value: string): string {
  const normalized = normalizePath(value).replace(/^\/+/, "");
  return normalized.length === 0 ? "." : normalized;
}

function parseBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

function parseNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clampPositive(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(value)));
}

function clampNonNegative(value: number | undefined, fallback: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(value)));
}

function workspaceResourceError(message: string, context: Record<string, unknown>): KilnError {
  return new KilnError("INTERNAL_ERROR", message, {
    context,
    retryable: false,
  });
}
