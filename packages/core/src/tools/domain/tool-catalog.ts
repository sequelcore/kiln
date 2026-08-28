import { DEV_TOOL_OUTPUT_SCHEMA, type DevTool } from "./tool.js";
import { getBuiltinEffectEnvelope } from "./tool-effect-envelopes.js";
import {
  catalogAuthorityFromEnvelope,
  tagsFromEnvelope,
} from "../../engine/domain/action-effect.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SOURCE_PACKAGE = "@kilnai/core";

export type ToolCatalogAuthority = "read_only" | "destructive" | "standard";
export type ToolCatalogSearchReason =
  | "not_registered"
  | "unauthorized"
  | "configured_unavailable"
  | "validation_failed"
  | "available";

export type ToolCatalogConfigurationDiagnosticCode =
  | "not_configured"
  | "executable_unavailable"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_mismatch"
  | "digest_probe_failed"
  | "digest_mismatch";

export interface ToolCatalogConfigurationDiagnostic {
  readonly code: ToolCatalogConfigurationDiagnosticCode;
  readonly message: string;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
}

export interface ToolCatalogConfiguredProducerDiagnostic {
  readonly canonicalName: string;
  readonly status: Exclude<ToolCatalogSearchReason, "not_registered" | "unauthorized" | "available">;
  readonly configuration: ToolCatalogConfigurationDiagnostic;
}

export interface ToolCatalogSearchDiagnostic {
  readonly code: ToolCatalogSearchReason;
  readonly requestedName: string;
  readonly canonicalName?: string;
  readonly alias?: string;
  readonly configuration?: ToolCatalogConfigurationDiagnostic;
}

export interface ToolCatalogIndexOptions {
  readonly configuredProducerDiagnostics?: readonly ToolCatalogConfiguredProducerDiagnostic[];
  readonly allowedCanonicalNames?: ReadonlySet<string>;
  readonly knownCanonicalNames?: readonly string[];
}

export interface ToolCatalogAlias {
  readonly alias: string;
  readonly canonicalName: string;
  /**
   * Whether this discovery alias is explicit enough to create a completion
   * obligation from imperative user text. Omitted/false aliases remain useful
   * for catalog discovery but are never treated as required producers.
   */
  readonly obligationSafe?: boolean;
}

/** Canonical provider-facing names and their operator-facing exact aliases. */
export const TOOL_CATALOG_ALIASES: readonly ToolCatalogAlias[] = Object.freeze([
  Object.freeze({ alias: "Dafny", canonicalName: "formal_verify", obligationSafe: true }),
  Object.freeze({ alias: "Oxlint", canonicalName: "static_analyze", obligationSafe: true }),
  Object.freeze({ alias: "Gentle", canonicalName: "gentle_review" }),
  Object.freeze({ alias: "Gentle AI", canonicalName: "gentle_review", obligationSafe: true }),
]);

/**
 * Explicit producer aliases used by completion-obligation resolution. Keep
 * this projection separate from discovery aliases: ordinary prose can contain
 * a discovery term without asking Runtime to require its producer.
 */
export const TOOL_CATALOG_OBLIGATION_ALIASES: readonly ToolCatalogAlias[] = Object.freeze(
  TOOL_CATALOG_ALIASES.filter((mapping) => mapping.obligationSafe === true),
);

export interface ToolCatalogEntry {
  readonly name: string;
  readonly aliases?: readonly string[];
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
  readonly diagnostic?: ToolCatalogSearchDiagnostic;
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
  readonly configuredProducerDiagnostics: readonly ToolCatalogConfiguredProducerDiagnostic[];
  private readonly allowedCanonicalNames?: ReadonlySet<string>;
  private readonly knownCanonicalNames: ReadonlySet<string>;

  constructor(
    entries: readonly ToolCatalogEntry[],
    adapter: ToolCatalogSearchAdapter = new LexicalToolCatalogSearchAdapter(),
    options: ToolCatalogIndexOptions = {},
  ) {
    this.entries = entries.map((entry) => normalizeEntry(entry));
    this.adapter = adapter;
    this.configuredProducerDiagnostics = options.configuredProducerDiagnostics?.map(cloneConfiguredProducerDiagnostic) ?? [];
    this.allowedCanonicalNames = options.allowedCanonicalNames;
    this.knownCanonicalNames = new Set([
      ...(options.knownCanonicalNames ?? []),
      ...this.entries.map((entry) => entry.name),
      ...this.configuredProducerDiagnostics.map((diagnostic) => diagnostic.canonicalName),
    ]);
  }

