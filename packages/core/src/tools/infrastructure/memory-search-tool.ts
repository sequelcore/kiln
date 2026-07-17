import type { ToolResourceRegistry, ToolResourceReadResult } from "../domain/tool-resource-registry.js";
import { memoryToolMetadata } from "../domain/tool-result-metadata.js";
import { TOOL_SCHEMAS, type DevTool, type ToolInput, type ToolResult } from "../domain/tool.js";
import { optionalNumber, optionalString, toErrorResult, toSuccessResult } from "./tool-helpers.js";

type ResourceRegistryResolver = () => ToolResourceRegistry | undefined;

export interface MemorySearchToolOptions {
  readonly resources: ResourceRegistryResolver;
}

export class MemorySearchTool implements DevTool {
  readonly name = "memory_search";
  readonly description = TOOL_SCHEMAS.memory_search.description;
  readonly inputSchema = TOOL_SCHEMAS.memory_search.inputSchema;

  constructor(private readonly options: MemorySearchToolOptions) {}

  async execute(input: ToolInput): Promise<ToolResult> {
    const resources = this.options.resources();
    const parsed = parseMemorySearchInput(input);
    if (!parsed.ok) {
      return parsed.result;
    }
    if (!resources) {
      return toErrorResult("No memory resource registry is configured for this tool surface.", memoryToolMetadata("memory_search", {
        operation: "search",
        ...parsed.metadata,
        resourceUri: parsed.uri,
        errorCode: "registry_unavailable",
      }));
    }

    try {
      const result = await resources.read(parsed.uri);
      const resultCount = extractMemoryResultCount(result);
      const output = await formatMemorySearchOutput(resources, result, parsed.metadata);
      return toSuccessResult(output, memoryToolMetadata("memory_search", {
        operation: "search",
        ...parsed.metadata,
        resourceUri: parsed.uri,
        ...(resultCount !== undefined ? { resultCount } : {}),
        ...(extractMemoryTruncation(result) ? { truncated: true } : {}),
      }));
    } catch (error) {
      const failure = classifyMemorySearchFailure(error);
      return toErrorResult(failure.message, memoryToolMetadata("memory_search", {
        operation: "search",
        ...parsed.metadata,
        resourceUri: parsed.uri,
        errorCode: failure.errorCode,
      }));
    }
  }
}

function parseMemorySearchInput(input: ToolInput): {
  readonly ok: true;
  readonly uri: string;
  readonly metadata: {
    readonly scopeKind?: string;
    readonly scopeId?: string;
    readonly layer?: string;
    readonly query?: string;
  };
} | {
  readonly ok: false;
  readonly result: ToolResult;
} {
  const query = optionalString(input, "query");
  const scopeKind = optionalString(input, "scopeKind");
  const scopeId = optionalString(input, "scopeId");
  const layer = optionalString(input, "layer");
  const depth = optionalNumber(input, "depth");
  const limit = optionalNumber(input, "limit");
  if ((scopeKind && !scopeId) || (!scopeKind && scopeId)) {
    return invalidInput("Memory search scopeKind and scopeId must be provided together");
  }
  if (depth !== undefined && (!Number.isInteger(depth) || depth < 0)) {
    return invalidInput("Memory search depth must be a non-negative integer");
  }
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    return invalidInput("Memory search limit must be a positive integer");
  }

  const params = new URLSearchParams();
  if (scopeKind) params.set("scopeKind", scopeKind);
  if (scopeId) params.set("scopeId", scopeId);
  if (layer) params.set("layer", layer);
  if (query) params.set("query", query);
  if (depth !== undefined) params.set("depth", String(depth));
  if (limit !== undefined) params.set("limit", String(limit));
  const suffix = params.toString();
  return {
    ok: true,
    uri: suffix ? `kiln://memory/graph?${suffix}` : "kiln://memory/graph",
    metadata: {
      ...(scopeKind ? { scopeKind } : {}),
      ...(scopeId ? { scopeId } : {}),
      ...(layer ? { layer } : {}),
      ...(query ? { query } : {}),
    },
  };
}

