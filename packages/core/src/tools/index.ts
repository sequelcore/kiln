export type {
  DevTool,
  DevToolAnnotations,
  DevToolName,
  ToolInput,
  ToolResult,
} from "./domain/tool.js";
export { TOOL_SCHEMAS } from "./domain/tool.js";

export type {
  CommandToolName,
  CommandToolResultMetadata,
  FileToolName,
  FileToolOperation,
  FileToolResultMetadata,
  GrepOutputMode,
  SearchToolName,
  SearchToolResultMetadata,
  SearchToolStrategy,
  ToolResultMetadata,
} from "./domain/tool-result-metadata.js";
export {
  commandToolMetadata,
  fileToolMetadata,
  isFileToolResultMetadata,
  searchToolMetadata,
} from "./domain/tool-result-metadata.js";

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
export type { BashToolOptions } from "./infrastructure/bash-tool.js";
export { BashTool } from "./infrastructure/bash-tool.js";
export { ReadTool } from "./infrastructure/read-tool.js";
export { WriteTool } from "./infrastructure/write-tool.js";
export { EditTool } from "./infrastructure/edit-tool.js";
export type { GrepToolOptions } from "./infrastructure/grep-tool.js";
export { GrepTool } from "./infrastructure/grep-tool.js";
export type { GlobToolOptions } from "./infrastructure/glob-tool.js";
export { GlobTool } from "./infrastructure/glob-tool.js";
export type { GitToolOptions } from "./infrastructure/git-tool.js";
export { GitTool } from "./infrastructure/git-tool.js";
export type {
  DefaultBuiltinToolRegistryView,
  DefaultBuiltinToolSurface,
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
