import type { GoalRun, WorkItem, WorkItemExecutionAttempt, WorkItemStatus } from "../../work-governance/index.js";

export type CommandToolName = "bash" | "git";
export type FileToolName = "read" | "read_many" | "write" | "edit" | "patch";
export type InspectionToolName = "stat" | "tree";
export type MediaToolName = "view_image" | "ocr_image";
export type WebToolName = "web_search" | "web_fetch" | "web_extract";
export type BrowserToolName =
  | "browser_session_start"
  | "browser_navigate"
  | "browser_observe"
  | "browser_click"
  | "browser_type"
  | "browser_keypress"
  | "browser_scroll"
  | "browser_session_stop";
export type ComputerToolName =
  | "computer_observe"
  | "computer_click"
  | "computer_type"
  | "computer_keypress"
  | "computer_open_application"
  | "computer_focus_application"
  | "computer_minimize_application"
  | "computer_close_application";
export type InteractiveToolName = BrowserToolName | ComputerToolName;
export type SearchToolName = "grep" | "glob";
export type CatalogToolName = "tool_catalog_search";
export type CodeToolName = "code_intelligence";
export type MonitorToolName = "monitor_start" | "monitor_read" | "monitor_stop" | "monitor_list";
export type TaskStateToolName = "task_list" | "task_update";
export type WorkItemToolName =
  | "work_item.update"
  | "work_item.list"
  | "work_item.complete"
  | "work_item.execution.start"
  | "work_item.execution.finish";
export type GoalToolName = "goal.create";
export type ElicitationToolName = "operator_elicit";
export type MemoryToolName = "memory_save";
export type ResourceToolName = "resource_list" | "resource_template_list" | "resource_read";

export type FileToolOperation = "read" | "read_many" | "write" | "edit" | "patch";
export type InspectionToolOperation = "stat" | "tree";
export type InspectionEntryType = "file" | "directory" | "symlink" | "other";
export type MediaToolOperation = "view_image" | "ocr";
export type ImageDetail = "default" | "original";
export type ToolOutputVerbosity = "raw" | "structured" | "summary";
export type WebToolOperation = "search" | "fetch" | "extract";
export type InteractiveTarget = "browser" | "computer";
export type InteractiveToolOperation =
  | "session_start"
  | "navigate"
  | "observe"
  | "click"
  | "type"
  | "keypress"
  | "scroll"
  | "session_stop"
  | "open_application"
  | "focus_application"
  | "minimize_application"
  | "close_application";
export type InteractiveToolErrorCode =
  | "invalid_input"
  | "provider_not_configured"
  | "policy_denied"
  | "approval_required"
  | "session_not_found"
  | "target_unavailable"
  | "timeout"
  | "provider_error";
export type WebToolErrorCode =
  | "invalid_input"
  | "network_policy_missing"
  | "network_denied"
  | "domain_denied"
  | "unsupported_content_type"
  | "too_many_requests"
  | "unavailable"
  | "timeout"
  | "provider_unreachable"
  | "provider_not_configured"
  | "empty_extraction";
export type SearchToolStrategy = "rg" | "fd" | "fallback";
export type GrepOutputMode = "content" | "files_with_matches" | "count";
export type CatalogToolOperation = "search";
export type CodeIntelligenceOperation =
  | "definition"
  | "references"
  | "hover"
  | "document_symbols"
  | "workspace_symbols"
  | "diagnostics"
  | "implementation"
  | "call_hierarchy";
export type CodeIntelligenceErrorCode =
  | "invalid_input"
  | "adapter_not_configured"
  | "unsupported_language"
  | "adapter_error"
  | "read_denied";
export type MonitorToolOperation = "start" | "read" | "stop" | "list";
export type MonitorStatus = "running" | "exited" | "stopped" | "failed";
export type TaskStateToolOperation = "list" | "update";
export type SessionTaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";
export type WorkItemToolOperation = "update" | "list" | "complete" | "execution_started" | "execution_finished";
export type GoalToolOperation = "create";
export type ElicitationToolOperation = "elicit";
export type MemoryToolOperation = "save";
export type ResourceToolOperation = "list" | "list_templates" | "read";
export type ElicitationMode = "form" | "url";
export type ElicitationOutcome = "submitted" | "declined" | "cancelled" | "unsupported";
export type ElicitationToolErrorCode =
  | "invalid_input"
  | "responder_not_configured"
  | "sensitive_form_denied"
  | "responder_error";
export type ToolResourceLinkRelation = "full_output" | "snapshot" | "events" | "source" | "summary";

