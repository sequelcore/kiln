import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { normalizeActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import { isProxy } from "node:util/types";
import {
  buildCapabilityCatalog,
  type CapabilityApprovalPosture,
  type CapabilityCatalogSnapshot,
  type CapabilityCallerId,
  type CapabilityDataPosture,
  type CapabilityDescriptorCandidate,
  type CapabilityImplementationKind,
  type CapabilityKind,
  type CapabilityLimits,
  type CapabilityNetworkPosture,
  type CapabilityOwnerKind,
  type CapabilityPermission,
  type CapabilityProvenanceSource,
  type Sha256Digest,
} from "./capability-catalog.js";
import {
  DEFAULT_JSON_SCHEMA_SAFETY_LIMITS,
  type JsonSchemaSafetyReason,
  type JsonSchemaSafetyResult,
  validateJsonSchemaSafety,
} from "./capability-json-schema-safety.js";

/** The only OpenAPI feature line admitted by this adapter. */
export const OPENAPI_SPEC_FEATURE_LINE = "3.1" as const;

/** Adapter contract revision. It participates in every candidate identity. */
export const OPENAPI_CAPABILITY_DISCOVERY_REVISION = "openapi-capability-discovery/v1" as const;

/** The digest used when an operation has no settled response schema. */
export const OPENAPI_OUTPUT_SCHEMA_ABSENT_DIGEST = sha256(
  `${OPENAPI_CAPABILITY_DISCOVERY_REVISION}/output-schema/absent`,
);

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const OPENAPI_SPEC_REVISION_PATTERN = /^3\.1\.(?:0|[1-9]\d*)$/u;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u;
const PATH_PATTERN = /^\/[\u0021-\u007e]{0,511}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_SNAPSHOT_OPERATIONS = 10_000;
const MAX_EVENT_DECLARATIONS = 10_000;
const MAX_BINDINGS = 10_000;
const MAX_CATALOG_ENTRIES = 10_000;
const MAX_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_DESCRIPTION_LENGTH = 16_384;
const METHODS = ["delete", "get", "head", "options", "patch", "post", "put", "trace"] as const;
const PERMISSIONS = [
  "workspace-read",
  "workspace-write",
  "machine-execution",
  "network-access",
  "external-state",
  "credential-use",
] as const satisfies readonly CapabilityPermission[];
const APPROVALS = ["none", "conditional", "required"] as const satisfies readonly CapabilityApprovalPosture[];
const NETWORK_POSTURES = ["none", "restricted", "open"] as const satisfies readonly CapabilityNetworkPosture[];
const DATA_CLASSIFICATIONS = ["public", "internal", "sensitive"] as const;
const RETENTIONS = ["none", "ephemeral", "persistent"] as const;
const KINDS = ["portable-tool", "hosted-tool", "harness-native-tool", "agent-backed"] as const;
const OWNER_KINDS = ["kiln", "provider", "harness", "service", "agent"] as const;
const IMPLEMENTATION_KINDS = ["runtime-tool", "provider-tool", "harness-tool", "agent"] as const;
const EFFECT_KEYS = [
  "operation",
  "boundaries",
  "reversibility",
  "dataEgress",
  "identityUse",
  "consequences",
  "idempotency",
] as const;
const BINDING_KEYS = [
  "sourceId",
  "selector",
  "capabilityId",
  "bindingDigest",
  "kind",
  "ownerKind",
  "implementationKind",
  "ownerIdentityDigest",
  "sourceIdentityDigest",
  "implementationIdentityDigest",
  "contractRevision",
  "effect",
  "permissions",
  "approval",
  "network",
  "data",
  "supportedCallers",
  "limits",
] as const;
const UNAVAILABLE_OBSERVED_AT = "1970-01-01T00:00:00.000Z" as const;
const UNAVAILABLE_VALID_UNTIL = "1970-01-01T00:00:00.001Z" as const;

/** A settled operation declaration. It contains no client or execution hook. */
export interface OpenApiOperationSnapshot {
  readonly selector: string;
  readonly operationId: string;
  readonly method: string;
  readonly path: string;
  readonly requestSchema: Readonly<Record<string, unknown>>;
  readonly responseSchema?: Readonly<Record<string, unknown>>;
  readonly summary?: string;
  readonly description?: string;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

/** A complete, invalidation-aware snapshot settled by an OpenAPI reader. */
export interface OpenApiCapabilityDiscoverySnapshot {
  readonly sourceId: string;
  readonly specRevision: string;
  readonly documentDigest: Sha256Digest;
  readonly completeness: "complete" | "partial" | "degraded";
  readonly invalidated: boolean;
  readonly freshness: {
    readonly observedAt: string;
    readonly validUntil?: string;
    readonly status?: "current" | "stale" | "unknown";
  };
  readonly operations: readonly OpenApiOperationSnapshot[];
  readonly callbacks?: readonly unknown[];
  readonly webhooks?: readonly unknown[];
}

/** Explicit local policy/effect binding for one operation selector. */
export interface OpenApiCapabilityBinding {
  readonly sourceId: string;
  readonly selector: string;
  readonly capabilityId: string;
  readonly bindingDigest?: Sha256Digest;
  readonly kind: CapabilityKind;
  readonly ownerKind: CapabilityOwnerKind;
  readonly implementationKind: CapabilityImplementationKind;
  /** Explicit identities are supplied by the owning projection authority. */
  readonly ownerIdentityDigest: Sha256Digest;
  readonly sourceIdentityDigest: Sha256Digest;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly contractRevision?: string;
  readonly effect: ActionEffectEnvelope;
  readonly permissions: readonly CapabilityPermission[];
  readonly approval: CapabilityApprovalPosture;
  readonly network: CapabilityNetworkPosture;
  readonly data: CapabilityDataPosture;
  readonly supportedCallers: readonly CapabilityCallerId[];
  readonly limits: CapabilityLimits;
}

export interface OpenApiCapabilityDiscoveryInput {
  readonly evaluatedAt: string;
  readonly snapshot: OpenApiCapabilityDiscoverySnapshot;
  readonly bindings: readonly OpenApiCapabilityBinding[];
}

export type OpenApiCapabilityDiscoveryDiagnosticCode =
  | "snapshot_malformed"
  | "spec_revision_mismatch"
  | "snapshot_incomplete"
  | "snapshot_invalidated"
  | "snapshot_freshness_invalid"
  | "snapshot_stale"
  | "snapshot_document_digest_invalid"
  | "operation_malformed"
  | "unsupported_event_declaration"
  | "duplicate_operation_id"
  | "binding_malformed"
  | "binding_missing"
  | "binding_source_mismatch"
  | "binding_duplicate"
  | "binding_identity_invalid"
  | "effect_invalid"
  | "input_schema_invalid"
  | "output_schema_invalid"
  | "output_schema_missing"
  | "reference_rejected";

export interface OpenApiCapabilityDiscoveryDiagnostic {
  readonly code: OpenApiCapabilityDiscoveryDiagnosticCode;
  readonly selector?: string;
  readonly operationId?: string;
  readonly capabilityId?: string;
  readonly message: string;
  readonly severity: "warning" | "error";
}

export interface OpenApiCapabilityDiscoveryResult {
  readonly evaluatedAt: string;
  /** The exact settled patch revision, retained for audit/replay identity. */
  readonly specRevision: string;
  readonly candidates: readonly CapabilityDescriptorCandidate[];
  readonly diagnostics: readonly OpenApiCapabilityDiscoveryDiagnostic[];
  readonly catalog: CapabilityCatalogSnapshot;
}

interface ParsedSnapshot {
  readonly sourceId: string;
  readonly specRevision: string;
  readonly documentDigest?: Sha256Digest;
  readonly freshness?: ParsedFreshness;
  readonly operations: readonly ParsedOperation[];
  readonly rejectedOperations: readonly RejectedOperation[];
  readonly eventDeclarations: readonly EventDeclaration[];
  readonly globalIssues: readonly GlobalIssue[];
}

interface ParsedFreshness {
  readonly observedAt: string;
  readonly validUntil: string;
  readonly status?: "current" | "stale" | "unknown";
}

interface ParsedOperation {
  readonly selector: string;
  readonly operationId: string;
  readonly method: Method;
  readonly path: string;
  readonly requestSchema: Readonly<Record<string, unknown>>;
  readonly responseSchema?: Readonly<Record<string, unknown>>;
  readonly declarationDigest: Sha256Digest;
}

interface RejectedOperation {
  readonly selector?: string;
  readonly operationId?: string;
  readonly method?: string;
  readonly path?: string;
  readonly declarationDigest: Sha256Digest;
}

interface EventDeclaration {
  readonly kind: "callback" | "webhook";
}

type RejectionStub = Readonly<{
  readonly capabilityId?: string;
  readonly revision?: string;
}>;

type Method = (typeof METHODS)[number];

interface ParsedBinding {
  readonly sourceId: string;
  readonly selector: string;
  readonly capabilityId: string;
  readonly bindingDigest: Sha256Digest;
  readonly kind: CapabilityKind;
  readonly ownerKind: CapabilityOwnerKind;
  readonly implementationKind: CapabilityImplementationKind;
  readonly ownerIdentityDigest: Sha256Digest;
  readonly sourceIdentityDigest: Sha256Digest;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly contractRevision: string;
  readonly effect: ActionEffectEnvelope;
  readonly permissions: readonly CapabilityPermission[];
  readonly approval: CapabilityApprovalPosture;
  readonly network: CapabilityNetworkPosture;
  readonly data: CapabilityDataPosture;
  readonly supportedCallers: readonly CapabilityCallerId[];
  readonly limits: CapabilityLimits;
}

interface GlobalIssue {
  readonly code: OpenApiCapabilityDiscoveryDiagnosticCode;
  readonly message: string;
}

/**
 * Discover provider-neutral candidates from an inert, already-settled OpenAPI
 * 3.1 operation snapshot. This function never parses a document, resolves a
 * reference, calls an operation, or accepts an execution callback.
 */
export function discoverOpenApiCapabilities(
  input: OpenApiCapabilityDiscoveryInput,
): OpenApiCapabilityDiscoveryResult {
  const parsedInput = parseInput(input);
  const diagnostics: OpenApiCapabilityDiscoveryDiagnostic[] = [];
  const snapshot = parseSnapshot(parsedInput.snapshot, diagnostics, parsedInput.evaluatedAt);
  const bindings = parseBindings(parsedInput.bindings, diagnostics, snapshot.sourceId);
  const bindingsBySelector = groupBindings(bindings, diagnostics);
  const rejectionStubs: RejectionStub[] = [];

  for (const rejectedOperation of snapshot.rejectedOperations) {
    const bindingEntries = rejectedOperation.selector === undefined
      ? []
      : bindingsBySelector.get(rejectedOperation.selector) ?? [];
    const binding = bindingEntries.length === 1 ? bindingEntries[0] : undefined;
    appendRejectionStub(rejectionStubs, createRejectionStub(
      "operation_malformed",
      snapshot.sourceId,
      binding?.capabilityId,
      {
        selector: rejectedOperation.selector,
        operationId: rejectedOperation.operationId,
        method: rejectedOperation.method,
        path: rejectedOperation.path,
        declarationDigest: rejectedOperation.declarationDigest,
      },
    ));
  }

  for (const event of snapshot.eventDeclarations) {
    appendRejectionStub(rejectionStubs, Object.freeze({}));
    diagnostics.push(diagnostic(
      "unsupported_event_declaration",
      undefined,
      undefined,
      undefined,
      `OpenAPI ${event.kind} declarations are observed as unsupported events and are not executable capabilities.`,
    ));
  }

  const operationCounts = new Map<string, number>();
  for (const operation of snapshot.operations) {
    operationCounts.set(operation.operationId, (operationCounts.get(operation.operationId) ?? 0) + 1);
  }

  const candidates: CapabilityDescriptorCandidate[] = [];
  const globalUnavailable = snapshot.globalIssues.length > 0;
  for (const operation of snapshot.operations) {
    const bindingEntries = bindingsBySelector.get(operation.selector) ?? [];
    if (bindingEntries.length === 0) {
      diagnostics.push(diagnostic(
        "binding_missing",
        operation.selector,
        operation.operationId,
        undefined,
        "No exact local binding exists for this settled OpenAPI operation.",
      ));
      appendRejectionStub(rejectionStubs, Object.freeze({}));
      continue;
    }
    if (bindingEntries.length > 1) {
      appendRejectionStub(rejectionStubs, Object.freeze({}));
      continue;
    }
    if ((operationCounts.get(operation.operationId) ?? 0) > 1) {
      diagnostics.push(diagnostic(
        "duplicate_operation_id",
        operation.selector,
        operation.operationId,
        bindingEntries[0]?.capabilityId,
        "Multiple settled OpenAPI operations claim the same operationId.",
      ));
      const binding = bindingEntries[0]!;
      appendRejectionStub(rejectionStubs, createRejectionStub(
        "duplicate_operation_id",
        snapshot.sourceId,
        binding.capabilityId,
        {
          selector: operation.selector,
          operationId: operation.operationId,
          method: operation.method,
          path: operation.path,
          declarationDigest: operation.declarationDigest,
        },
      ));
      continue;
    }
    const binding = bindingEntries[0]!;
    const inspection = inspectOperation(operation, binding, diagnostics);
    candidates.push(deepFreeze(buildCandidate(snapshot, operation, binding, globalUnavailable || inspection.unavailable, inspection.outputSchemaDigest)));
  }

  candidates.sort(compareCandidates);
  const frozenCandidates = Object.freeze(candidates);
  const catalog = buildCapabilityCatalog(
    catalogEntries(frozenCandidates, rejectionStubs),
    parsedInput.evaluatedAt,
  );
  const sortedDiagnostics = diagnostics
    .map((entry) => deepFreeze(entry))
    .sort(compareDiagnostics);
  return Object.freeze({
    evaluatedAt: parsedInput.evaluatedAt,
    specRevision: snapshot.specRevision,
    candidates: frozenCandidates,
    diagnostics: Object.freeze(sortedDiagnostics),
    catalog,
  });
}

/** Returns only inert OpenAPI capability candidates. */
export function discoverOpenApiCapabilityCandidates(
  input: OpenApiCapabilityDiscoveryInput,
): readonly CapabilityDescriptorCandidate[] {
  return discoverOpenApiCapabilities(input).candidates;
}

/** Returns the Core-branded catalog generated by the OpenAPI adapter. */
export function discoverOpenApiCapabilityCatalog(
  input: OpenApiCapabilityDiscoveryInput,
): CapabilityCatalogSnapshot {
  return discoverOpenApiCapabilities(input).catalog;
}

function parseInput(input: OpenApiCapabilityDiscoveryInput): {
  readonly evaluatedAt: string;
  readonly snapshot: unknown;
  readonly bindings: unknown;
} {
  const record = requirePlainRecord(input, "OpenAPI capability discovery input");
  if (!hasExactKeys(record, ["evaluatedAt", "snapshot", "bindings"])) {
    throw new TypeError("OpenAPI capability discovery input must contain only evaluatedAt, snapshot, and bindings.");
  }
  const evaluatedAt = dataProperty(record, "evaluatedAt");
  const snapshot = dataProperty(record, "snapshot");
  const rawBindings = dataProperty(record, "bindings");
  if (!isCanonicalTimestamp(evaluatedAt)) {
    throw new TypeError("OpenAPI capability discovery evaluatedAt must be a canonical ISO timestamp.");
  }
  let bindings: unknown;
  try {
    bindings = cloneInert(rawBindings, "OpenAPI capability discovery bindings", {
      maxNodes: MAX_BINDINGS * 32,
      maxDepth: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth * 2,
      maxStringUnits: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits * 4,
    });
  } catch {
    bindings = undefined;
  }
  if (!Array.isArray(bindings) || bindings.length > MAX_BINDINGS) {
    throw new TypeError("OpenAPI capability discovery bindings must be a bounded array of inert data.");
  }
  return { evaluatedAt, snapshot, bindings };
}

function parseSnapshot(
  value: unknown,
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
  evaluatedAt: string,
): ParsedSnapshot {
  const source = asPlainRecord(value);
  const record = source === undefined ? Object.create(null) as Record<string, unknown> : cloneSnapshot(source);
  const sourceId = typeof record.sourceId === "string" && SOURCE_ID_PATTERN.test(record.sourceId)
    ? record.sourceId
    : "invalid-source";
  const specRevision = typeof record.specRevision === "string" ? record.specRevision : "";
  const globalIssues: GlobalIssue[] = [];
  if (sourceId === "invalid-source") {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_malformed", "The settled OpenAPI source identity is malformed.");
  }
  if (!OPENAPI_SPEC_REVISION_PATTERN.test(specRevision)) {
    addGlobalIssue(globalIssues, diagnostics, "spec_revision_mismatch", "Only canonical OpenAPI 3.1.* patch revisions on the 3.1 feature line are admitted.");
  }
  if (record.completeness !== "complete") {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_incomplete", "Only complete OpenAPI operation snapshots can provide discovery evidence.");
  }
  if (record.invalidated !== false) {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_invalidated", "The OpenAPI snapshot is missing an explicit non-invalidated state.");
  }
  const documentDigest = parseDigest(record.documentDigest);
  if (documentDigest === undefined) {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_document_digest_invalid", "The settled OpenAPI snapshot has no valid document digest.");
  }
  const freshness = parseFreshness(record.freshness);
  if (freshness === undefined) {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_freshness_invalid", "The OpenAPI snapshot freshness or TTL evidence is malformed.");
  } else if (freshness.status === "stale" || freshness.status === "unknown"
    || Date.parse(freshness.validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(freshness.observedAt) > Date.parse(evaluatedAt)) {
    const stale = freshness.status === "stale" || Date.parse(freshness.validUntil) <= Date.parse(evaluatedAt);
    addGlobalIssue(
      globalIssues,
      diagnostics,
      stale ? "snapshot_stale" : "snapshot_freshness_invalid",
      stale ? "The OpenAPI snapshot is stale at the evaluation instant." : "The OpenAPI snapshot freshness state is unknown or contradictory.",
    );
  }
  const rejectedOperations: RejectedOperation[] = [];
  const operations = parseOperations(record.operations, diagnostics, sourceId, rejectedOperations);
  const eventDeclarations = [
    ...parseEventDeclarations(record.callbacks, "callback"),
    ...parseEventDeclarations(record.webhooks, "webhook"),
  ];
  return {
    sourceId,
    specRevision,
    ...(documentDigest === undefined ? {} : { documentDigest }),
    ...(freshness === undefined ? {} : { freshness }),
    operations,
    rejectedOperations: Object.freeze(rejectedOperations),
    eventDeclarations: Object.freeze(eventDeclarations),
    globalIssues,
  };
}

/** Copy only fields owned by this adapter; ignored fields are never read. */
function cloneSnapshot(source: Record<string, unknown>): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  const fields = [
    "sourceId",
    "specRevision",
    "documentDigest",
    "completeness",
    "invalidated",
    "freshness",
    "operations",
    "callbacks",
    "webhooks",
  ] as const;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(source, field);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      if ((field === "callbacks" || field === "webhooks") && descriptor?.enumerable) {
        result[field] = INVALID_EVENT_COLLECTION;
      } else {
        result[field] = undefined;
      }
      continue;
    }
    try {
      result[field] = field === "operations"
        ? cloneOperations(descriptor.value)
        : field === "callbacks" || field === "webhooks"
          ? cloneEventDeclarations(descriptor.value, `OpenAPI snapshot ${field}`)
        : cloneInert(descriptor.value, `OpenAPI snapshot ${field}`, {
          maxNodes: 8_192,
          maxDepth: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth,
          maxStringUnits: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits,
        });
    } catch {
      result[field] = undefined;
    }
  }
  return result;
}