  static fromTools(
    tools: readonly DevTool[],
    adapter?: ToolCatalogSearchAdapter,
    options?: ToolCatalogIndexOptions,
  ): ToolCatalogIndex {
    return new ToolCatalogIndex(tools.map((tool) => entryFromTool(tool)), adapter, options);
  }

  restrictToCanonicalNames(allowedCanonicalNames: ReadonlySet<string>): ToolCatalogIndex {
    return new ToolCatalogIndex(
      this.entries.filter((entry) => allowedCanonicalNames.has(entry.name)),
      this.adapter,
      {
        configuredProducerDiagnostics: this.configuredProducerDiagnostics,
        allowedCanonicalNames,
        knownCanonicalNames: [...this.knownCanonicalNames],
      },
    );
  }

  list(options: { readonly includeSchemas?: boolean } = {}): readonly ToolCatalogEntry[] {
    return this.entries.map((entry) => cloneEntry(entry, options.includeSchemas ?? false));
  }

  search(request: ToolCatalogSearchRequest): ToolCatalogSearchResult {
    const limit = clampLimit(request.limit);
    const includeSchemas = request.includeSchemas ?? false;
    const exact = normalize(request.exact);
    const requestedName = request.exact?.trim() || exact || "";
    const exactResolution = exact ? this.resolveExact(exact) : undefined;
    const configuredDiagnostic = exactResolution
      ? this.configuredDiagnosticFor(exactResolution.canonicalName)
      : undefined;
    if (exactResolution && !this.hasCanonicalEntry(exactResolution.canonicalName) && configuredDiagnostic) {
      const diagnostic = createSearchDiagnostic(
        configuredDiagnostic.status,
        requestedName,
        exactResolution,
        configuredDiagnostic.configuration,
      );
      return {
        entries: [],
        totalIndexed: this.entries.length,
        stale: true,
        reason: diagnostic.code,
        diagnostic,
      };
    }
    if (exactResolution && this.isUnauthorized(exactResolution.canonicalName)) {
      const diagnostic = createSearchDiagnostic("unauthorized", requestedName, exactResolution);
      return {
        entries: [],
        totalIndexed: this.entries.length,
        stale: true,
        reason: diagnostic.code,
        diagnostic,
      };
    }

    const effectiveRequest = exactResolution
      ? { ...request, exact: exactResolution.canonicalName }
      : request;
    const entries = this.adapter.search(this.entries, effectiveRequest).slice(0, limit);
    const stale = Boolean(exact) && entries.length === 0;
    const diagnostic = exact
      ? this.exactDiagnostic(requestedName, exactResolution, entries)
      : undefined;

    return {
      entries: entries.map((entry) => cloneEntry(entry, includeSchemas)),
      totalIndexed: this.entries.length,
      ...(stale ? { stale: true } : {}),
      ...(diagnostic ? { reason: diagnostic.code, diagnostic } : {}),
    };
  }

  private resolveExact(exact: string): { readonly canonicalName: string; readonly alias?: string } | undefined {
    const alias = aliasForExact(exact);
    if (alias) {
      return alias;
    }
    const canonicalName = [...this.knownCanonicalNames].find((name) => name.toLowerCase() === exact);
    return canonicalName ? { canonicalName } : undefined;
  }

  private isUnauthorized(canonicalName: string): boolean {
    return this.allowedCanonicalNames !== undefined && !this.allowedCanonicalNames.has(canonicalName);
  }

  private hasCanonicalEntry(canonicalName: string): boolean {
    return this.entries.some((entry) => entry.name === canonicalName);
  }

  private configuredDiagnosticFor(canonicalName: string): ToolCatalogConfiguredProducerDiagnostic | undefined {
    return this.configuredProducerDiagnostics.find((diagnostic) => diagnostic.canonicalName === canonicalName);
  }

  private exactDiagnostic(
    requestedName: string,
    resolution: { readonly canonicalName: string; readonly alias?: string } | undefined,
    entries: readonly ToolCatalogEntry[],
  ): ToolCatalogSearchDiagnostic | undefined {
    if (!resolution) {
      if (entries.length > 0) return undefined;
      return createSearchDiagnostic("not_registered", requestedName);
    }
    if (entries.length > 0) {
      return resolution.alias
        ? createSearchDiagnostic("available", requestedName, resolution)
        : undefined;
    }
    const configured = this.configuredDiagnosticFor(resolution.canonicalName);
    if (configured) {
      return createSearchDiagnostic(configured.status, requestedName, resolution, configured.configuration);
    }
    return createSearchDiagnostic("not_registered", requestedName, resolution);
  }
}