export interface ToolResourceLinkMetadata {
  readonly uri: string;
  readonly title?: string;
  readonly label?: string;
  readonly sequence?: number;
  readonly mimeType?: string;
  readonly size?: number;
  readonly relation: ToolResourceLinkRelation;
}

export interface ToolResultResourceLinkMetadata {
  readonly resourceLinks?: readonly ToolResourceLinkMetadata[];
}

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
  readonly fileCount?: number;
  readonly skippedCount?: number;
  readonly totalBytes?: number;
  readonly truncated?: boolean;
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
  readonly verbosity?: ToolOutputVerbosity;
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

export interface WebSourceMetadata {
  readonly url: string;
  readonly title?: string;
  readonly snippet?: string;
  readonly rank?: number;
  readonly publishedAt?: string;
  readonly source?: string;
}

export type WebExtractFormat = "text" | "markdown";

export interface WebExtractPageMetadata {
  readonly url: string;
  readonly normalizedUrl?: string;
  readonly title?: string;
  readonly contentType?: string;
  readonly status?: number;
  readonly bytesRead?: number;
  readonly truncated?: boolean;
}

export interface WebToolResultMetadata<TToolName extends WebToolName = WebToolName> {
  readonly toolName: TToolName;
  readonly kind: "web";
  readonly operation: WebToolOperation;
  readonly provider?: string;
  readonly query?: string;
  readonly url?: string;
  readonly normalizedUrl?: string;
  readonly domains?: readonly string[];
  readonly urls?: readonly string[];
  readonly format?: WebExtractFormat;
  readonly recencyDays?: number;
  readonly resultCount?: number;
  readonly extractCount?: number;
  readonly retrievedAt?: string;
  readonly contentType?: string;
  readonly status?: number;
  readonly bytesRead?: number;
  readonly truncated?: boolean;
  readonly redirectChain?: readonly string[];
  readonly sources?: readonly WebSourceMetadata[];
  readonly pages?: readonly WebExtractPageMetadata[];
  readonly errorCode?: WebToolErrorCode;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface InteractiveActionMetadata {
  readonly type: InteractiveToolOperation;
  readonly url?: string;
  readonly x?: number;
  readonly y?: number;
  readonly button?: "left" | "middle" | "right";
  readonly selector?: string;
  readonly ref?: string;
  readonly keys?: readonly string[];
  readonly direction?: "up" | "down" | "left" | "right";
  readonly deltaX?: number;
  readonly deltaY?: number;
  readonly textLength?: number;
  readonly sensitive?: boolean;
}

export interface InteractiveObservationMetadata {
  readonly url?: string;
  readonly title?: string;
  readonly visibleText?: string;
  readonly windowTitle?: string;
  readonly application?: string;
  readonly closeMethod?: "uia-window-pattern" | "win32-sc-close" | "win32-wm-close" | "win32-post-message";
  readonly screenshotUri?: string;
  readonly screenshotDataUrl?: string;
  readonly domSnapshotUri?: string;
  readonly accessibilitySnapshotUri?: string;
  readonly traceUri?: string;
  readonly videoUri?: string;
  readonly consoleLogUri?: string;
  readonly networkLogUri?: string;
}

export interface InteractiveToolResultMetadata<TToolName extends InteractiveToolName = InteractiveToolName> {
  readonly toolName: TToolName;
  readonly kind: "interactive";
  readonly target: InteractiveTarget;
  readonly operation: InteractiveToolOperation;
  readonly provider?: string;
  readonly sessionId?: string;
  readonly action?: InteractiveActionMetadata;
  readonly observation?: InteractiveObservationMetadata;
  readonly allowedDomains?: readonly string[];
  readonly allowedApplications?: readonly string[];
  readonly requiresApproval?: boolean;
  readonly sensitive?: boolean;
  readonly timeoutMs?: number;
  readonly errorCode?: InteractiveToolErrorCode;
  readonly verbosity?: ToolOutputVerbosity;
  readonly resourceLinks?: readonly ToolResourceLinkMetadata[];
}

export interface CatalogToolResultMetadata<TToolName extends CatalogToolName = CatalogToolName> {
  readonly toolName: TToolName;
  readonly kind: "catalog";
  readonly operation: CatalogToolOperation;
  readonly query?: string;
  readonly exact?: string;
  readonly prefix?: string;
  readonly tags?: readonly string[];
  readonly resultCount: number;
  readonly totalIndexed: number;
  readonly includedSchemas?: boolean;
  readonly stale?: boolean;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface CodeToolResultMetadata<TToolName extends CodeToolName = CodeToolName> {
  readonly toolName: TToolName;
  readonly kind: "code";
  readonly operation: CodeIntelligenceOperation;
  readonly path?: string;
  readonly workspaceRoot?: string;
  readonly adapter?: string;
  readonly language?: string;
  readonly resultCount: number;
  readonly errorCode?: CodeIntelligenceErrorCode;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface MonitorToolResultMetadata<TToolName extends MonitorToolName = MonitorToolName> {
  readonly toolName: TToolName;
  readonly kind: "monitor";
  readonly operation: MonitorToolOperation;
  readonly id?: string;
  readonly name?: string;
  readonly command?: string;
  readonly cwd?: string;
  readonly status?: MonitorStatus;
  readonly timeoutMs?: number;
  readonly sequence?: number;
  readonly sinceSequence?: number;
  readonly eventCount?: number;
  readonly monitorCount?: number;
  readonly exitCode?: number | string;
  readonly signal?: NodeJS.Signals | string;
  readonly durationMs?: number;
  readonly timedOut?: boolean;
  readonly truncated?: boolean;
  readonly errorCode?: "invalid_input" | "not_found" | "already_finished" | "runner_error";
  readonly verbosity?: ToolOutputVerbosity;
}

export interface TaskStateToolResultMetadata<TToolName extends TaskStateToolName = TaskStateToolName> {
  readonly toolName: TToolName;
  readonly kind: "task_state";
  readonly operation: TaskStateToolOperation;
  readonly id?: string;
  readonly status?: SessionTaskStatus;
  readonly taskCount: number;
  readonly totalTaskCount?: number;
  readonly sequence?: number;
  readonly errorCode?: "invalid_input" | "not_found";
  readonly verbosity?: ToolOutputVerbosity;
}

export interface WorkItemToolResultMetadata<TToolName extends WorkItemToolName = WorkItemToolName> {
  readonly toolName: TToolName;
  readonly kind: "work_item";
  readonly operation: WorkItemToolOperation;
  readonly id?: string;
  readonly status?: WorkItemStatus;
  readonly item?: WorkItem;
  readonly attempt?: WorkItemExecutionAttempt;
  readonly items?: readonly WorkItem[];
  readonly itemCount?: number;
  readonly missingEvidence?: readonly string[];
  readonly missingGoalEvidence?: readonly string[];
  readonly missingVerificationGates?: readonly string[];
  readonly failedVerificationGates?: readonly string[];
  readonly missingResidualRisk?: boolean;
  readonly requiredPhaseRoute?: string;
  readonly suggestedNextTool?: WorkItemToolName;
  readonly retryInputPatch?: Readonly<Record<string, unknown>>;
  readonly sequence?: number;
  readonly errorCode?: "invalid_input" | "not_found" | "missing_evidence";
  readonly verbosity?: ToolOutputVerbosity;
}

export interface GoalToolResultMetadata<TToolName extends GoalToolName = GoalToolName> {
  readonly toolName: TToolName;
  readonly kind: "goal";
  readonly operation: GoalToolOperation;
  readonly id?: string;
  readonly goal?: GoalRun;
  readonly linkedWorkItemIds?: readonly string[];
  readonly missingWorkItemIds?: readonly string[];
  readonly sequence?: number;
  readonly errorCode?: "invalid_input" | "not_found";
  readonly verbosity?: ToolOutputVerbosity;
}

export interface ElicitationToolResultMetadata<TToolName extends ElicitationToolName = ElicitationToolName> {
  readonly toolName: TToolName;
  readonly kind: "elicitation";
  readonly operation: ElicitationToolOperation;
  readonly mode?: ElicitationMode;
  readonly outcome?: ElicitationOutcome;
  readonly schemaProvided?: boolean;
  readonly sensitive?: boolean;
  readonly url?: string;
  readonly surface?: string;
  readonly valueKeys?: readonly string[];
  readonly errorCode?: ElicitationToolErrorCode;
  readonly verbosity?: ToolOutputVerbosity;
}

export interface ResourceToolResultMetadata<TToolName extends ResourceToolName = ResourceToolName> {
  readonly toolName: TToolName;
  readonly kind: "resource";
  readonly operation: ResourceToolOperation;
  readonly uri?: string;
  readonly cursor?: string;
  readonly nextCursor?: string;
  readonly resourceCount?: number;
  readonly templateCount?: number;
  readonly contentCount?: number;
  readonly mimeType?: string;
  readonly errorCode?:
    | "invalid_input"
    | "not_found"
    | "cursor_error"
    | "registry_unavailable"
    | "authorization_denied";
}

export interface MemoryToolResultMetadata<TToolName extends MemoryToolName = MemoryToolName> {
  readonly toolName: TToolName;
  readonly kind: "memory";
  readonly operation: MemoryToolOperation;
  readonly recordId?: string;
  readonly scopeKind?: string;
  readonly scopeId?: string;
  readonly layer?: string;
  readonly resourceUri?: string;
  readonly errorCode?: "invalid_input" | "service_unavailable" | "repository_error";
}

export type ToolSpecificResultMetadata =
  | CommandToolResultMetadata
  | FileToolResultMetadata
  | InspectionToolResultMetadata
  | MediaToolResultMetadata
  | WebToolResultMetadata
  | InteractiveToolResultMetadata
  | SearchToolResultMetadata
  | CatalogToolResultMetadata
  | CodeToolResultMetadata
  | MonitorToolResultMetadata
  | GoalToolResultMetadata
  | WorkItemToolResultMetadata
  | TaskStateToolResultMetadata
  | ElicitationToolResultMetadata
  | MemoryToolResultMetadata
  | ResourceToolResultMetadata;

export type ToolResultMetadata = ToolSpecificResultMetadata & ToolResultResourceLinkMetadata;

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
    || candidate.toolName === "read_many"
    || candidate.toolName === "write"
    || candidate.toolName === "edit"
  )
    && (
      candidate.operation === "read"
      || candidate.operation === "read_many"
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

export function webToolMetadata<TToolName extends WebToolName>(
  toolName: TToolName,
  metadata: Omit<WebToolResultMetadata<TToolName>, "toolName" | "kind">,
): WebToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "web",
    ...metadata,
  };
}

export function interactiveToolMetadata<TToolName extends InteractiveToolName>(
  toolName: TToolName,
  metadata: Omit<InteractiveToolResultMetadata<TToolName>, "toolName" | "kind">,
): InteractiveToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "interactive",
    ...metadata,
  };
}

