import { sha256ContentIdentity } from "../../content-addressing/content-identity.js";
import {
  catalogAuthorityFromEnvelope,
  normalizeActionEffectEnvelope,
  tagsFromEnvelope,
  type ActionEffectEnvelope,
} from "../../engine/domain/action-effect.js";
import { DEV_TOOL_OUTPUT_SCHEMA, type DevTool } from "./tool.js";
import { getBuiltinEffectEnvelope } from "./tool-effect-envelopes.js";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const SOURCE_PACKAGE = "@kilnai/core";
const SNAPSHOT_IDENTITY_REVISION = "tool-catalog/v1";

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
  readonly catalogContributions?: readonly BuiltinToolCatalogContribution[];
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

/**
 * The provider-facing portion of a tool definition.
 *
 * Tool execution and catalog metadata deliberately do not cross this boundary.
 * Runtime may pass a richer structural definition; only these fields identify
 * the exact definition a provider can materialize.
 */
export interface ToolCatalogDefinitionShape {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly strict?: true;
  /** Provider-facing routing tags (Runtime ToolDefinition-compatible). */
  readonly tags?: Iterable<string>;
}

/** A non-executable, Core-normalized contribution to the builtin tool catalog. */
export interface BuiltinToolCatalogContribution {
  readonly definition: ToolCatalogDefinitionShape;
  readonly effectEnvelope: ActionEffectEnvelope;
  readonly sourcePackage: string;
  readonly aliases?: readonly string[];
}

export type ToolDefinitionDigest = `sha256:${string}`;
export type ToolCatalogSnapshotId = `sha256:${string}`;

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
  readonly toolDefinitionDigest: ToolDefinitionDigest;
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

interface ToolCatalogIndexInternalOptions {
  readonly snapshotId?: ToolCatalogSnapshotId;
  readonly aliasMappings?: readonly ToolCatalogAlias[];
}

/** Normalize and deeply freeze one inert catalog contribution at the Core boundary. */
export function normalizeBuiltinToolCatalogContribution(input: unknown): BuiltinToolCatalogContribution {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, ["definition", "effectEnvelope", "sourcePackage", "aliases"])) {
    throw new TypeError("Builtin tool catalog contribution has an unsupported shape.");
  }

  const definition = normalizeToolDefinitionShape(input.definition);
  const effectEnvelope = normalizeActionEffectEnvelope(input.effectEnvelope);
  if (!effectEnvelope) {
    throw new TypeError("Builtin tool catalog contribution effect envelope is malformed.");
  }
  if (typeof input.sourcePackage !== "string" || input.sourcePackage.trim().length === 0) {
    throw new TypeError("Builtin tool catalog contribution source package is malformed.");
  }

  const aliases = input.aliases === undefined ? undefined : normalizeAliasList(input.aliases);
  return deepFreeze({
    definition,
    effectEnvelope,
    sourcePackage: input.sourcePackage.trim(),
    ...(aliases && aliases.length > 0 ? { aliases } : {}),
  });
}