const INVALID_EVENT_COLLECTION = Object.freeze({});

function cloneEventDeclarations(value: unknown, label: string): unknown {
  if (isProxy(value) || !Array.isArray(value)) return INVALID_EVENT_COLLECTION;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor)
    || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)
    || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_EVENT_DECLARATIONS) {
    return INVALID_EVENT_COLLECTION;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
    return INVALID_EVENT_COLLECTION;
  }
  const result: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      result.push(undefined);
      continue;
    }
    try {
      result.push(cloneInert(descriptor.value, `${label} declaration`, {
        maxNodes: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxNodes,
        maxDepth: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth,
        maxStringUnits: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits,
      }));
    } catch {
      result.push(undefined);
    }
  }
  return result;
}

function parseEventDeclarations(
  value: unknown,
  kind: EventDeclaration["kind"],
): readonly EventDeclaration[] {
  if (value === undefined) return [];
  if (value === INVALID_EVENT_COLLECTION || !Array.isArray(value)) return [{ kind }];
  return Object.freeze(value.map(() => ({ kind })));
}

function cloneOperations(value: unknown): unknown {
  if (isProxy(value) || !Array.isArray(value)) return undefined;
  const arrayDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!arrayDescriptor || !("value" in arrayDescriptor) || typeof arrayDescriptor.value !== "number"
    || !Number.isSafeInteger(arrayDescriptor.value) || arrayDescriptor.value < 0
    || arrayDescriptor.value > MAX_SNAPSHOT_OPERATIONS) return undefined;
  const length = arrayDescriptor.value;
  const result: Record<string, unknown>[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
    const operation = asPlainRecord(descriptor.value);
    if (operation === undefined) {
      result.push(Object.create(null) as Record<string, unknown>);
      continue;
    }
    const copied = Object.create(null) as Record<string, unknown>;
    for (const field of ["selector", "operationId", "method", "path", "requestSchema", "responseSchema", "summary", "description", "extensions"] as const) {
      const fieldDescriptor = Object.getOwnPropertyDescriptor(operation, field);
      if (!fieldDescriptor || !fieldDescriptor.enumerable || !("value" in fieldDescriptor)) continue;
      try {
        copied[field] = field === "requestSchema" || field === "responseSchema" || field === "extensions"
          ? cloneInert(fieldDescriptor.value, `OpenAPI operation ${field}`, {
            maxNodes: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxNodes,
            maxDepth: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth,
            maxStringUnits: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits,
          })
          : cloneInert(fieldDescriptor.value, `OpenAPI operation ${field}`, {
            maxNodes: 64,
            maxDepth: 4,
            maxStringUnits: MAX_DESCRIPTION_LENGTH,
          });
      } catch {
        // Treat only the selected field as unavailable. Unknown/accessor
        // fields such as callbacks and execute are never read.
      }
    }
    result.push(copied);
  }
  return result;
}

