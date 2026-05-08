import { DEV_TOOL_OUTPUT_SCHEMA, type DevTool } from "./tool.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SOURCE_PACKAGE = "@kilnai/core";

export type ToolCatalogAuthority = "read_only" | "destructive" | "standard";
export type ToolCatalogSearchReason = "tool_not_found";

export interface ToolCatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly authority: ToolCatalogAuthority;
  readonly sourcePackage: string;
  readonly inputFields: readonly string[];
  readonly outputFields: readonly string[];
  readonly inputSchema?: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}

export interface ToolCatalogSearchRequest {
  readonly query?: string;
  readonly exact?: string;
  readonly prefix?: string;
  readonly tags?: readonly string[];
  readonly limit?: number;
  readonly includeSchemas?: boolean;
}

export interface ToolCatalogSearchResult {
  readonly entries: readonly ToolCatalogEntry[];
  readonly totalIndexed: number;
  readonly stale?: boolean;
  readonly reason?: ToolCatalogSearchReason;
}

export interface ToolCatalogSearchAdapter {
  search(
    entries: readonly ToolCatalogEntry[],
    request: ToolCatalogSearchRequest,
  ): readonly ToolCatalogEntry[];
}

export class LexicalToolCatalogSearchAdapter implements ToolCatalogSearchAdapter {
  search(
    entries: readonly ToolCatalogEntry[],
    request: ToolCatalogSearchRequest,
  ): readonly ToolCatalogEntry[] {
    let candidates = entries;
    const exact = normalize(request.exact);
    if (exact) {
      candidates = candidates.filter((entry) => entry.name.toLowerCase() === exact);
    }

    const prefix = normalize(request.prefix);
    if (prefix) {
      candidates = candidates.filter((entry) => entry.name.toLowerCase().startsWith(prefix));
    }

    const tags = (request.tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean);
    if (tags.length > 0) {
      candidates = candidates.filter((entry) => {
        const entryTags = new Set(entry.tags.map((tag) => tag.toLowerCase()));
        return tags.every((tag) => entryTags.has(tag));
      });
    }

    const queryTokens = tokenize(request.query);
    if (queryTokens.length === 0) {
      return candidates;
    }

    return candidates
      .map((entry, index) => ({ entry, index, score: scoreEntry(entry, queryTokens) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map((candidate) => candidate.entry);
  }
}

export class ToolCatalogIndex {
  private readonly entries: readonly ToolCatalogEntry[];
  private readonly adapter: ToolCatalogSearchAdapter;

  constructor(
    entries: readonly ToolCatalogEntry[],
    adapter: ToolCatalogSearchAdapter = new LexicalToolCatalogSearchAdapter(),
  ) {
    this.entries = entries.map((entry) => cloneEntry(entry, true));
    this.adapter = adapter;
  }

  static fromTools(
    tools: readonly DevTool[],
    adapter?: ToolCatalogSearchAdapter,
  ): ToolCatalogIndex {
    return new ToolCatalogIndex(tools.map((tool) => entryFromTool(tool)), adapter);
  }

  list(options: { readonly includeSchemas?: boolean } = {}): readonly ToolCatalogEntry[] {
    return this.entries.map((entry) => cloneEntry(entry, options.includeSchemas ?? false));
  }

  search(request: ToolCatalogSearchRequest): ToolCatalogSearchResult {
    const limit = clampLimit(request.limit);
    const entries = this.adapter.search(this.entries, request).slice(0, limit);
    const includeSchemas = request.includeSchemas ?? false;
    const exact = normalize(request.exact);
    const stale = Boolean(exact) && entries.length === 0;

    return {
      entries: entries.map((entry) => cloneEntry(entry, includeSchemas)),
      totalIndexed: this.entries.length,
      ...(stale ? { stale: true, reason: "tool_not_found" as const } : {}),
    };
  }
}

function entryFromTool(tool: DevTool): ToolCatalogEntry {
  const outputSchema = tool.outputSchema ?? DEV_TOOL_OUTPUT_SCHEMA;
  return {
    name: tool.name,
    description: tool.description,
    tags: tagsForTool(tool),
    authority: authorityForTool(tool),
    sourcePackage: SOURCE_PACKAGE,
    inputFields: schemaFields(tool.inputSchema),
    outputFields: schemaFields(outputSchema),
    inputSchema: cloneRecord(tool.inputSchema),
    outputSchema: cloneRecord(outputSchema),
  };
}

function authorityForTool(tool: DevTool): ToolCatalogAuthority {
  if (tool.annotations?.readOnly) {
    return "read_only";
  }
  if (tool.annotations?.destructive) {
    return "destructive";
  }
  return "standard";
}

function tagsForTool(tool: DevTool): readonly string[] {
  const tags = new Set<string>();
  if (tool.name === "read" || tool.name === "read_many" || tool.name === "write" || tool.name === "edit" || tool.name === "patch") {
    tags.add("file");
  }
  if (tool.name === "read_many") {
    tags.add("context");
  }
  if (tool.name === "grep" || tool.name === "glob") {
    tags.add("search");
  }
  if (tool.name === "stat" || tool.name === "tree") {
    tags.add("inspection");
  }
  if (tool.name === "view_image" || tool.name === "ocr_image") {
    tags.add("media");
  }
  if (tool.name === "web_search" || tool.name === "web_fetch" || tool.name === "web_extract") {
    tags.add("web");
  }
  if (tool.name === "bash" || tool.name === "git") {
    tags.add("command");
  }
  if (tool.name === "monitor_start" || tool.name === "monitor_read" || tool.name === "monitor_stop" || tool.name === "monitor_list") {
    tags.add("monitor");
    tags.add("command");
  }
  if (tool.name === "task_list" || tool.name === "task_update") {
    tags.add("task-state");
    tags.add("progress");
  }
  if (tool.name === "operator_elicit") {
    tags.add("operator");
    tags.add("elicitation");
  }
  if (tool.name === "code_intelligence") {
    tags.add("code");
    tags.add("semantic");
  }
  if (tool.name === "tool_catalog_search") {
    tags.add("catalog");
    tags.add("discovery");
  }
  if (tool.name === "resource_list" || tool.name === "resource_template_list" || tool.name === "resource_read") {
    tags.add("resource");
    tags.add("context");
  }
  if (tool.annotations?.readOnly) {
    tags.add("read-only");
  }
  if (tool.annotations?.idempotent) {
    tags.add("idempotent");
  }
  if (tool.annotations?.destructive) {
    tags.add("destructive");
  }
  return Array.from(tags);
}

function schemaFields(schema: Record<string, unknown>): readonly string[] {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }
  return Object.keys(properties);
}

function cloneEntry(entry: ToolCatalogEntry, includeSchemas: boolean): ToolCatalogEntry {
  return {
    name: entry.name,
    description: entry.description,
    tags: [...entry.tags],
    authority: entry.authority,
    sourcePackage: entry.sourcePackage,
    inputFields: [...entry.inputFields],
    outputFields: [...entry.outputFields],
    ...(includeSchemas && entry.inputSchema ? { inputSchema: cloneRecord(entry.inputSchema) } : {}),
    ...(includeSchemas && entry.outputSchema ? { outputSchema: cloneRecord(entry.outputSchema) } : {}),
  };
}

function scoreEntry(entry: ToolCatalogEntry, tokens: readonly string[]): number {
  const weightedFields = [
    { value: entry.name, weight: 6 },
    { value: entry.tags.join(" "), weight: 4 },
    { value: entry.description, weight: 3 },
    { value: entry.inputFields.join(" "), weight: 2 },
    { value: entry.outputFields.join(" "), weight: 1 },
  ];

  let score = 0;
  for (const token of tokens) {
    for (const field of weightedFields) {
      const value = field.value.toLowerCase();
      if (value === token) {
        score += field.weight * 3;
      } else if (value.split(/[^a-z0-9_]+/).includes(token)) {
        score += field.weight * 2;
      } else if (value.includes(token)) {
        score += field.weight;
      }
    }
  }
  return score;
}

function tokenize(value: string | undefined): readonly string[] {
  if (!value) {
    return [];
  }
  return value.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean);
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function clampLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneJsonValue(value) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }

  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneJsonValue(nestedValue);
    }
    return clone;
  }

  return value;
}