/** Compute the exact deterministic identity of a provider-facing definition. */
export function digestToolDefinition(definition: ToolCatalogDefinitionShape): ToolDefinitionDigest {
  const normalized = normalizeToolDefinitionShape(definition);
  return sha256ContentIdentity(stableCanonicalStringify(normalized)) as ToolDefinitionDigest;
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
  readonly snapshotId: ToolCatalogSnapshotId;
  private readonly allowedCanonicalNames?: ReadonlySet<string>;
  private readonly knownCanonicalNames: ReadonlySet<string>;
  private readonly aliasMappings: readonly ToolCatalogAlias[];

  constructor(
    entries: readonly ToolCatalogEntry[],
    adapter: ToolCatalogSearchAdapter = new LexicalToolCatalogSearchAdapter(),
    options: ToolCatalogIndexOptions = {},
    internalOptions: ToolCatalogIndexInternalOptions = {},
  ) {
    const normalizedEntries = [
      ...entries.map((entry) => normalizeEntry(entry)),
      ...(options.catalogContributions ?? [])
        .map((contribution) => entryFromContribution(contribution))
        .sort((left, right) => compareCodeUnits(left.name, right.name)),
    ];
    const configuredProducerDiagnostics = options.configuredProducerDiagnostics?.map(cloneConfiguredProducerDiagnostic) ?? [];
    const aliasMappings = internalOptions.aliasMappings
      ? internalOptions.aliasMappings.map(cloneAlias)
      : collectAliasMappings(normalizedEntries);
    assertCatalogIdentity(
      normalizedEntries,
      configuredProducerDiagnostics,
      options.knownCanonicalNames ?? [],
      aliasMappings,
    );

    this.entries = Object.freeze(normalizedEntries.map((entry) => freezeEntry(entry)));
    this.adapter = adapter;
    this.configuredProducerDiagnostics = Object.freeze(configuredProducerDiagnostics);
    this.aliasMappings = Object.freeze(aliasMappings);
    this.allowedCanonicalNames = options.allowedCanonicalNames === undefined
      ? undefined
      : new Set(options.allowedCanonicalNames);
    this.knownCanonicalNames = new Set([
      ...(options.knownCanonicalNames ?? []),
      ...this.entries.map((entry) => entry.name),
      ...this.configuredProducerDiagnostics.map((diagnostic) => diagnostic.canonicalName),
      ...this.aliasMappings.map((mapping) => mapping.canonicalName),
    ]);
    this.snapshotId = internalOptions.snapshotId ?? computeSnapshotId(
      this.entries,
      this.configuredProducerDiagnostics,
    );
    Object.freeze(this);
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
      {
        snapshotId: this.snapshotId,
        aliasMappings: this.aliasMappings,
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
    const alias = this.aliasMappings.find((mapping) => mapping.alias.toLowerCase() === exact);
    if (alias) {
      return { canonicalName: alias.canonicalName, alias: alias.alias };
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
  const definition: ToolCatalogDefinitionShape = {
    name: tool.name,
    description: tool.description,
    inputSchema: cloneRecord(tool.inputSchema),
    outputSchema: cloneRecord(outputSchema),
    tags: [],
  };
  const envelope = normalizedToolEffectEnvelope(tool);
  return {
    name: tool.name,
    ...(aliasesForCanonicalName(tool.name).length > 0 ? { aliases: aliasesForCanonicalName(tool.name) } : {}),
    description: tool.description,
    tags: tagsForTool(tool, envelope),
    authority: envelope ? catalogAuthorityFromEnvelope(envelope) : "standard",
    sourcePackage: SOURCE_PACKAGE,
    inputFields: schemaFields(tool.inputSchema),
    outputFields: schemaFields(outputSchema),
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
    toolDefinitionDigest: digestToolDefinition(definition),
  };
}

function entryFromContribution(input: BuiltinToolCatalogContribution): ToolCatalogEntry {
  const contribution = normalizeBuiltinToolCatalogContribution(input);
  const envelope = contribution.effectEnvelope;
  const definition = contribution.definition;
  const aliases = [
    ...aliasesForCanonicalName(definition.name),
    ...(contribution.aliases ?? []),
  ];
  return {
    name: definition.name,
    ...(aliases.length > 0 ? { aliases } : {}),
    description: definition.description,
    tags: tagsFromEnvelope(envelope),
    authority: catalogAuthorityFromEnvelope(envelope),
    sourcePackage: contribution.sourcePackage,
    inputFields: schemaFields(definition.inputSchema),
    outputFields: definition.outputSchema ? schemaFields(definition.outputSchema) : [],
    inputSchema: definition.inputSchema,
    ...(definition.outputSchema ? { outputSchema: definition.outputSchema } : {}),
    toolDefinitionDigest: digestToolDefinition(definition),
  };
}

function normalizedToolEffectEnvelope(tool: DevTool): ActionEffectEnvelope | undefined {
  const declared = tool.effectEnvelope ?? getBuiltinEffectEnvelope(tool.name);
  return declared ? normalizeActionEffectEnvelope(declared) : undefined;
}

function tagsForTool(tool: DevTool, envelope: ActionEffectEnvelope | undefined): readonly string[] {
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
    toolDefinitionDigest: entry.toolDefinitionDigest,
  };
}

function normalizeEntry(entry: ToolCatalogEntry): ToolCatalogEntry {
  const aliases = [
    ...(entry.aliases ?? []),
    ...aliasesForCanonicalName(entry.name),
  ];
  const inputSchema = entry.inputSchema ? cloneRecord(entry.inputSchema) : undefined;
  const outputSchema = entry.outputSchema ? cloneRecord(entry.outputSchema) : undefined;
  if (!inputSchema) {
    throw new TypeError("Tool catalog entry input schema is required for definition identity.");
  }
  const definition: ToolCatalogDefinitionShape = {
    name: entry.name,
    description: entry.description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    tags: [],
  };
  return {
    ...entry,
    ...(aliases.length > 0 ? { aliases: normalizeAliasList(aliases) } : {}),
    tags: [...entry.tags],
    inputFields: [...entry.inputFields],
    outputFields: [...entry.outputFields],
    ...(inputSchema ? { inputSchema } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    toolDefinitionDigest: digestToolDefinition(definition),
  };
}

function normalizeToolDefinitionShape(input: unknown): ToolCatalogDefinitionShape {
  if (!isPlainRecord(input) || !hasOnlyKeys(input, ["name", "description", "inputSchema", "outputSchema", "strict", "tags"])) {
    throw new TypeError("Builtin tool definition has an unsupported shape.");
  }
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    throw new TypeError("Builtin tool definition name is malformed.");
  }
  if (typeof input.description !== "string") {
    throw new TypeError("Builtin tool definition description is malformed.");
  }
  const inputSchema = normalizeSchemaRecord(input.inputSchema, "input");
  const outputSchema = input.outputSchema === undefined
    ? undefined
    : normalizeSchemaRecord(input.outputSchema, "output");
  if (input.strict !== undefined && input.strict !== true) {
    throw new TypeError("Builtin tool definition strict flag is malformed.");
  }
  // Runtime ToolDefinition always carries a tags collection. Treat an omitted
  // structural field as the provider-visible empty collection so every digest
  // has one canonical shape while still accepting minimal contribution input.
  const tags = input.tags === undefined ? Object.freeze([]) : normalizeDefinitionTags(input.tags);
  return deepFreeze({
    name: input.name.trim(),
    description: input.description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    ...(input.strict === true ? { strict: true as const } : {}),
    tags,
  });
}

function normalizeDefinitionTags(value: unknown): readonly string[] {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function"
  ) {
    throw new TypeError("Builtin tool definition tags must be an iterable of strings.");
  }
  const tags = new Set<string>();
  try {
    for (const tag of value as Iterable<unknown>) {
      if (typeof tag !== "string" || tag.length > 256) {
        throw new TypeError("Builtin tool definition tags must contain bounded strings.");
      }
      tags.add(tag);
    }
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Builtin tool definition tags must be an iterable of strings.");
  }
  return Object.freeze([...tags].sort(compareCodeUnits));
}

function normalizeSchemaRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new TypeError(`Builtin tool definition ${label} schema is malformed.`);
  }
  return deepFreeze(cloneRecord(value));
}

