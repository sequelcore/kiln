import type { Capability, ToolDefinition } from "@kilnai/core";
import {
  digestToolDefinition,
  normalizeActionEffectEnvelope,
  sha256ContentIdentity,
} from "@kilnai/core";
import type { EffectiveAuthorityAdmissionBundle } from "./effective-authority-admission-bundle.js";
import type { RuntimeBuiltinToolExecutor } from "./runtime-session-orchestrator.types.js";

type Sha256Digest = `sha256:${string}`;

export type ProgressiveToolAdmissionDecision =
  | "admitted"
  | "already_materialized"
  | "outside_authority"
  | "not_found"
  | "not_materializable";

export interface MaterializableRuntimeToolBinding {
  readonly definition: ToolDefinition;
  readonly definitionDigest: Sha256Digest;
  readonly capability: Capability;
  readonly executor: RuntimeBuiltinToolExecutor;
  readonly executableAdmissionId: Sha256Digest;
}

export interface ProgressiveToolAdmissionResult {
  readonly tools: readonly ToolDefinition[];
  readonly decision: ProgressiveToolAdmissionDecision;
  readonly binding?: MaterializableRuntimeToolBinding;
}

export interface ProgressiveToolCatalogSearchMetadata {
  readonly kind: "catalog";
  readonly toolName: "tool_catalog_search";
  readonly operation: "search";
  readonly stale: boolean;
  readonly materializableToolName?: string;
  readonly catalogSnapshotId?: Sha256Digest;
  readonly materializableToolDefinitionDigest?: Sha256Digest;
  readonly exact?: string;
  readonly resultCount: number;
  readonly totalIndexed?: number;
  readonly includedSchemas?: boolean;
}

interface ProgressiveToolCatalogMaterializationSelection extends ProgressiveToolCatalogSearchMetadata {
  readonly stale: false;
  readonly materializableToolName: string;
  readonly catalogSnapshotId: Sha256Digest;
  readonly materializableToolDefinitionDigest: Sha256Digest;
  readonly exact: string;
  readonly resultCount: 1;
  readonly includedSchemas: true;
}

export interface AdmitProgressiveToolInput {
  readonly tools: readonly ToolDefinition[];
  readonly materializableToolBindings: ReadonlyMap<string, MaterializableRuntimeToolBinding>;
  readonly turnToolAllowlist: ReadonlySet<string>;
  readonly currentCatalogSnapshotId: Sha256Digest;
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined;
  readonly currentExecutor: RuntimeBuiltinToolExecutor | undefined;
  readonly metadata: unknown;
}

const trustedExecutors = new WeakMap<MaterializableRuntimeToolBinding, RuntimeBuiltinToolExecutor>();

/** Checks the binding and the exact definition about to cross a provider boundary. */
export function isMaterializableRuntimeToolBindingIntact(
  binding: MaterializableRuntimeToolBinding,
  projectedDefinition: ToolDefinition = binding.definition,
): boolean {
  try {
    return trustedExecutors.get(binding) === binding.executor
      && binding.definition.name === projectedDefinition.name
      && digestToolDefinition(binding.definition) === binding.definitionDigest
      && digestToolDefinition(projectedDefinition) === binding.definitionDigest;
  } catch {
    return false;
  }
}