function parseOperations(
  value: unknown,
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
  sourceId: string,
  rejectedOperations: RejectedOperation[],
): readonly ParsedOperation[] {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, undefined, "The OpenAPI operations collection is malformed or exceeds limits."));
    return [];
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number"
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
    || lengthDescriptor.value > MAX_SNAPSHOT_OPERATIONS) {
    diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, undefined, "The OpenAPI operations collection is malformed or exceeds limits."));
    return [];
  }
  const result: ParsedOperation[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entryDescriptor || !entryDescriptor.enumerable || !("value" in entryDescriptor)) {
      diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, undefined, "The OpenAPI operations collection is malformed or exceeds limits."));
      return result;
    }
    const entry = entryDescriptor.value;
    const record = asPlainRecord(entry);
    const selector = record === undefined ? undefined : dataProperty(record, "selector");
    const operationId = record === undefined ? undefined : dataProperty(record, "operationId");
    const rawMethod = record === undefined ? undefined : dataProperty(record, "method");
    const method = typeof rawMethod === "string" ? rawMethod.toLowerCase() : "";
    const path = record === undefined ? undefined : dataProperty(record, "path");
    const requestSchema = record === undefined ? undefined : dataProperty(record, "requestSchema");
    const responseSchema = record === undefined ? undefined : dataProperty(record, "responseSchema");
    if (typeof selector !== "string" || typeof operationId !== "string" || !OPERATION_ID_PATTERN.test(operationId)
      || !isMember(method, METHODS) || typeof path !== "string" || !PATH_PATTERN.test(path)
      || selector !== canonicalSelector(sourceId, method, path) || !isRecord(requestSchema)) {
      diagnostics.push(diagnostic(
        "operation_malformed",
        typeof selector === "string" ? selector : undefined,
        typeof operationId === "string" ? operationId : undefined,
        undefined,
        "A settled OpenAPI operation declaration is malformed or is not exactly qualified for its source.",
      ));
      rejectedOperations.push({
        ...(typeof selector === "string" ? { selector } : {}),
        ...(typeof operationId === "string" ? { operationId } : {}),
        ...(method.length === 0 ? {} : { method }),
        ...(typeof path === "string" ? { path } : {}),
        declarationDigest: deriveOperationDeclarationDigest(record),
      });
      continue;
    }
    if (responseSchema !== undefined && !isRecord(responseSchema)) {
      diagnostics.push(diagnostic("operation_malformed", selector, operationId, undefined, "An OpenAPI response schema must be an inert object."));
      rejectedOperations.push({
        selector,
        operationId,
        method,
        path,
        declarationDigest: deriveOperationDeclarationDigest(record),
      });
      continue;
    }
    result.push({
      selector,
      operationId,
      method,
      path,
      requestSchema,
      ...(responseSchema === undefined ? {} : { responseSchema }),
      declarationDigest: sha256(stableStringify({
        selector,
        operationId,
        method,
        path,
        requestSchema,
        ...(responseSchema === undefined ? { responseSchema: { present: false } } : { responseSchema }),
      })),
    });
  }
  return Object.freeze(result);
}