async function formatMemorySearchOutput(
  resources: ToolResourceRegistry,
  result: ToolResourceReadResult,
  metadata: {
    readonly scopeKind?: string;
    readonly scopeId?: string;
  },
): Promise<string> {
  const content = result.contents[0];
  if (result.contents.length === 1 && content && "text" in content) {
    const graph = parseGraphPayload(content.text);
    if (!graph) {
      return content.text;
    }
    const matches = await readGraphNodeRecords(resources, graph, metadata);
    return JSON.stringify({
      matches,
      graph,
    }, null, 2);
  }
  return JSON.stringify({ contents: result.contents }, null, 2);
}

function parseGraphPayload(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || !("snapshot" in parsed)) {
      return undefined;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

async function readGraphNodeRecords(
  resources: ToolResourceRegistry,
  graph: Record<string, unknown>,
  metadata: {
    readonly scopeKind?: string;
    readonly scopeId?: string;
  },
): Promise<readonly unknown[]> {
  const snapshot = graph.snapshot as { readonly nodes?: unknown } | undefined;
  if (!Array.isArray(snapshot?.nodes)) {
    return [];
  }

  const matches: unknown[] = [];
  for (const node of snapshot.nodes) {
    const recordId = typeof (node as { readonly recordId?: unknown }).recordId === "string"
      ? (node as { readonly recordId: string }).recordId
      : undefined;
    if (!recordId) {
      continue;
    }
    const recordResult = await resources.read(memoryNodeUri(recordId, metadata));
    const recordContent = recordResult.contents[0];
    if (!recordContent || !("text" in recordContent)) {
      continue;
    }
    const parsedRecord = JSON.parse(recordContent.text) as unknown;
    matches.push(parsedRecord);
  }
  return matches;
}

function memoryNodeUri(
  recordId: string,
  metadata: {
    readonly scopeKind?: string;
    readonly scopeId?: string;
  },
): string {
  const params = new URLSearchParams();
  if (metadata.scopeKind) params.set("scopeKind", metadata.scopeKind);
  if (metadata.scopeId) params.set("scopeId", metadata.scopeId);
  const suffix = params.toString();
  return `kiln://memory/nodes/${encodeURIComponent(recordId)}${suffix ? `?${suffix}` : ""}`;
}

function extractMemoryResultCount(result: ToolResourceReadResult): number | undefined {
  const summary = result.summary as { totalCount?: unknown } | undefined;
  return typeof summary?.totalCount === "number" ? summary.totalCount : undefined;
}

function extractMemoryTruncation(result: ToolResourceReadResult): boolean {
  const summary = result.summary as { counts?: { truncated?: unknown } } | undefined;
  return summary?.counts?.truncated === 1;
}

function invalidInput(message: string): {
  readonly ok: false;
  readonly result: ToolResult;
} {
  return {
    ok: false,
    result: toErrorResult(message, memoryToolMetadata("memory_search", {
      operation: "search",
      errorCode: "invalid_input",
    })),
  };
}

function classifyMemorySearchFailure(error: unknown): {
  readonly message: string;
  readonly errorCode: "authorization_denied" | "not_found" | "invalid_input";
} {
  const message = error instanceof Error ? error.message : "Memory search failed";
  const loweredMessage = message.toLowerCase();
  if (isAuthorizationDeniedError(error, loweredMessage)) {
    return {
      message: "Memory search denied by authority policy.",
      errorCode: "authorization_denied",
    };
  }
  if (loweredMessage.includes("not found") || loweredMessage.includes("not be found")) {
    return { message, errorCode: "not_found" };
  }
  return { message, errorCode: "invalid_input" };
}

function isAuthorizationDeniedError(error: unknown, loweredMessage: string): boolean {
  if (!error || typeof error !== "object") {
    return loweredMessage.includes("denied")
      || loweredMessage.includes("forbidden")
      || loweredMessage.includes("unauthorized");
  }
  const record = error as Record<string, unknown>;
  const code = typeof record["code"] === "string" ? record["code"].toLowerCase() : "";
  const name = typeof record["name"] === "string" ? record["name"].toLowerCase() : "";
  return code.includes("denied")
    || code.includes("forbidden")
    || code.includes("unauthorized")
    || name.includes("denied")
    || name.includes("forbidden")
    || name.includes("unauthorized")
    || loweredMessage.includes("denied")
    || loweredMessage.includes("forbidden")
    || loweredMessage.includes("unauthorized");
}
