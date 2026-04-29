export type CommandToolName = "bash" | "git";
export type FileToolName = "read" | "write" | "edit" | "patch";
export type InspectionToolName = "stat" | "tree";
export type MediaToolName = "view_image" | "ocr_image";
export type SearchToolName = "grep" | "glob";

export type FileToolOperation = "read" | "write" | "edit" | "patch";
export type InspectionToolOperation = "stat" | "tree";
export type InspectionEntryType = "file" | "directory" | "symlink" | "other";
export type MediaToolOperation = "view_image" | "ocr";
export type ImageDetail = "default" | "original";
export type ToolOutputVerbosity = "raw" | "structured" | "summary";
export type SearchToolStrategy = "rg" | "fd" | "fallback";
export type GrepOutputMode = "content" | "files_with_matches" | "count";

export interface CommandToolResultMetadata<TToolName extends CommandToolName = CommandToolName> {
  readonly toolName: TToolName;
  readonly kind: "command";
  readonly cwd: string;
  readonly command: string;
  readonly timeoutMs?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly stdoutBytes?: number;
  readonly stderrBytes?: number;
  readonly exitCode?: number | string;
  readonly code?: number | string;
  readonly signal?: NodeJS.Signals;
  readonly timedOut?: boolean;
  readonly truncated?: boolean;
  readonly maxBufferBytes?: number;
  readonly durationMs?: number;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface FileToolResultMetadata<TToolName extends FileToolName = FileToolName> {
  readonly toolName: TToolName;
  readonly kind: "file";
  readonly operation: FileToolOperation;
  readonly filePath?: string;
  readonly previousFilePath?: string;
  readonly files?: readonly FileToolChangeMetadata[];
  readonly changeType?: "created" | "modified" | "deleted";
  readonly offset?: number;
  readonly limit?: number;
  readonly totalLines?: number;
  readonly bytesWritten?: number;
  readonly replacements?: number;
  readonly replaceAll?: boolean;
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
  readonly dryRun?: boolean;
  readonly operationCount?: number;
  readonly code?: number | string;
}

export interface FileToolChangeMetadata {
  readonly operation: "write" | "edit" | "delete" | "move";
  readonly filePath: string;
  readonly previousFilePath?: string;
  readonly changeType: "created" | "modified" | "deleted";
  readonly linesAdded?: number;
  readonly linesRemoved?: number;
  readonly diffPreview?: string;
  readonly diffTruncated?: boolean;
}

export interface SearchToolResultMetadata<TToolName extends SearchToolName = SearchToolName> {
  readonly toolName: TToolName;
  readonly kind: "search";
  readonly path: string;
  readonly strategy?: SearchToolStrategy;
  readonly outputMode?: GrepOutputMode;
  readonly count?: number;
  readonly noMatches?: boolean;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface InspectionToolResultMetadata<TToolName extends InspectionToolName = InspectionToolName> {
  readonly toolName: TToolName;
  readonly kind: "inspection";
  readonly operation: InspectionToolOperation;
  readonly path: string;
  readonly type?: InspectionEntryType;
  readonly size?: number;
  readonly modifiedTime?: string;
  readonly hashAlgorithm?: "none" | "sha256";
  readonly hash?: string;
  readonly depth?: number;
  readonly includeFiles?: boolean;
  readonly entryCount?: number;
  readonly truncated?: boolean;
  readonly ignoredDirectories?: readonly string[];
  readonly code?: number | string;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface MediaToolResultMetadata<TToolName extends MediaToolName = MediaToolName> {
  readonly toolName: TToolName;
  readonly kind: "media";
  readonly operation: MediaToolOperation;
  readonly path: string;
  readonly mimeType?: string;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly detail?: ImageDetail;
  readonly language?: string;
  readonly textLength?: number;
  readonly confidence?: number;
  readonly source?: string;
  readonly code?: number | string;
}

export type ToolResultMetadata =
  | CommandToolResultMetadata
  | FileToolResultMetadata
  | InspectionToolResultMetadata
  | MediaToolResultMetadata
  | SearchToolResultMetadata;

export function commandToolMetadata<TToolName extends CommandToolName>(
  toolName: TToolName,
  metadata: Omit<CommandToolResultMetadata<TToolName>, "toolName" | "kind">,
): CommandToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "command",
    ...metadata,
  };
}

export function fileToolMetadata<TToolName extends FileToolName>(
  toolName: TToolName,
  metadata: Omit<FileToolResultMetadata<TToolName>, "toolName" | "kind">,
): FileToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "file",
    ...metadata,
  };
}

export function isFileToolResultMetadata(value: unknown): value is FileToolResultMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as {
    toolName?: unknown;
    kind?: unknown;
    operation?: unknown;
    filePath?: unknown;
  };

  const hasFilePath = typeof candidate.filePath === "string";
  const hasPatchFiles = Array.isArray((candidate as { files?: unknown }).files);
  const isSingleFileTool = (
    candidate.toolName === "read"
    || candidate.toolName === "write"
    || candidate.toolName === "edit"
  )
    && (
      candidate.operation === "read"
      || candidate.operation === "write"
      || candidate.operation === "edit"
    )
    && hasFilePath;
  const isPatchTool = candidate.toolName === "patch"
    && candidate.operation === "patch"
    && hasPatchFiles;

  return candidate.kind === "file" && (isSingleFileTool || isPatchTool);
}

export function searchToolMetadata<TToolName extends SearchToolName>(
  toolName: TToolName,
  metadata: Omit<SearchToolResultMetadata<TToolName>, "toolName" | "kind">,
): SearchToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "search",
    ...metadata,
  };
}

export function inspectionToolMetadata<TToolName extends InspectionToolName>(
  toolName: TToolName,
  metadata: Omit<InspectionToolResultMetadata<TToolName>, "toolName" | "kind">,
): InspectionToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "inspection",
    ...metadata,
  };
}

export function mediaToolMetadata<TToolName extends MediaToolName>(
  toolName: TToolName,
  metadata: Omit<MediaToolResultMetadata<TToolName>, "toolName" | "kind">,
): MediaToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "media",
    ...metadata,
  };
}