function deriveOperationDeclarationDigest(record: Record<string, unknown> | undefined): Sha256Digest {
  try {
    return sha256(stableStringify({
      selector: record === undefined ? undefined : dataProperty(record, "selector"),
      operationId: record === undefined ? undefined : dataProperty(record, "operationId"),
      method: record === undefined ? undefined : dataProperty(record, "method"),
      path: record === undefined ? undefined : dataProperty(record, "path"),
      requestSchema: record === undefined ? undefined : dataProperty(record, "requestSchema"),
      responseSchema: record === undefined ? undefined : dataProperty(record, "responseSchema"),
    }));
  } catch {
    return sha256(`${OPENAPI_CAPABILITY_DISCOVERY_REVISION}/operation/malformed`);
  }
}

function parseBindings(
  value: unknown,
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
  sourceId: string,
): readonly ParsedBinding[] {
  if (!Array.isArray(value) || value.length > MAX_BINDINGS) {
    throw new TypeError("OpenAPI capability bindings must be a bounded array.");
  }
  const result: ParsedBinding[] = [];
  for (const entry of value) {
    const parsed = parseBinding(entry, diagnostics, sourceId);
    if (parsed) result.push(parsed);
  }
  return Object.freeze(result);
}

function parseBinding(
  value: unknown,
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
  sourceId: string,
): ParsedBinding | undefined {
  const record = asPlainRecord(value);
  if (record === undefined) {
    diagnostics.push(diagnostic("binding_malformed", undefined, undefined, undefined, "An OpenAPI capability binding is not inert plain data."));
    return undefined;
  }
  const bindingSourceId = record.sourceId;
  const selector = record.selector;
  const capabilityId = record.capabilityId;
  if (bindingSourceId !== sourceId) {
    diagnostics.push(diagnostic("binding_source_mismatch", typeof selector === "string" ? selector : undefined, undefined, typeof capabilityId === "string" ? capabilityId : undefined, "An OpenAPI capability binding is scoped to another source."));
    return undefined;
  }
  if (typeof selector !== "string" || !isCanonicalSelector(selector, sourceId) || typeof capabilityId !== "string"
    || !CAPABILITY_ID_PATTERN.test(capabilityId) || !hasAllowedKeys(record, BINDING_KEYS)) {
    diagnostics.push(diagnostic("binding_identity_invalid", typeof selector === "string" ? selector : undefined, undefined, typeof capabilityId === "string" ? capabilityId : undefined, "An OpenAPI capability binding has an invalid selector or capability identity."));
    return undefined;
  }
  const kind = parseMember(record.kind, KINDS);
  const ownerKind = parseMember(record.ownerKind, OWNER_KINDS);
  const implementationKind = parseMember(record.implementationKind, IMPLEMENTATION_KINDS);
  if (!kind || !ownerKind || !implementationKind) {
    diagnostics.push(diagnostic("binding_identity_invalid", selector, undefined, capabilityId, "An OpenAPI capability binding has an invalid posture kind."));
    return undefined;
  }
  const effectRecord = asPlainRecord(record.effect);
  const effect = normalizeActionEffectEnvelope(record.effect);
  if (!effect || !hasExactKeys(effectRecord, EFFECT_KEYS)) {
    diagnostics.push(diagnostic("effect_invalid", selector, undefined, capabilityId, "The OpenAPI local binding does not declare a complete canonical action effect."));
    return undefined;
  }
  const permissions = parseMembers(record.permissions, PERMISSIONS);
  const supportedCallers = parseExactSupportedCallers(record.supportedCallers);
  const approval = parseMember(record.approval, APPROVALS);
  const network = parseMember(record.network, NETWORK_POSTURES);
  const data = parseData(record.data);
  const limits = parseLimits(record.limits);
  if (!permissions || !supportedCallers || !approval || !network || !data || !limits) {
    diagnostics.push(diagnostic("binding_malformed", selector, undefined, capabilityId, "The OpenAPI local binding has an incomplete or invalid posture."));
    return undefined;
  }
  const bindingDigestValue = parseOptionalDigest(record.bindingDigest);
  const ownerIdentityDigest = parseDigest(record.ownerIdentityDigest);
  const sourceIdentityDigest = parseDigest(record.sourceIdentityDigest);
  const implementationIdentityDigest = parseDigest(record.implementationIdentityDigest);
  if (bindingDigestValue.invalid || !ownerIdentityDigest || !sourceIdentityDigest || !implementationIdentityDigest) {
    diagnostics.push(diagnostic("binding_identity_invalid", selector, undefined, capabilityId, "The OpenAPI local binding contains a malformed identity digest."));
    return undefined;
  }
  const derivedDigest = sha256(stableStringify({
    sourceId,
    selector,
    capabilityId,
    kind,
    ownerKind,
    implementationKind,
    effect,
    permissions,
    approval,
    network,
    data,
    supportedCallers,
    limits,
  }));
  const resolvedBindingDigest = bindingDigestValue.value ?? derivedDigest;
  const contractRevision = typeof record.contractRevision === "string" && record.contractRevision.length > 0
    ? record.contractRevision
    : OPENAPI_CAPABILITY_DISCOVERY_REVISION;
  if (contractRevision.length > 127 || /[\u0000-\u001f\u007f]/u.test(contractRevision)) {
    diagnostics.push(diagnostic("binding_malformed", selector, undefined, capabilityId, "The OpenAPI contract revision is malformed."));
    return undefined;
  }
  return {
    sourceId,
    selector,
    capabilityId,
    bindingDigest: resolvedBindingDigest,
    kind,
    ownerKind,
    implementationKind,
    ownerIdentityDigest,
    sourceIdentityDigest,
    implementationIdentityDigest,
    contractRevision,
    effect,
    permissions,
    approval,
    network,
    data,
    supportedCallers,
    limits,
  };
}

