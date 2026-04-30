import type { ToolResourceContent, ToolResourceRegistry } from "../domain/tool-resource-registry.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { resourceToolMetadata } from "../domain/tool-result-metadata.js";
import { optionalNumber, optionalString, requireString, toErrorResult, toSuccessResult } from "./tool-helpers.js";

type ResourceRegistryResolver = () => ToolResourceRegistry | undefined;

export interface ResourceToolOptions {
  readonly resources: ResourceRegistryResolver;
}

export class ResourceListTool implements DevTool {
  readonly name = "resource_list";
  readonly description = TOOL_SCHEMAS.resource_list.description;
  readonly inputSchema = TOOL_SCHEMAS.resource_list.inputSchema;
  readonly annotations = TOOL_SCHEMAS.resource_list.annotations;

  constructor(private readonly options: ResourceToolOptions) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const resources = this.options.resources();
    if (!resources) {
      return registryUnavailable("resource_list", "list");
    }

    try {
      const cursor = optionalString(input, "cursor");
      const limit = optionalNumber(input, "limit");
      const page = resources.listPage({ ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) });
      return toSuccessResult(JSON.stringify({
        resources: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }, null, 2), resourceToolMetadata("resource_list", {
        operation: "list",
        ...(cursor ? { cursor } : {}),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        resourceCount: page.items.length,
      }));
    } catch (error) {
      return resourceError("resource_list", "list", error);
    }
  }
}

export class ResourceTemplateListTool implements DevTool {
  readonly name = "resource_template_list";
  readonly description = TOOL_SCHEMAS.resource_template_list.description;
  readonly inputSchema = TOOL_SCHEMAS.resource_template_list.inputSchema;
  readonly annotations = TOOL_SCHEMAS.resource_template_list.annotations;

  constructor(private readonly options: ResourceToolOptions) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const resources = this.options.resources();
    if (!resources) {
      return registryUnavailable("resource_template_list", "list_templates");
    }

    try {
      const cursor = optionalString(input, "cursor");
      const limit = optionalNumber(input, "limit");
      const page = resources.listTemplatePage({ ...(cursor ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) });
      return toSuccessResult(JSON.stringify({
        resourceTemplates: page.items,
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      }, null, 2), resourceToolMetadata("resource_template_list", {
        operation: "list_templates",
        ...(cursor ? { cursor } : {}),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        templateCount: page.items.length,
      }));
    } catch (error) {
      return resourceError("resource_template_list", "list_templates", error);
    }
  }
}

export class ResourceReadTool implements DevTool {
  readonly name = "resource_read";
  readonly description = TOOL_SCHEMAS.resource_read.description;
  readonly inputSchema = TOOL_SCHEMAS.resource_read.inputSchema;
  readonly annotations = TOOL_SCHEMAS.resource_read.annotations;

  constructor(private readonly options: ResourceToolOptions) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const uri = requireString(input, "uri");
    if (!uri.ok) {
      return uri.result;
    }
    const resources = this.options.resources();
    if (!resources) {
      return registryUnavailable("resource_read", "read", uri.value);
    }

    try {
      const result = await resources.read(uri.value);
      return toSuccessResult(formatResourceReadOutput(result.contents), resourceToolMetadata("resource_read", {
        operation: "read",
        uri: uri.value,
        contentCount: result.contents.length,
        mimeType: result.contents[0]?.mimeType,
      }));
    } catch (error) {
      return resourceError("resource_read", "read", error, uri.value);
    }
  }
}

function formatResourceReadOutput(contents: readonly ToolResourceContent[]): string {
  if (contents.length === 1) {
    const content = contents[0];
    if (content && "text" in content) {
      return content.text;
    }
  }
  return JSON.stringify({ contents }, null, 2);
}

function registryUnavailable(
  toolName: "resource_list" | "resource_template_list" | "resource_read",
  operation: "list" | "list_templates" | "read",
  uri?: string,
): ToolResult {
  return toErrorResult("No resource registry is configured for this tool surface.", resourceToolMetadata(toolName, {
    operation,
    ...(uri ? { uri } : {}),
    errorCode: "registry_unavailable",
  }));
}

function resourceError(
  toolName: "resource_list" | "resource_template_list" | "resource_read",
  operation: "list" | "list_templates" | "read",
  error: unknown,
  uri?: string,
): ToolResult {
  const message = error instanceof Error ? error.message : "Resource operation failed";
  const errorCode = message.toLowerCase().includes("cursor")
    ? "cursor_error"
    : message.toLowerCase().includes("not found") || message.toLowerCase().includes("not be found")
      ? "not_found"
      : "invalid_input";
  return toErrorResult(message, resourceToolMetadata(toolName, {
    operation,
    ...(uri ? { uri } : {}),
    errorCode,
  }));
}