function freezeEntry(entry: ToolCatalogEntry): ToolCatalogEntry {
  return Object.freeze({
    ...entry,
    ...(entry.aliases ? { aliases: Object.freeze([...entry.aliases]) } : {}),
    tags: Object.freeze([...entry.tags]),
    inputFields: Object.freeze([...entry.inputFields]),
    outputFields: Object.freeze([...entry.outputFields]),
    ...(entry.inputSchema ? { inputSchema: deepFreeze(cloneRecord(entry.inputSchema)) } : {}),
    ...(entry.outputSchema ? { outputSchema: deepFreeze(cloneRecord(entry.outputSchema)) } : {}),
  });
}

function collectAliasMappings(entries: readonly ToolCatalogEntry[]): readonly ToolCatalogAlias[] {
  const mappings: ToolCatalogAlias[] = [...TOOL_CATALOG_ALIASES];
  for (const entry of entries) {
    for (const alias of entry.aliases ?? []) {
      if (!mappings.some((mapping) => mapping.alias === alias && mapping.canonicalName === entry.name)) {
        mappings.push({ alias, canonicalName: entry.name });
      }
    }
  }
  return mappings.map(cloneAlias);
}

function assertCatalogIdentity(
  entries: readonly ToolCatalogEntry[],
  diagnostics: readonly ToolCatalogConfiguredProducerDiagnostic[],
  knownCanonicalNames: readonly string[],
  aliases: readonly ToolCatalogAlias[],
): void {
  // Executable and inert catalog entries are identity-bearing records. Two
  // entries with the same spelling are still a collision: silently replacing
  // one would make the provider-facing definition ambiguous.
  const entryCanonicalNames = new Map<string, string>();
  for (const entry of entries) {
    const name = entry.name;
    const normalized = normalizeIdentity(name);
    if (!normalized) {
      throw new TypeError("Tool catalog canonical name is malformed.");
    }
    const previous = entryCanonicalNames.get(normalized);
    if (previous !== undefined) {
      throw new TypeError(`Tool catalog canonical name collision: ${previous} and ${name}.`);
    }
    entryCanonicalNames.set(normalized, name);
  }

  // Known names and unavailable-producer diagnostics are visibility metadata;
  // repeating the exact same name there is harmless, while a case-insensitive
  // spelling conflict remains ambiguous and fails closed.
  const canonicalNames = new Map(entryCanonicalNames);
  for (const name of [
    ...knownCanonicalNames,
    ...diagnostics.map((diagnostic) => diagnostic.canonicalName),
    ...aliases.map((mapping) => mapping.canonicalName),
  ]) {
    const normalized = normalizeIdentity(name);
    if (!normalized) {
      throw new TypeError("Tool catalog canonical name is malformed.");
    }
    const previous = canonicalNames.get(normalized);
    if (previous !== undefined && previous !== name) {
      throw new TypeError(`Tool catalog canonical name collision: ${previous} and ${name}.`);
    }
    canonicalNames.set(normalized, name);
  }

  const aliasesByName = new Map<string, ToolCatalogAlias>();
  for (const mapping of aliases) {
    const aliasKey = normalizeIdentity(mapping.alias);
    const canonicalKey = normalizeIdentity(mapping.canonicalName);
    if (!aliasKey || !canonicalKey) {
      throw new TypeError("Tool catalog alias is malformed.");
    }
    if (canonicalNames.has(aliasKey)) {
      throw new TypeError(`Tool catalog alias collision with canonical name: ${mapping.alias}.`);
    }
    const previous = aliasesByName.get(aliasKey);
    if (previous !== undefined && normalizeIdentity(previous.canonicalName) !== canonicalKey) {
      throw new TypeError(`Tool catalog alias collision: ${mapping.alias}.`);
    }
    aliasesByName.set(aliasKey, mapping);
  }
}

