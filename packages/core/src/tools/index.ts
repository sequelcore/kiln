export type {
  DevTool,
  DevToolAnnotations,
  DevToolName,
  ToolInput,
  ToolResult,
  ToolResultContentPart,
} from "./domain/tool.js";
export { TOOL_SCHEMAS } from "./domain/tool.js";

export type {
  CodeIntelligenceAdapter,
  CodeIntelligenceEntry,
  CodeIntelligenceOperation as CodeIntelligenceDomainOperation,
  CodeIntelligencePosition,
  CodeIntelligenceRange,
  CodeIntelligenceRequest,
  CodeIntelligenceResult,
} from "./domain/code-intelligence.js";

export type {
  CatalogToolName,
  CatalogToolOperation,
  CatalogToolResultMetadata,
  CodeIntelligenceErrorCode,
  CodeIntelligenceOperation,
  CodeToolName,
  CodeToolResultMetadata,
  CommandToolName,
  CommandToolResultMetadata,
  FileToolChangeMetadata,
  FileToolName,
  FileToolOperation,
  FileToolResultMetadata,
  GrepOutputMode,
  InspectionEntryType,
  InspectionToolName,
  InspectionToolOperation,
  InspectionToolResultMetadata,
  ImageDetail,
  MediaToolName,
  MediaToolOperation,
  MediaToolResultMetadata,
  MonitorStatus,
  MonitorToolName,
  MonitorToolOperation,
  MonitorToolResultMetadata,
  SessionTaskStatus,
  SearchToolName,
  SearchToolResultMetadata,
  SearchToolStrategy,
  TaskStateToolName,
  TaskStateToolOperation,
  TaskStateToolResultMetadata,
  ToolOutputVerbosity,
  ToolResultMetadata,
  WebSourceMetadata,
  WebToolErrorCode,
  WebToolName,
  WebToolOperation,
  WebToolResultMetadata,
} from "./domain/tool-result-metadata.js";
export {
  catalogToolMetadata,
  codeToolMetadata,
  commandToolMetadata,
  fileToolMetadata,
  inspectionToolMetadata,
  isFileToolResultMetadata,
  mediaToolMetadata,
  monitorToolMetadata,
  searchToolMetadata,
  taskStateToolMetadata,
  webToolMetadata,
} from "./domain/tool-result-metadata.js";

export type {
  ToolCatalogAuthority,
  ToolCatalogEntry,
  ToolCatalogSearchAdapter,
  ToolCatalogSearchReason,
  ToolCatalogSearchRequest,
  ToolCatalogSearchResult,
} from "./domain/tool-catalog.js";
export {
  LexicalToolCatalogSearchAdapter,
  ToolCatalogIndex,
} from "./domain/tool-catalog.js";

export { DevToolRegistry } from "./domain/tool-registry.js";

export type {
  BinaryInfo,
  ToolEnvironment,
  ToolEnvironmentOptions,
} from "./domain/tool-environment.js";
export {
  clearToolEnvironmentCache,
  detectToolEnvironment,
} from "./domain/tool-environment.js";

export type { ToolSandboxContext } from "./infrastructure/tool-helpers.js";
export { DEV_TOOL_OUTPUT_SCHEMA } from "./domain/tool.js";
export type { BashToolOptions } from "./infrastructure/bash-tool.js";
export { BashTool } from "./infrastructure/bash-tool.js";
export type { CodeIntelligenceToolOptions } from "./infrastructure/code-intelligence-tool.js";
export { CodeIntelligenceTool } from "./infrastructure/code-intelligence-tool.js";
export type {
  MonitorCommandRequest,
  MonitorCommandRunner,
  MonitorEvent,
  MonitorFinishResult,
  MonitorOutputSink,
  MonitorProcessHandle,
  MonitorRegistryOptions,
  MonitorSnapshot,
} from "./infrastructure/monitor-tools.js";
export {
  MonitorListTool,
  MonitorReadTool,
  MonitorRegistry,
  MonitorStartTool,
  MonitorStopTool,
} from "./infrastructure/monitor-tools.js";
export type {
  SessionTask,
  TaskStateSnapshot,
  TaskStateStoreOptions,
} from "./infrastructure/task-state-tools.js";
export {
  TaskListTool,
  TaskStateStore,
  TaskUpdateTool,
} from "./infrastructure/task-state-tools.js";
export { ReadTool } from "./infrastructure/read-tool.js";
export { ReadManyTool } from "./infrastructure/read-many-tool.js";
export { WriteTool } from "./infrastructure/write-tool.js";
export { EditTool } from "./infrastructure/edit-tool.js";
export { PatchTool } from "./infrastructure/patch-tool.js";
export { StatTool } from "./infrastructure/stat-tool.js";
export { TreeTool } from "./infrastructure/tree-tool.js";
export { ToolCatalogSearchTool } from "./infrastructure/tool-catalog-search-tool.js";
export { ViewImageTool } from "./infrastructure/view-image-tool.js";
export type {
  OcrImageRequest,
  OcrImageResult,
  OcrImageRunner,
  OcrImageToolOptions,
} from "./infrastructure/ocr-image-tool.js";
export { OcrImageTool } from "./infrastructure/ocr-image-tool.js";
export type { GrepToolOptions } from "./infrastructure/grep-tool.js";
export { GrepTool } from "./infrastructure/grep-tool.js";
export type { GlobToolOptions } from "./infrastructure/glob-tool.js";
export { GlobTool } from "./infrastructure/glob-tool.js";
export type {
  WebFetchClient,
  WebFetchClientRequest,
  WebFetchClientResponse,
  WebFetchToolOptions,
} from "./infrastructure/web-fetch-tool.js";
export { WebFetchTool } from "./infrastructure/web-fetch-tool.js";
export type {
  WebSearchProvider,
  WebSearchProviderRequest,
  WebSearchProviderResponse,
  WebSearchToolOptions,
} from "./infrastructure/web-search-tool.js";
export { WebSearchTool } from "./infrastructure/web-search-tool.js";
export type { GitToolOptions } from "./infrastructure/git-tool.js";
export { GitTool } from "./infrastructure/git-tool.js";
export type {
  DefaultBuiltinToolRegistryView,
  DefaultBuiltinToolSurface,
  DefaultBuiltinToolProjectionOptions,
  DevToolSchemaProjection,
  DefaultBuiltinToolRegistryOptions,
} from "./default-tool-surface.js";
export {
  createDefaultBuiltinTools,
  createDefaultBuiltinToolRegistry,
  createDefaultBuiltinToolSurface,
  projectDevToolSchemas,
  projectDevToolDefinitions,
  projectDevToolCapabilities,
} from "./default-tool-surface.js";
export type {
  DevToolExecutionBridgeOptions,
  DevToolAuthorizationDecision,
  DevToolExecutionRequest,
  DevToolExecutionResult,
} from "./tool-executor.js";
export { DevToolExecutionBridge } from "./tool-executor.js";

export type {
  DevToolsMcpCallResult,
  DevToolsMcpServerOptions,
  DevToolsMcpToolSchema,
} from "./mcp/dev-tools-server.js";
export { DevToolsMcpServer } from "./mcp/dev-tools-server.js";