export function catalogToolMetadata<TToolName extends CatalogToolName>(
  toolName: TToolName,
  metadata: Omit<CatalogToolResultMetadata<TToolName>, "toolName" | "kind">,
): CatalogToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "catalog",
    ...metadata,
  };
}

export function codeToolMetadata<TToolName extends CodeToolName>(
  toolName: TToolName,
  metadata: Omit<CodeToolResultMetadata<TToolName>, "toolName" | "kind">,
): CodeToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "code",
    ...metadata,
  };
}

export function monitorToolMetadata<TToolName extends MonitorToolName>(
  toolName: TToolName,
  metadata: Omit<MonitorToolResultMetadata<TToolName>, "toolName" | "kind">,
): MonitorToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "monitor",
    ...metadata,
  };
}

export function taskStateToolMetadata<TToolName extends TaskStateToolName>(
  toolName: TToolName,
  metadata: Omit<TaskStateToolResultMetadata<TToolName>, "toolName" | "kind">,
): TaskStateToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "task_state",
    ...metadata,
  };
}

export function workItemToolMetadata<TToolName extends WorkItemToolName>(
  toolName: TToolName,
  metadata: Omit<WorkItemToolResultMetadata<TToolName>, "toolName" | "kind">,
): WorkItemToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "work_item",
    ...metadata,
  };
}

export function goalToolMetadata<TToolName extends GoalToolName>(
  toolName: TToolName,
  metadata: Omit<GoalToolResultMetadata<TToolName>, "toolName" | "kind">,
): GoalToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "goal",
    ...metadata,
  };
}

export function elicitationToolMetadata<TToolName extends ElicitationToolName>(
  toolName: TToolName,
  metadata: Omit<ElicitationToolResultMetadata<TToolName>, "toolName" | "kind">,
): ElicitationToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "elicitation",
    ...metadata,
  };
}

export function memoryToolMetadata<TToolName extends MemoryToolName>(
  toolName: TToolName,
  metadata: Omit<MemoryToolResultMetadata<TToolName>, "toolName" | "kind">,
): MemoryToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "memory",
    ...metadata,
  };
}

export function resourceToolMetadata<TToolName extends ResourceToolName>(
  toolName: TToolName,
  metadata: Omit<ResourceToolResultMetadata<TToolName>, "toolName" | "kind">,
): ResourceToolResultMetadata<TToolName> {
  return {
    toolName,
    kind: "resource",
    ...metadata,
  };
}