function computeSnapshotId(
  entries: readonly ToolCatalogEntry[],
  diagnostics: readonly ToolCatalogConfiguredProducerDiagnostic[],
): ToolCatalogSnapshotId {
  const identity = {
    revision: SNAPSHOT_IDENTITY_REVISION,
    entries: [...entries]
      .map(entryIdentity)
      .sort((left, right) => compareCodeUnits(String(left.name), String(right.name))),
    configuredProducerDiagnostics: diagnostics
      .map((diagnostic) => ({
        canonicalName: diagnostic.canonicalName,
        status: diagnostic.status,
        configuration: diagnostic.configuration,
      }))
      .sort((left, right) => compareCodeUnits(left.canonicalName, right.canonicalName)
        || compareCodeUnits(stableCanonicalStringify(left), stableCanonicalStringify(right))),
  };
  return sha256ContentIdentity(stableCanonicalStringify(identity)) as ToolCatalogSnapshotId;
}

/** Canonical JSON for identity material; object key order never affects a digest. */
function stableCanonicalStringify(value: unknown, seen: Set<object> = new Set<object>()): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? "null" : serialized;
  }
  if (seen.has(value)) {
    throw new TypeError("Tool catalog identity cannot contain cyclic data.");
  }
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => stableCanonicalStringify(item, seen)).join(",")}]`;
    }
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => compareCodeUnits(left, right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableCanonicalStringify(entry, seen)}`)
      .join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function entryIdentity(entry: ToolCatalogEntry): Record<string, unknown> {
  return {
    name: entry.name,
    aliases: [...(entry.aliases ?? [])].sort(compareCodeUnits),
    description: entry.description,
    tags: [...entry.tags].sort(compareCodeUnits),
    authority: entry.authority,
    sourcePackage: entry.sourcePackage,
    inputFields: [...entry.inputFields].sort(compareCodeUnits),
    outputFields: [...entry.outputFields].sort(compareCodeUnits),
    ...(entry.inputSchema ? { inputSchema: entry.inputSchema } : {}),
    ...(entry.outputSchema ? { outputSchema: entry.outputSchema } : {}),
    toolDefinitionDigest: entry.toolDefinitionDigest,
  };
}

function normalizeAliasList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Builtin tool catalog aliases must be an array of strings.");
  }
  const aliases = new Set<string>();
  for (const alias of value) {
    if (typeof alias !== "string" || alias.trim().length === 0) {
      throw new TypeError("Builtin tool catalog aliases must contain non-empty strings.");
    }
    aliases.add(alias.trim());
  }
  return Object.freeze([...aliases].sort(compareCodeUnits));
}

function cloneAlias(alias: ToolCatalogAlias): ToolCatalogAlias {
  return Object.freeze({
    alias: alias.alias,
    canonicalName: alias.canonicalName,
    ...(alias.obligationSafe === true ? { obligationSafe: true as const } : {}),
  });
}

function normalizeIdentity(value: string): string {
  return value.trim().toLowerCase();
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Array.isArray(value) ? value : Object.values(value as Record<string, unknown>)) {
    deepFreeze(nested);
  }
  return Object.freeze(value);
}

function aliasesForCanonicalName(canonicalName: string): readonly string[] {
  return TOOL_CATALOG_ALIASES
    .filter((mapping) => mapping.canonicalName === canonicalName)
    .map((mapping) => mapping.alias);
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
  return Object.freeze({
    canonicalName: diagnostic.canonicalName,
    status: diagnostic.status,
    configuration: cloneConfigurationDiagnostic(diagnostic.configuration),
  });
}

function cloneConfigurationDiagnostic(
  diagnostic: ToolCatalogConfigurationDiagnostic,
): ToolCatalogConfigurationDiagnostic {
  return Object.freeze({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.expectedVersion ? { expectedVersion: diagnostic.expectedVersion } : {}),
    ...(diagnostic.observedVersion ? { observedVersion: diagnostic.observedVersion } : {}),
  });
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