function groupBindings(
  bindings: readonly ParsedBinding[],
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
): ReadonlyMap<string, readonly ParsedBinding[]> {
  const groups = new Map<string, ParsedBinding[]>();
  for (const binding of bindings) {
    const entries = groups.get(binding.selector) ?? [];
    entries.push(binding);
    groups.set(binding.selector, entries);
  }
  for (const [selector, entries] of groups) {
    if (entries.length > 1) {
      for (const entry of entries) {
        diagnostics.push(diagnostic("binding_duplicate", selector, undefined, entry.capabilityId, "Multiple local bindings claim the same exact OpenAPI operation selector."));
      }
    }
  }
  return groups;
}

interface OperationInspection {
  readonly unavailable: boolean;
  readonly outputSchemaDigest: Sha256Digest;
}

function inspectOperation(
  operation: ParsedOperation,
  binding: ParsedBinding,
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
): OperationInspection {
  let unavailable = false;
  const inputSchema = validateSchema(operation.requestSchema);
  if (!inputSchema.ok) {
    unavailable = true;
    if (inputSchema.reason === "reference") {
      diagnostics.push(diagnostic("reference_rejected", operation.selector, operation.operationId, binding.capabilityId, "OpenAPI schema references are not resolved at this boundary and are not admitted, including internal references."));
    } else {
      diagnostics.push(schemaDiagnostic("input_schema_invalid", operation, binding, inputSchema.reason));
    }
  }
  const outputSchema = operation.responseSchema === undefined ? undefined : validateSchema(operation.responseSchema);
  if (outputSchema && !outputSchema.ok) {
    unavailable = true;
    if (outputSchema.reason === "reference") {
      diagnostics.push(diagnostic("reference_rejected", operation.selector, operation.operationId, binding.capabilityId, "OpenAPI schema references are not resolved at this boundary and are not admitted, including internal references."));
    } else {
      diagnostics.push(schemaDiagnostic("output_schema_invalid", operation, binding, outputSchema.reason));
    }
  }
  if (operation.responseSchema === undefined) {
    unavailable = true;
    diagnostics.push(diagnostic("output_schema_missing", operation.selector, operation.operationId, binding.capabilityId, "The settled OpenAPI operation has no response schema evidence."));
  }
  return {
    unavailable,
    outputSchemaDigest: outputSchema?.ok && outputSchema.value !== undefined
      ? sha256(stableStringify(outputSchema.value))
      : OPENAPI_OUTPUT_SCHEMA_ABSENT_DIGEST,
  };
}

