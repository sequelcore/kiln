export type CommandToolName = "bash" | "git";
export type FileToolName = "read" | "write" | "edit";
export type SearchToolName = "grep" | "glob";

export type FileToolOperation = "read" | "write" | "edit";
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
}

export interface FileToolResultMetadata<TToolName extends FileToolName = FileToolName> {
  readonly toolName: TToolName;
  readonly kind: "file";
  readonly operation: FileToolOperation;
  readonly filePath: string;
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
  readonly code?: number | string;
}

export interface SearchToolResultMetadata<TToolName extends SearchToolName = SearchToolName> {
  readonly toolName: TToolName;
  readonly kind: "search";
  readonly path: string;
  readonly strategy?: SearchToolStrategy;
  readonly outputMode?: GrepOutputMode;
  readonly count?: number;
  readonly noMatches?: boolean;
}

export type ToolResultMetadata =
  | CommandToolResultMetadata
  | FileToolResultMetadata
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

  return (candidate.toolName === "read" || candidate.toolName === "write" || candidate.toolName === "edit")
    && candidate.kind === "file"
    && (candidate.operation === "read" || candidate.operation === "write" || candidate.operation === "edit")
    && typeof candidate.filePath === "string";
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