/** Creates the one Runtime-owned definition/capability/executor identity. */
export function createMaterializableRuntimeToolBinding(input: {
  readonly definition: ToolDefinition;
  readonly capability: Capability;
  readonly executor: RuntimeBuiltinToolExecutor;
  readonly scopeIdentity: string;
}): MaterializableRuntimeToolBinding {
  if (!input.scopeIdentity.trim()) {
    throw new TypeError("Materializable runtime tool binding requires a stable scope identity.");
  }
  if (input.definition.name !== input.capability.name) {
    throw new TypeError("Materializable runtime tool binding definition and capability names must match.");
  }
  const effectEnvelope = normalizeActionEffectEnvelope(input.capability.effectEnvelope);
  if (!effectEnvelope) {
    throw new TypeError(`Materializable runtime tool '${input.definition.name}' requires a declared effect envelope.`);
  }
  // Provider projection can outlive the catalog-search execution that admitted
  // it. Detach the definition at this binding boundary so later mutation of a
  // caller-owned schema or Set cannot change what a continued round sends.
  const definition = snapshotToolDefinition(input.definition);
  const definitionDigest = digestToolDefinition(definition) as Sha256Digest;
  const executableAdmissionId = sha256ContentIdentity(JSON.stringify({
    revision: "materializable-runtime-tool-binding/v1",
    scopeIdentity: input.scopeIdentity,
    toolName: definition.name,
    definitionDigest,
    effectEnvelope,
  })) as Sha256Digest;
  const binding = Object.freeze({
    definition,
    definitionDigest,
    capability: input.capability,
    executor: input.executor,
    executableAdmissionId,
  });
  trustedExecutors.set(binding, input.executor);
  return binding;
}

export function admitProgressiveTool(input: AdmitProgressiveToolInput): ProgressiveToolAdmissionResult {
  const catalogMetadata = readProgressiveToolCatalogMaterializationSelection(input.metadata);
  if (!catalogMetadata) {
    return { tools: input.tools, decision: "not_materializable" };
  }

  const toolName = catalogMetadata.materializableToolName;
  const binding = input.materializableToolBindings.get(toolName);
  if (binding === undefined) {
    return { tools: input.tools, decision: "not_found" };
  }

  if (!input.turnToolAllowlist.has(toolName)) {
    return { tools: input.tools, decision: "outside_authority" };
  }
  const permission = input.authorityAdmission?.turn.tools.allowedToolPermissions.find(
    (candidate) => candidate.toolName === toolName,
  );
  if (!input.authorityAdmission || !permission) {
    return { tools: input.tools, decision: "outside_authority" };
  }

  if (catalogMetadata.catalogSnapshotId !== input.currentCatalogSnapshotId
    || catalogMetadata.materializableToolDefinitionDigest !== binding.definitionDigest
    || binding.definition.name !== toolName
    || !isMaterializableRuntimeToolBindingIntact(binding)
    || input.currentExecutor !== binding.executor
    || !sameEffectEnvelope(permission.effectEnvelope, binding.capability.effectEnvelope)) {
    return { tools: input.tools, decision: "not_materializable" };
  }

  const sameNameDefinitions = input.tools.filter((tool) => tool.name === toolName);
  if (sameNameDefinitions.length > 1) {
    return { tools: input.tools, decision: "not_materializable" };
  }
  const existingDefinition = sameNameDefinitions[0];
  if (existingDefinition !== undefined) {
    if (digestToolDefinition(existingDefinition) !== binding.definitionDigest) {
      return { tools: input.tools, decision: "not_materializable" };
    }
    return { tools: input.tools, decision: "already_materialized", binding };
  }

  return {
    tools: Object.freeze([...input.tools, binding.definition]),
    decision: "admitted",
    binding,
  };
}

export function readProgressiveToolCatalogMaterializationSelection(
  metadata: unknown,
): ProgressiveToolCatalogMaterializationSelection | undefined {
  const catalogMetadata = readProgressiveToolCatalogSearchMetadata(metadata);
  return catalogMetadata && isMaterializationSelection(catalogMetadata)
    ? catalogMetadata
    : undefined;
}

