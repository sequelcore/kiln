import type { ToolOutputVerbosity } from "../domain/tool-result-metadata.js";
import { catalogToolMetadata } from "../domain/tool-result-metadata.js";
import { ToolCatalogIndex, type ToolCatalogSearchRequest } from "../domain/tool-catalog.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { parseOutputVerbosity } from "./output-verbosity.js";
import { optionalBoolean, optionalNumber, optionalString, toErrorResult, toSuccessResult } from "./tool-helpers.js";

export class ToolCatalogSearchTool implements DevTool {
  readonly name = "tool_catalog_search";
  readonly description = TOOL_SCHEMAS.tool_catalog_search.description;
  readonly inputSchema = TOOL_SCHEMAS.tool_catalog_search.inputSchema;
  readonly annotations = TOOL_SCHEMAS.tool_catalog_search.annotations;

  constructor(private readonly catalogProvider: () => ToolCatalogIndex) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const verbosity = parseOutputVerbosity(input);
    if (!verbosity.ok) {
      return verbosity.result;
    }

    const tags = parseTags(input.input.tags);
    if (!tags.ok) {
      return tags.result;
    }

    const query = optionalString(input, "query");
    const exact = optionalString(input, "exact");
    const prefix = optionalString(input, "prefix");
    const limit = optionalNumber(input, "limit");
    const includeSchemas = optionalBoolean(input, "includeSchemas");
    const request: ToolCatalogSearchRequest = {
      ...(query ? { query } : {}),
      ...(exact ? { exact } : {}),
      ...(prefix ? { prefix } : {}),
      ...(tags.value.length > 0 ? { tags: tags.value } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(includeSchemas !== undefined ? { includeSchemas } : {}),
    };

    const result = this.catalogProvider().search(request);
    const output = formatCatalogOutput(result, verbosity.value);
    return toSuccessResult(output, catalogToolMetadata("tool_catalog_search", {
      operation: "search",
      ...(request.query ? { query: request.query } : {}),
      ...(request.exact ? { exact: request.exact } : {}),
      ...(request.prefix ? { prefix: request.prefix } : {}),
      ...(request.tags ? { tags: request.tags } : {}),
      resultCount: result.entries.length,
      totalIndexed: result.totalIndexed,
      includedSchemas: request.includeSchemas ?? false,
      stale: result.stale ?? false,
      verbosity: verbosity.value,
    }));
  }
}

function parseTags(value: unknown): { ok: true; value: readonly string[] } | { ok: false; result: ToolResult } {
  if (value === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return { ok: false, result: toErrorResult('Invalid input: "tags" must be an array of strings') };
  }
  return { ok: true, value: value.map((item) => item.trim()).filter(Boolean) };
}

function formatCatalogOutput(
  result: ReturnType<ToolCatalogIndex["search"]>,
  verbosity: ToolOutputVerbosity,
): string {
  if (verbosity === "structured") {
    return JSON.stringify(result, null, 2);
  }

  if (verbosity === "summary") {
    return `${result.entries.length}/${result.totalIndexed} tools matched: ${result.entries
      .map((entry) => entry.name)
      .join(", ") || "none"}`;
  }

  return result.entries
    .map((entry) => `${entry.name} [${entry.tags.join(", ")}] - ${entry.description}`)
    .join("\n");
}
