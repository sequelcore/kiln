export type {
  DevTool,
  DevToolAnnotations,
  DevToolName,
  ToolInput,
  ToolResult,
  ToolResultContentPart,
  ToolResultResourcePayload,
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
  ElicitationMode,
  ElicitationOutcome,
  ElicitationToolErrorCode,
  ElicitationToolName,
  ElicitationToolOperation,
  ElicitationToolResultMetadata,
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
  ResourceToolName,
  ResourceToolOperation,
  ResourceToolResultMetadata,
  SessionTaskStatus,
  SearchToolName,
  SearchToolResultMetadata,
  SearchToolStrategy,
  TaskStateToolName,
  TaskStateToolOperation,
  TaskStateToolResultMetadata,
  ToolOutputVerbosity,
  ToolResourceLinkMetadata,
  ToolResourceLinkRelation,
  ToolResultMetadata,
  ToolResultResourceLinkMetadata,
  ToolSpecificResultMetadata,
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
  elicitationToolMetadata,
  fileToolMetadata,
  inspectionToolMetadata,
  isFileToolResultMetadata,
  mediaToolMetadata,
  monitorToolMetadata,
  resourceToolMetadata,
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

export type {
  ToolResourceDisplayDescriptor,
} from "./domain/tool-resource-display.js";
export {
  projectToolResourceDescriptor,
  projectToolResourceLink,
  projectToolResultResourceLinks,
} from "./domain/tool-resource-display.js";
export type {
  ToolResourceChangeNotifier,
  ToolResourceListChangedNotification,
  ToolResourceNotification,
  ToolResourceNotificationHubOptions,
  ToolResourceNotificationSender,
  ToolResourceSessionRegistration,
  ToolResourceSubscription,
  ToolResourceUpdatedNotification,
} from "./domain/tool-resource-notifications.js";
export {
  ToolResourceNotificationHub,
} from "./domain/tool-resource-notifications.js";
export type {
  ToolResourceContent,
  ToolResourceDescriptor,
  ToolResourceListOptions,
  ToolResourcePage,
  ToolResourceProvider,
  ToolResourceReadResult,
  ToolResourceRegistryOptions,
  ToolResourceTemplateDescriptor,
} from "./domain/tool-resource-registry.js";
export { ToolResourceRegistry } from "./domain/tool-resource-registry.js";
export type {
  ToolResourceLinker,
  ToolResourceLinkRequest,
} from "./domain/tool-resource-links.js";

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
export type {
  ArtifactContent,
  ArtifactNamespaceSummary,
  ArtifactProducer,
  ArtifactResource,
  ArtifactResourceMetadata,
  ArtifactResourceProviderOptions,
  ArtifactResourcePutInput,
  ArtifactResourceStore,
  ArtifactRetentionPolicy,
  MemoryArtifactResourceStoreOptions,
} from "./infrastructure/artifact-resource-store.js";
export {
  ArtifactResourceProvider,
  MemoryArtifactResourceStore,
} from "./infrastructure/artifact-resource-store.js";
export type { ArtifactToolResourceLinkerOptions } from "./infrastructure/artifact-tool-resource-linker.js";
export { ArtifactToolResourceLinker } from "./infrastructure/artifact-tool-resource-linker.js";
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
export type {
  OperatorElicitationRequest,
  OperatorElicitationResponder,
  OperatorElicitationResponse,
  OperatorElicitationToolOptions,
} from "./infrastructure/operator-elicitation-tool.js";
export { OperatorElicitationTool } from "./infrastructure/operator-elicitation-tool.js";
export { ReadTool } from "./infrastructure/read-tool.js";
export { ReadManyTool } from "./infrastructure/read-many-tool.js";
export { ResourceListTool, ResourceReadTool, ResourceTemplateListTool } from "./infrastructure/resource-tools.js";
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
export type { WorkspaceResourceProviderOptions } from "./infrastructure/workspace-resource-provider.js";
export { WorkspaceResourceProvider } from "./infrastructure/workspace-resource-provider.js";
export type { GitToolOptions } from "./infrastructure/git-tool.js";
export { GitTool } from "./infrastructure/git-tool.js";
export type {
  DefaultBuiltinToolRegistryView,
  DefaultBuiltinToolSurface,
  DefaultBuiltinToolProjectionOptions,
  DevToolSchemaProjection,
  DefaultBuiltinToolRegistryOptions,
  DefaultArtifactResourceOptions,
} from "./default-tool-surface.js";
export {
  createDefaultBuiltinTools,
  createDefaultBuiltinToolRegistry,
  createDefaultBuiltinToolSurface,
  createSessionBuiltinToolOptions,
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
  DevToolsMcpListResourcesResult,
  DevToolsMcpListResourceTemplatesResult,
  DevToolsMcpServerOptions,
  DevToolsMcpToolSchema,
} from "./mcp/dev-tools-server.js";
export { DevToolsMcpServer } from "./mcp/dev-tools-server.js";