export function readProgressiveToolCatalogSearchMetadata(
  metadata: unknown,
): ProgressiveToolCatalogSearchMetadata | undefined {
  if (!isRecord(metadata)) {
    return undefined;
  }

  if (!(metadata.kind === "catalog"
    && metadata.toolName === "tool_catalog_search"
    && metadata.operation === "search"
    && typeof metadata.stale === "boolean"
    && typeof metadata.resultCount === "number"
    && Number.isInteger(metadata.resultCount)
    && metadata.resultCount >= 0)) {
    return undefined;
  }
  return {
    kind: "catalog",
    toolName: "tool_catalog_search",
    operation: "search",
    stale: metadata.stale,
    resultCount: metadata.resultCount,
    ...(typeof metadata.materializableToolName === "string"
      ? { materializableToolName: metadata.materializableToolName }
      : {}),
    ...(isSha256Digest(metadata.catalogSnapshotId)
      ? { catalogSnapshotId: metadata.catalogSnapshotId }
      : {}),
    ...(isSha256Digest(metadata.materializableToolDefinitionDigest)
      ? { materializableToolDefinitionDigest: metadata.materializableToolDefinitionDigest }
      : {}),
    ...(typeof metadata.exact === "string" ? { exact: metadata.exact } : {}),
    ...(typeof metadata.totalIndexed === "number" ? { totalIndexed: metadata.totalIndexed } : {}),
    ...(typeof metadata.includedSchemas === "boolean" ? { includedSchemas: metadata.includedSchemas } : {}),
  };
}

function isMaterializationSelection(
  metadata: ProgressiveToolCatalogSearchMetadata,
): metadata is ProgressiveToolCatalogMaterializationSelection {
  return metadata.stale === false
    && typeof metadata.materializableToolName === "string"
    && metadata.materializableToolName.length > 0
    && isSha256Digest(metadata.catalogSnapshotId)
    && isSha256Digest(metadata.materializableToolDefinitionDigest)
    && typeof metadata.exact === "string"
    && metadata.resultCount === 1
    && metadata.includedSchemas === true;
}

function sameEffectEnvelope(left: unknown, right: unknown): boolean {
  const normalizedLeft = normalizeActionEffectEnvelope(left);
  const normalizedRight = normalizeActionEffectEnvelope(right);
  return normalizedLeft !== undefined
    && normalizedRight !== undefined
    && JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function snapshotToolDefinition(definition: ToolDefinition): ToolDefinition {
  const snapshot = {
    name: definition.name,
    description: definition.description,
    inputSchema: deepFreeze(structuredClone(definition.inputSchema)),
    ...(definition.outputSchema === undefined
      ? {}
      : { outputSchema: deepFreeze(structuredClone(definition.outputSchema)) }),
    ...(definition.strict === true ? { strict: true as const } : {}),
    tags: immutableReadonlySet([...definition.tags]),
  } satisfies ToolDefinition;

  // Canonicalization is also the shape check for schemas and tags. Run it on
  // the detached value so the digest always describes the provider argument.
  digestToolDefinition(snapshot);
  return Object.freeze(snapshot);
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Array.isArray(value)
    ? value
    : Object.values(value as Record<string, unknown>)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value);
}

function immutableReadonlySet<T>(values: readonly T[]): ReadonlySet<T> {
  const snapshot = Object.freeze([...new Set(values)]);
  const view = {
    get size(): number { return snapshot.length; },
    has(value: T): boolean { return snapshot.includes(value); },
    keys(): SetIterator<T> { return snapshot[Symbol.iterator]() as SetIterator<T>; },
    values(): SetIterator<T> { return snapshot[Symbol.iterator]() as SetIterator<T>; },
    entries(): SetIterator<[T, T]> {
      return snapshot.map((value) => [value, value] as [T, T])[Symbol.iterator]() as SetIterator<[T, T]>;
    },
    forEach(callbackfn: (value: T, key: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
      for (const value of snapshot) callbackfn.call(thisArg, value, value, readonlyView);
    },
    [Symbol.iterator](): SetIterator<T> { return snapshot[Symbol.iterator]() as SetIterator<T>; },
  };
  const readonlyView = view as ReadonlySet<T>;
  return Object.freeze(readonlyView);
}