function buildCandidate(
  snapshot: ParsedSnapshot,
  operation: ParsedOperation,
  binding: ParsedBinding,
  unavailable: boolean,
  outputSchemaDigest: Sha256Digest,
): CapabilityDescriptorCandidate {
  const inputSchemaDigest = sha256(stableStringify(operation.requestSchema));
  const revision = sha256(stableStringify({
    adapterRevision: OPENAPI_CAPABILITY_DISCOVERY_REVISION,
    specRevision: snapshot.specRevision,
    sourceId: snapshot.sourceId,
    documentDigest: snapshot.documentDigest ?? "missing",
    selector: operation.selector,
    operationId: operation.operationId,
    declarationDigest: operation.declarationDigest,
    binding: {
      bindingDigest: binding.bindingDigest,
      capabilityId: binding.capabilityId,
      kind: binding.kind,
      ownerKind: binding.ownerKind,
      implementationKind: binding.implementationKind,
      ownerIdentityDigest: binding.ownerIdentityDigest,
      sourceIdentityDigest: binding.sourceIdentityDigest,
      implementationIdentityDigest: binding.implementationIdentityDigest,
      contractRevision: binding.contractRevision,
      effect: binding.effect,
      permissions: binding.permissions,
      approval: binding.approval,
      network: binding.network,
      data: binding.data,
      supportedCallers: binding.supportedCallers,
      limits: binding.limits,
    },
    inputSchemaDigest,
    outputSchemaDigest,
  }));
  return {
    capabilityId: binding.capabilityId,
    revision,
    kind: binding.kind,
    owner: { kind: binding.ownerKind, identityDigest: binding.ownerIdentityDigest },
    inputSchemaDigest,
    outputSchemaDigest,
    artifacts: outputSchemaDigest === OPENAPI_OUTPUT_SCHEMA_ABSENT_DIGEST
      ? []
      : [{ mediaType: "application/json", schemaDigest: outputSchemaDigest }],
    effect: cloneEffect(binding.effect),
    permissions: [...binding.permissions],
    approval: binding.approval,
    network: binding.network,
    data: { ...binding.data },
    supportedCallers: [...binding.supportedCallers],
    freshness: {
      observedAt: snapshot.freshness?.observedAt ?? UNAVAILABLE_OBSERVED_AT,
      validUntil: snapshot.freshness?.validUntil ?? UNAVAILABLE_VALID_UNTIL,
      status: unavailable ? "unavailable" : "available",
    },
    provenance: {
      sourceType: "protocol" satisfies CapabilityProvenanceSource,
      sourceIdentityDigest: binding.sourceIdentityDigest,
      sourceDigest: sha256(stableStringify({
        specRevision: snapshot.specRevision,
        sourceId: snapshot.sourceId,
        documentDigest: snapshot.documentDigest ?? "missing",
        declarationDigest: operation.declarationDigest,
      })),
    },
    limits: { ...binding.limits },
    implementationReferences: [{
      identityDigest: binding.implementationIdentityDigest,
      kind: binding.implementationKind,
      inputSchemaDigest,
      outputSchemaDigest,
    }],
  };
}

