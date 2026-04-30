import type { ToolResult } from "./tool.js";

export interface ToolResourceLinkRequest {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result: ToolResult;
}

export interface ToolResourceLinker {
  link(request: ToolResourceLinkRequest): ToolResult;
}