function entryFromTool(tool: DevTool): ToolCatalogEntry {
  const outputSchema = tool.outputSchema ?? DEV_TOOL_OUTPUT_SCHEMA;
  return {
    name: tool.name,
    ...(aliasesForCanonicalName(tool.name).length > 0 ? { aliases: aliasesForCanonicalName(tool.name) } : {}),
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
  const envelope = getBuiltinEffectEnvelope(tool.name);
  if (!envelope) {
    return "standard";
  }
  return catalogAuthorityFromEnvelope(envelope);
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
  if (tool.name === "json_query") {
    tags.add("structured-data");
    tags.add("json");
    tags.add("query");
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
  if (tool.name.startsWith("browser_")) {
    tags.add("interactive");
    tags.add("browser");
    tags.add("automation");
  }
  if (tool.name.startsWith("computer_")) {
    tags.add("interactive");
    tags.add("computer");
    tags.add("automation");
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

  // Authority tags derived from canonical effect envelope
  const envelope = getBuiltinEffectEnvelope(tool.name);
  if (envelope) {
    for (const effectTag of tagsFromEnvelope(envelope)) {
      tags.add(effectTag);
    }
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
    ...(entry.aliases && entry.aliases.length > 0 ? { aliases: [...entry.aliases] } : {}),
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

function normalizeEntry(entry: ToolCatalogEntry): ToolCatalogEntry {
  const aliases = aliasesForCanonicalName(entry.name);
  return {
    ...entry,
    ...(aliases.length > 0 ? { aliases } : {}),
    tags: [...entry.tags],
    inputFields: [...entry.inputFields],
    outputFields: [...entry.outputFields],
    ...(entry.inputSchema ? { inputSchema: cloneRecord(entry.inputSchema) } : {}),
    ...(entry.outputSchema ? { outputSchema: cloneRecord(entry.outputSchema) } : {}),
  };
}

function aliasesForCanonicalName(canonicalName: string): readonly string[] {
  return TOOL_CATALOG_ALIASES
    .filter((mapping) => mapping.canonicalName === canonicalName)
    .map((mapping) => mapping.alias);
}

function aliasForExact(exact: string): { readonly canonicalName: string; readonly alias: string } | undefined {
  const mapping = TOOL_CATALOG_ALIASES.find((candidate) => candidate.alias.toLowerCase() === exact);
  return mapping ? { canonicalName: mapping.canonicalName, alias: mapping.alias } : undefined;
}

function createSearchDiagnostic(
  code: ToolCatalogSearchReason,
  requestedName: string,
  resolution?: { readonly canonicalName: string; readonly alias?: string },
  configuration?: ToolCatalogConfigurationDiagnostic,
): ToolCatalogSearchDiagnostic {
  return {
    code,
    requestedName,
    ...(resolution?.canonicalName ? { canonicalName: resolution.canonicalName } : {}),
    ...(resolution?.alias ? { alias: resolution.alias } : {}),
    ...(configuration ? { configuration: cloneConfigurationDiagnostic(configuration) } : {}),
  };
}

function cloneConfiguredProducerDiagnostic(
  diagnostic: ToolCatalogConfiguredProducerDiagnostic,
): ToolCatalogConfiguredProducerDiagnostic {
  return {
    canonicalName: diagnostic.canonicalName,
    status: diagnostic.status,
    configuration: cloneConfigurationDiagnostic(diagnostic.configuration),
  };
}

function cloneConfigurationDiagnostic(
  diagnostic: ToolCatalogConfigurationDiagnostic,
): ToolCatalogConfigurationDiagnostic {
  return {
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.expectedVersion ? { expectedVersion: diagnostic.expectedVersion } : {}),
    ...(diagnostic.observedVersion ? { observedVersion: diagnostic.observedVersion } : {}),
  };
}

function scoreEntry(entry: ToolCatalogEntry, tokens: readonly string[]): number {
  const weightedFields = [
    { value: entry.name, weight: 6 },
    { value: entry.aliases?.join(" ") ?? "", weight: 6 },
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