function validateSchema(value: unknown): JsonSchemaSafetyResult {
  return validateJsonSchemaSafety(value, {
    referencePolicy: "none",
  });
}

function schemaDiagnostic(
  code: "input_schema_invalid" | "output_schema_invalid",
  operation: ParsedOperation,
  binding: ParsedBinding,
  reason: JsonSchemaSafetyReason | undefined,
): OpenApiCapabilityDiscoveryDiagnostic {
  const suffix = reason === undefined ? "" : ` (${reason})`;
  return diagnostic(code, operation.selector, operation.operationId, binding.capabilityId, `The OpenAPI ${code.startsWith("input") ? "request" : "response"} schema is not admitted${suffix}.`);
}

function parseFreshness(value: unknown): ParsedFreshness | undefined {
  const record = asPlainRecord(value);
  if (record === undefined || !isCanonicalTimestamp(record.observedAt) || !isCanonicalTimestamp(record.validUntil)) return undefined;
  const observedAt = Date.parse(record.observedAt);
  const validUntil = Date.parse(record.validUntil);
  if (observedAt >= validUntil || validUntil - observedAt > MAX_FRESHNESS_WINDOW_MS) return undefined;
  if (record.status !== undefined && record.status !== "current" && record.status !== "stale" && record.status !== "unknown") return undefined;
  return {
    observedAt: record.observedAt,
    validUntil: record.validUntil,
    ...(record.status === undefined ? {} : { status: record.status }),
  };
}

function parseData(value: unknown): CapabilityDataPosture | undefined {
  const record = asPlainRecord(value);
  if (!record || !hasExactKeys(record, ["input", "output", "retention"])) return undefined;
  if (!isMember(record.input, DATA_CLASSIFICATIONS) || !isMember(record.output, DATA_CLASSIFICATIONS)
    || !isMember(record.retention, RETENTIONS)) return undefined;
  return { input: record.input, output: record.output, retention: record.retention };
}

function parseLimits(value: unknown): CapabilityLimits | undefined {
  const record = asPlainRecord(value);
  if (!record || !hasExactKeys(record, ["maxInputBytes", "maxOutputBytes", "maxDurationMs", "maxArtifacts"])) return undefined;
  if (!boundedInteger(record.maxInputBytes, 1, 16 * 1024 * 1024)
    || !boundedInteger(record.maxOutputBytes, 1, 64 * 1024 * 1024)
    || !boundedInteger(record.maxDurationMs, 1, 24 * 60 * 60 * 1_000)
    || !boundedInteger(record.maxArtifacts, 0, 256)) return undefined;
  return {
    maxInputBytes: record.maxInputBytes,
    maxOutputBytes: record.maxOutputBytes,
    maxDurationMs: record.maxDurationMs,
    maxArtifacts: record.maxArtifacts,
  };
}

function parseMembers<const T extends readonly string[]>(value: unknown, members: T): readonly T[number][] | undefined {
  if (!Array.isArray(value) || value.length > members.length || new Set(value).size !== value.length) return undefined;
  if (!value.every((entry) => isMember(entry, members))) return undefined;
  return members.filter((member) => value.includes(member)) as readonly T[number][];
}

function parseExactSupportedCallers(value: unknown): readonly ["kiln-runtime"] | undefined {
  return Array.isArray(value) && value.length === 1 && value[0] === "kiln-runtime"
    ? ["kiln-runtime"]
    : undefined;
}

function parseMember<const T extends readonly string[]>(value: unknown, members: T): T[number] | undefined {
  return isMember(value, members) ? value : undefined;
}

function isMember<const T extends readonly string[]>(value: unknown, members: T): value is T[number] {
  return typeof value === "string" && members.includes(value);
}

function parseOptionalDigest(value: unknown): { readonly value?: Sha256Digest; readonly invalid: boolean } {
  if (value === undefined) return { invalid: false };
  const digest = parseDigest(value);
  return digest === undefined ? { invalid: true } : { value: digest, invalid: false };
}

function parseDigest(value: unknown): Sha256Digest | undefined {
  return typeof value === "string" && DIGEST_PATTERN.test(value) ? value as Sha256Digest : undefined;
}

function cloneEffect(effect: ActionEffectEnvelope): ActionEffectEnvelope {
  const normalized = normalizeActionEffectEnvelope(effect);
  if (!normalized) throw new TypeError("OpenAPI local effect unexpectedly became malformed.");
  return {
    ...normalized,
    boundaries: [...normalized.boundaries],
    consequences: [...normalized.consequences],
  };
}

function addGlobalIssue(
  issues: GlobalIssue[],
  diagnostics: OpenApiCapabilityDiscoveryDiagnostic[],
  code: OpenApiCapabilityDiscoveryDiagnosticCode,
  message: string,
): void {
  issues.push({ code, message });
  diagnostics.push(diagnostic(code, undefined, undefined, undefined, message));
}

