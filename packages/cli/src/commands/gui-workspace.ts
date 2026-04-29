import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type {
  OperatorWorkspaceDirectorySnapshot,
  OperatorWorkspaceExplorer,
  OperatorWorkspaceFileSnapshot,
  OperatorWorkspaceTreeEntry,
  OperatorWorkspaceVcsState,
  OperatorWorkspaceVcsStatus,
} from "@kilnai/gateway-contracts";

const DIRECTORY_ENTRY_LIMIT = 250;
const TEXT_PREVIEW_BYTE_LIMIT = 256 * 1024;
const IMAGE_PREVIEW_BYTE_LIMIT = 1024 * 1024;
const GIT_STATUS_CACHE_TTL_MS = 2_000;
const GIT_STATUS_TIMEOUT_MS = 1_200;
const execFileAsync = promisify(execFile);

const TEXT_EXTENSIONS = new Set([
  ".c",
  ".cpp",
  ".cs",
  ".css",
  ".go",
  ".h",
  ".html",
  ".java",
  ".js",
  ".jsx",
  ".json",
  ".kt",
  ".md",
  ".mdx",
  ".py",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const IMAGE_MIME_TYPES = new Map([
  [".gif", "image/gif"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

type GitStatusMap = ReadonlyMap<string, OperatorWorkspaceVcsStatus>;

class WorkspacePathError extends Error {
  constructor(
    readonly code: "invalid_path" | "outside_workspace" | "not_a_directory" | "not_a_file" | "not_found" | "read_failed",
    message: string,
    readonly path?: string,
  ) {
    super(message);
  }
}

function isWithinRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function resolveWorkspacePath(rootPath: string, candidatePath?: string): string {
  const targetPath = candidatePath && candidatePath.trim().length > 0
    ? (isAbsolute(candidatePath) ? resolve(candidatePath) : resolve(rootPath, candidatePath))
    : rootPath;
  if (!isWithinRoot(rootPath, targetPath)) {
    throw new WorkspacePathError("outside_workspace", "Workspace path is outside the active working directory.", targetPath);
  }
  return targetPath;
}

function compareEntries(a: OperatorWorkspaceTreeEntry, b: OperatorWorkspaceTreeEntry): number {
  if (a.kind !== b.kind) {
    return a.kind === "directory" ? -1 : 1;
  }
  return a.name.localeCompare(b.name, "en-US", { sensitivity: "base" });
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function toWorkspaceVcsState(status: string): OperatorWorkspaceVcsState {
  if (status.includes("U") || status === "AA" || status === "DD") {
    return "conflicted";
  }
  if (status === "??") {
    return "untracked";
  }
  if (status === "!!") {
    return "ignored";
  }
  if (status.includes("D")) {
    return "deleted";
  }
  if (status.includes("R") || status.includes("C")) {
    return "renamed";
  }
  if (status.includes("A")) {
    return "added";
  }
  return "modified";
}

function statusPriority(state: OperatorWorkspaceVcsState): number {
  switch (state) {
    case "conflicted": return 7;
    case "deleted": return 6;
    case "renamed": return 5;
    case "modified": return 4;
    case "added": return 3;
    case "untracked": return 2;
    case "ignored": return 1;
  }
}

function mergeVcsStatus(current: OperatorWorkspaceVcsStatus | undefined, next: OperatorWorkspaceVcsStatus): OperatorWorkspaceVcsStatus {
  if (!current || statusPriority(next.state) > statusPriority(current.state)) {
    return next;
  }
  if (statusPriority(next.state) === statusPriority(current.state) && next.staged && !current.staged) {
    return { ...current, staged: true };
  }
  return current;
}

function setMergedStatus(
  statuses: Map<string, OperatorWorkspaceVcsStatus>,
  path: string,
  status: OperatorWorkspaceVcsStatus,
): void {
  if (!path) {
    return;
  }
  statuses.set(path, mergeVcsStatus(statuses.get(path), status));
}

function addAncestorDirectoryStatuses(
  statuses: Map<string, OperatorWorkspaceVcsStatus>,
  relativePath: string,
  status: OperatorWorkspaceVcsStatus,
): void {
  const segments = relativePath.split("/").filter(Boolean);
  for (let index = 1; index < segments.length; index += 1) {
    setMergedStatus(statuses, segments.slice(0, index).join("/"), status);
  }
}

function parseGitStatus(output: string): GitStatusMap {
  const statuses = new Map<string, OperatorWorkspaceVcsStatus>();
  const records = output.split("\0").filter((record) => record.length > 0);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const status = record.slice(0, 2);
    const relativePath = normalizeRelativePath(record.slice(3));
    if (!relativePath) {
      continue;
    }
    const state = toWorkspaceVcsState(status);
    const vcs: OperatorWorkspaceVcsStatus = {
      provider: "git",
      state,
      ...(status[0] !== " " && status !== "??" && status !== "!!" ? { staged: true } : {}),
    };
    setMergedStatus(statuses, relativePath, vcs);
    addAncestorDirectoryStatuses(statuses, relativePath, vcs);
    if (state === "renamed" && records[index + 1]) {
      index += 1;
    }
  }
  return statuses;
}

function vcsStatusForEntry(rootPath: string, entry: OperatorWorkspaceTreeEntry, statuses: GitStatusMap): OperatorWorkspaceVcsStatus | undefined {
  const relativePath = normalizeRelativePath(relative(rootPath, entry.path));
  return relativePath ? statuses.get(relativePath) : undefined;
}

function languageFromExtension(extension: string): string | undefined {
  const normalized = extension.replace(/^\./, "");
  return normalized || undefined;
}

function looksLikeText(buffer: Buffer, extension: string): boolean {
  if (TEXT_EXTENSIONS.has(extension)) {
    return true;
  }
  return !buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0);
}

export function createLocalWorkspaceExplorer(workingDirectory: string): OperatorWorkspaceExplorer {
  const rootPath = resolve(workingDirectory);
  let gitStatusCache: { readonly expiresAt: number; readonly statuses: GitStatusMap } | null = null;
  let gitStatusInFlight: Promise<GitStatusMap> | null = null;

  const readGitStatus = async (): Promise<GitStatusMap> => {
    const now = Date.now();
    if (gitStatusCache && gitStatusCache.expiresAt > now) {
      return gitStatusCache.statuses;
    }
    if (gitStatusInFlight) {
      return gitStatusInFlight;
    }
    gitStatusInFlight = execFileAsync("git", [
      "-C",
      rootPath,
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    ], {
      encoding: "utf8",
      timeout: GIT_STATUS_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
      .then(({ stdout }) => parseGitStatus(stdout))
      .catch(() => new Map<string, OperatorWorkspaceVcsStatus>())
      .then((statuses) => {
        gitStatusCache = { expiresAt: Date.now() + GIT_STATUS_CACHE_TTL_MS, statuses };
        return statuses;
      })
      .finally(() => {
        gitStatusInFlight = null;
      });
    return gitStatusInFlight;
  };

  return {
    async listDirectory(path?: string): Promise<OperatorWorkspaceDirectorySnapshot> {
      const directoryPath = resolveWorkspacePath(rootPath, path);
      const directoryStat = await stat(directoryPath).catch(() => {
        throw new WorkspacePathError("not_found", "Workspace directory was not found.", directoryPath);
      });
      if (!directoryStat.isDirectory()) {
        throw new WorkspacePathError("not_a_directory", "Workspace path is not a directory.", directoryPath);
      }

      const dirents = await readdir(directoryPath, { withFileTypes: true });
      const gitStatuses = await readGitStatus();
      const entries = await Promise.all(dirents.map(async (entry): Promise<OperatorWorkspaceTreeEntry | null> => {
        if (!entry.isDirectory() && !entry.isFile()) {
          return null;
        }
        const entryPath = join(directoryPath, entry.name);
        const entryStat = await stat(entryPath).catch(() => null);
        const treeEntry: OperatorWorkspaceTreeEntry = {
          path: entryPath,
          name: entry.name,
          kind: entry.isDirectory() ? "directory" : "file",
          ...(entryStat ? { sizeBytes: entryStat.size, modifiedAt: entryStat.mtime.toISOString() } : {}),
        };
        const vcs = vcsStatusForEntry(rootPath, treeEntry, gitStatuses);
        return {
          ...treeEntry,
          ...(vcs ? { vcs } : {}),
        };
      }));
      const sortedEntries = entries
        .filter((entry): entry is OperatorWorkspaceTreeEntry => entry !== null)
        .sort(compareEntries);
      const truncated = sortedEntries.length > DIRECTORY_ENTRY_LIMIT;

      return {
        rootPath,
        directoryPath,
        ...(directoryPath !== rootPath ? { parentPath: resolve(directoryPath, "..") } : {}),
        entries: truncated ? sortedEntries.slice(0, DIRECTORY_ENTRY_LIMIT) : sortedEntries,
        truncated: truncated || undefined,
        source: "gateway",
      };
    },

    async readFile(path: string): Promise<OperatorWorkspaceFileSnapshot> {
      const filePath = resolveWorkspacePath(rootPath, path);
      const fileStat = await stat(filePath).catch(() => {
        throw new WorkspacePathError("not_found", "Workspace file was not found.", filePath);
      });
      if (!fileStat.isFile()) {
        throw new WorkspacePathError("not_a_file", "Workspace path is not a file.", filePath);
      }

      const extension = extname(filePath).toLocaleLowerCase("en-US");
      const imageMimeType = IMAGE_MIME_TYPES.get(extension);
      const readLimit = imageMimeType ? IMAGE_PREVIEW_BYTE_LIMIT : TEXT_PREVIEW_BYTE_LIMIT;
      const fullBuffer = await readFile(filePath).catch(() => {
        throw new WorkspacePathError("read_failed", "Workspace file could not be read.", filePath);
      });
      const truncated = fullBuffer.length > readLimit;
      const previewBuffer = truncated ? fullBuffer.subarray(0, readLimit) : fullBuffer;
      const base = {
        path: filePath,
        name: basename(filePath),
        sizeBytes: fileStat.size,
        modifiedAt: fileStat.mtime.toISOString(),
        truncated: truncated || undefined,
        source: "gateway" as const,
      };

      if (imageMimeType && fullBuffer.length <= IMAGE_PREVIEW_BYTE_LIMIT) {
        return {
          ...base,
          kind: "image",
          mimeType: imageMimeType,
          encoding: "base64",
          dataUrl: `data:${imageMimeType};base64,${fullBuffer.toString("base64")}`,
        };
      }

      if (looksLikeText(previewBuffer, extension)) {
        return {
          ...base,
          kind: "text",
          mimeType: extension === ".md" || extension === ".mdx" ? "text/markdown" : "text/plain",
          language: languageFromExtension(extension),
          encoding: "utf-8",
          content: previewBuffer.toString("utf-8"),
        };
      }

      return {
        ...base,
        kind: "binary",
        unsupportedReason: "Binary file preview is not supported.",
      };
    },
  };
}