function diagnostic(
  code: OpenApiCapabilityDiscoveryDiagnosticCode,
  selector: string | undefined,
  operationId: string | undefined,
  capabilityId: string | undefined,
  message: string,
  severity: "warning" | "error" = "error",
): OpenApiCapabilityDiscoveryDiagnostic {
  return {
    code,
    ...(selector === undefined ? {} : { selector }),
    ...(operationId === undefined ? {} : { operationId }),
    ...(capabilityId === undefined ? {} : { capabilityId }),
    message,
    severity,
  };
}

function compareDiagnostics(
  left: OpenApiCapabilityDiscoveryDiagnostic,
  right: OpenApiCapabilityDiscoveryDiagnostic,
): number {
  return compareCodeUnits(left.selector ?? "", right.selector ?? "")
    || compareCodeUnits(left.operationId ?? "", right.operationId ?? "")
    || compareCodeUnits(left.capabilityId ?? "", right.capabilityId ?? "")
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.message, right.message);
}

function compareCandidates(left: CapabilityDescriptorCandidate, right: CapabilityDescriptorCandidate): number {
  return compareCodeUnits(left.capabilityId, right.capabilityId) || compareCodeUnits(left.revision, right.revision);
}

function createRejectionStub(
  code: OpenApiCapabilityDiscoveryDiagnosticCode,
  sourceId: string,
  capabilityId: string | undefined,
  material: Record<string, unknown>,
): RejectionStub {
  if (!SOURCE_ID_PATTERN.test(sourceId) || sourceId === "invalid-source" || !isSafeCapabilityId(capabilityId)) {
    return Object.freeze({});
  }
  return Object.freeze({
    capabilityId,
    revision: sha256(stableStringify({
      adapterRevision: OPENAPI_CAPABILITY_DISCOVERY_REVISION,
      sourceId,
      rejectionCode: code,
      ...material,
    })),
  });
}

function appendRejectionStub(stubs: RejectionStub[], stub: RejectionStub): void {
  if (stubs.length < MAX_CATALOG_ENTRIES) stubs.push(stub);
}

function catalogEntries(
  candidates: readonly CapabilityDescriptorCandidate[],
  rejectionStubs: readonly RejectionStub[],
): readonly unknown[] {
  const remaining = Math.max(0, MAX_CATALOG_ENTRIES - candidates.length);
  const sortedStubs = [...rejectionStubs]
    .sort(compareRejectionStubs)
    .slice(0, remaining);
  return Object.freeze([...candidates, ...sortedStubs]);
}

function compareRejectionStubs(left: RejectionStub, right: RejectionStub): number {
  return compareCodeUnits(left.capabilityId ?? "", right.capabilityId ?? "")
    || compareCodeUnits(left.revision ?? "", right.revision ?? "");
}

function canonicalSelector(sourceId: string, method: string, path: string): string {
  return `openapi:${sourceId}:${method}:${path}`;
}

function isCanonicalSelector(selector: string, sourceId: string): boolean {
  const prefix = `openapi:${sourceId}:`;
  if (!selector.startsWith(prefix)) return false;
  const remainder = selector.slice(prefix.length);
  const separator = remainder.indexOf(":");
  if (separator <= 0) return false;
  const method = remainder.slice(0, separator);
  const path = remainder.slice(separator + 1);
  return isMember(method, METHODS) && PATH_PATTERN.test(path) && selector === canonicalSelector(sourceId, method, path);
}

function isSafeCapabilityId(value: string | undefined): value is string {
  return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value) && value.length <= 127;
}

function hasExactKeys(record: Record<string, unknown> | undefined, keys: readonly string[]): boolean {
  if (record === undefined) return false;
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasAllowedKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asPlainRecord(value);
  if (!record) throw new TypeError(`${label} must be an inert plain-data object.`);
  return record;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return isPlainRecord(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

interface CloneBudget {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxStringUnits: number;
}

function cloneInert(value: unknown, label: string, budget: CloneBudget): unknown {
  const seen = new WeakSet<object>();
  let nodes = 0;
  let stringUnits = 0;
  const visit = (current: unknown, depth: number): unknown => {
    if (++nodes > budget.maxNodes || depth > budget.maxDepth) throw new TypeError(`${label} exceeds bounded inspection limits.`);
    if (typeof current === "string") {
      stringUnits += current.length;
      if (stringUnits > budget.maxStringUnits) throw new TypeError(`${label} exceeds bounded string limits.`);
      return current;
    }
    if (current === null || typeof current === "boolean" || current === undefined) return current;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError(`${label} contains a non-finite number.`);
      return current;
    }
    if (typeof current !== "object") throw new TypeError(`${label} contains an executable or symbolic value.`);
    if (isProxy(current)) throw new TypeError(`${label} contains a proxy object.`);
    if (seen.has(current)) throw new TypeError(`${label} contains a cyclic object graph.`);
    seen.add(current);
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) throw new TypeError(`${label} contains an exotic array.`);
      const descriptors = Object.getOwnPropertyDescriptors(current) as Record<string, PropertyDescriptor>;
      const lengthDescriptor = Object.getOwnPropertyDescriptor(current, "length");
      const arrayLength = lengthDescriptor?.value;
      if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof arrayLength !== "number"
        || !Number.isSafeInteger(arrayLength) || arrayLength < 0 || arrayLength > budget.maxNodes) {
        throw new TypeError(`${label} contains an invalid array.`);
      }
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
        throw new TypeError(`${label} contains array metadata.`);
      }
      const result: unknown[] = [];
      for (let index = 0; index < arrayLength; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label} contains an accessor or array hole.`);
        result.push(visit(descriptor.value, depth + 1));
      }
      if (keys.length !== arrayLength + 1) throw new TypeError(`${label} contains array metadata.`);
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} contains an exotic object.`);
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 128 || keys.some((key) => typeof key !== "string")) throw new TypeError(`${label} contains invalid object keys.`);
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (!descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label} contains an accessor or non-enumerable field.`);
      Object.defineProperty(result, key, {
        value: visit(descriptor.value, depth + 1),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };
  return visit(value, 0);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function sha256(value: string): Sha256Digest {
  return sha256ContentIdentity(value) as Sha256Digest;
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
