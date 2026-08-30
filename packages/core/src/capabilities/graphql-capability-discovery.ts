import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { normalizeActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import { isProxy } from "node:util/types";
import {
  buildAggregateCapabilityCatalog,
  createCapabilityCatalogContribution,
  type CapabilityApprovalPosture,
  type CapabilityCatalogSnapshot,
  type CapabilityCatalogContribution,
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
  CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST,
  CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST,
  DEFAULT_JSON_SCHEMA_SAFETY_LIMITS,
  normalizeAndDigestCapabilityJsonSchema,
  type CapabilityJsonSchemaDigestResult,
} from "./capability-json-schema-safety.js";

/** The only GraphQL specification revision admitted by this adapter. */
export const GRAPHQL_SPEC_REVISION = "September2025" as const;

/** Adapter contract revision. It participates in every candidate identity. */
export const GRAPHQL_CAPABILITY_DISCOVERY_REVISION = "graphql-capability-discovery/v1" as const;

/** Digests retained when a settled operation omits a required schema. */
export const GRAPHQL_INPUT_SCHEMA_ABSENT_DIGEST = CAPABILITY_INPUT_SCHEMA_ABSENT_DIGEST as Sha256Digest;
export const GRAPHQL_OUTPUT_SCHEMA_ABSENT_DIGEST = CAPABILITY_OUTPUT_SCHEMA_ABSENT_DIGEST as Sha256Digest;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const GRAPHQL_NAME_PATTERN = /^[_A-Za-z][_0-9A-Za-z]{0,126}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const ROOT_KINDS = ["query", "mutation", "subscription"] as const;
const PERMISSIONS = [
  "workspace-read",
  "workspace-write",
  "machine-execution",
  "network-access",
  "external-state",
  "credential-use",
] as const satisfies readonly CapabilityPermission[];
const KINDS = ["portable-tool", "hosted-tool", "harness-native-tool", "agent-backed"] as const;
const OWNER_KINDS = ["kiln", "provider", "harness", "service", "agent"] as const;
const IMPLEMENTATION_KINDS = ["runtime-tool", "provider-tool", "harness-tool", "agent"] as const;
const APPROVALS = ["none", "conditional", "required"] as const;
const NETWORK_POSTURES = ["none", "restricted", "open"] as const;
const DATA_CLASSIFICATIONS = ["public", "internal", "sensitive"] as const;
const RETENTIONS = ["none", "ephemeral", "persistent"] as const;
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
const DEPRECATION_KEYS = ["isDeprecated", "reason"] as const;
const SCALAR_KEYS = ["name", "resolved", "schemaDigest"] as const;
const UNAVAILABLE_OBSERVED_AT = "1970-01-01T00:00:00.000Z" as const;
const UNAVAILABLE_VALID_UNTIL = "1970-01-01T00:00:00.001Z" as const;
const MAX_OPERATIONS = 10_000;
const MAX_BINDINGS = 10_000;
const MAX_CATALOG_ENTRIES = 10_000;
const MAX_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_DEPRECATION_REASON_LENGTH = 16_384;
const MAX_CUSTOM_SCALARS = 256;

export type GraphqlRootOperationKind = (typeof ROOT_KINDS)[number];

/** Settled deprecation evidence for one root field. */
export interface GraphqlDeprecationEvidence {
  readonly isDeprecated: boolean;
  readonly reason?: string;
}

/** Settled resolution evidence for a custom scalar used by an operation. */
export type GraphqlCustomScalarResolution =
  | {
    readonly name: string;
    readonly resolved: true;
    readonly schemaDigest: Sha256Digest;
  }
  | {
    readonly name: string;
    readonly resolved: false;
    readonly schemaDigest?: Sha256Digest;
  };

/**
 * Canonical settled inputs for deriving one GraphQL operation evidence
 * digest. Schema absence is represented by the exported input/output absence
 * digests; every other field is part of the evidence preimage.
 */
export interface GraphqlOperationEvidenceDigestInput {
  readonly specRevision: string;
  readonly sourceId: string;
  readonly schemaDigest: Sha256Digest;
  readonly operationDocumentDigest: Sha256Digest;
  readonly rootKind: GraphqlRootOperationKind;
  readonly rootType: string;
  readonly fieldName: string;
  readonly coordinate: string;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly deprecation: GraphqlDeprecationEvidence | boolean;
  readonly customScalars: readonly GraphqlCustomScalarResolution[];
}

/**
 * Derives the stable, provider-neutral digest for one settled GraphQL
 * operation. The adapter revision is fixed by this module and is always part
 * of the preimage; descriptions and directives are intentionally excluded.
 */
export function deriveGraphqlOperationEvidenceDigest(
  input: GraphqlOperationEvidenceDigestInput,
): Sha256Digest {
  return deriveOperationEvidenceDigest({
    specRevision: input.specRevision,
    sourceId: input.sourceId,
    schemaDigest: input.schemaDigest,
    operationDocumentDigest: input.operationDocumentDigest,
    rootKind: input.rootKind,
    rootType: input.rootType,
    fieldName: input.fieldName,
    coordinate: input.coordinate,
    inputSchemaDigest: input.inputSchemaDigest,
    outputSchemaDigest: input.outputSchemaDigest,
    deprecation: normalizeDeprecationForEvidence(input.deprecation),
    customScalars: normalizeCustomScalarsForEvidence(input.customScalars),
  });
}

/** A root operation declaration already settled by a GraphQL introspection reader. */
export interface GraphqlRootOperationSnapshot {
  readonly selector: string;
  readonly rootKind: GraphqlRootOperationKind;
  readonly rootType: string;
  readonly fieldName: string;
  readonly coordinate: string;
  readonly operationDocumentDigest: Sha256Digest;
  readonly operationEvidenceDigest: Sha256Digest;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly deprecation?: GraphqlDeprecationEvidence | boolean;
  readonly customScalars?: readonly GraphqlCustomScalarResolution[];
  readonly description?: string;
  readonly directives?: readonly unknown[];
}

/** A complete, invalidation-aware GraphQL snapshot settled outside this adapter. */
export interface GraphqlCapabilityDiscoverySnapshot {
  readonly sourceId: string;
  readonly specRevision: string;
  readonly schemaDigest: Sha256Digest;
  readonly completeness: "complete" | "partial" | "degraded";
  readonly invalidated: boolean;
  readonly freshness: {
    readonly observedAt: string;
    readonly validUntil?: string;
    readonly status?: "current" | "stale" | "unknown";
  };
  readonly operations: readonly GraphqlRootOperationSnapshot[];
}

/** Explicit local policy/effect binding for one GraphQL root-field selector. */
export interface GraphqlCapabilityBinding {
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

export interface GraphqlCapabilityDiscoveryInput {
  readonly evaluatedAt: string;
  readonly snapshot: GraphqlCapabilityDiscoverySnapshot;
  readonly bindings: readonly GraphqlCapabilityBinding[];
}

export type GraphqlCapabilityDiscoveryDiagnosticCode =
  | "snapshot_malformed"
  | "spec_revision_mismatch"
  | "snapshot_incomplete"
  | "snapshot_invalidated"
  | "snapshot_freshness_invalid"
  | "snapshot_stale"
  | "snapshot_schema_digest_invalid"
  | "operation_malformed"
  | "coordinate_mismatch"
  | "duplicate_coordinate"
  | "duplicate_selector"
  | "operation_document_digest_invalid"
  | "operation_evidence_digest_invalid"
  | "binding_malformed"
  | "binding_missing"
  | "binding_source_mismatch"
  | "binding_duplicate"
  | "binding_identity_invalid"
  | "effect_invalid"
  | "input_schema_missing"
  | "output_schema_missing"
  | "input_schema_invalid"
  | "output_schema_invalid"
  | "schema_reference_rejected"
  | "introspection_field_rejected"
  | "deprecation_evidence_missing"
  | "deprecation_evidence_invalid"
  | "deprecated_field"
  | "custom_scalar_evidence_missing"
  | "custom_scalar_evidence_invalid"
  | "custom_scalar_unresolved";

export interface GraphqlCapabilityDiscoveryDiagnostic {
  readonly code: GraphqlCapabilityDiscoveryDiagnosticCode;
  readonly selector?: string;
  readonly coordinate?: string;
  readonly capabilityId?: string;
  readonly message: string;
  readonly severity: "warning" | "error";
}

export interface GraphqlCapabilityDiscoveryResult {
  readonly evaluatedAt: string;
  readonly specRevision: string;
  readonly candidates: readonly CapabilityDescriptorCandidate[];
  readonly diagnostics: readonly GraphqlCapabilityDiscoveryDiagnostic[];
  readonly contribution: CapabilityCatalogContribution;
  readonly catalog: CapabilityCatalogSnapshot;
}

interface ParsedFreshness {
  readonly observedAt: string;
  readonly validUntil: string;
  readonly status?: "current" | "stale" | "unknown";
}

interface ParsedDeprecation {
  readonly present: boolean;
  readonly invalid: boolean;
  readonly isDeprecated?: boolean;
  readonly reason?: string;
}

type ParsedScalar = GraphqlCustomScalarResolution;

interface ParsedOperation {
  readonly selector: string;
  readonly rootKind: GraphqlRootOperationKind;
  readonly rootType: string;
  readonly fieldName: string;
  readonly coordinate: string;
  readonly operationDocumentDigest?: Sha256Digest;
  readonly operationDocumentDigestInvalid: boolean;
  readonly operationEvidenceDigest?: Sha256Digest;
  readonly operationEvidenceDigestInvalid: boolean;
  readonly inputSchema?: Readonly<Record<string, unknown>>;
  readonly inputSchemaPresent: boolean;
  readonly inputSchemaInvalid: boolean;
  readonly outputSchema?: Readonly<Record<string, unknown>>;
  readonly outputSchemaPresent: boolean;
  readonly outputSchemaInvalid: boolean;
  readonly deprecation: ParsedDeprecation;
  readonly customScalars: {
    readonly present: boolean;
    readonly invalid: boolean;
    readonly values?: readonly ParsedScalar[];
  };
  readonly declarationDigest: Sha256Digest;
}

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
  readonly code: GraphqlCapabilityDiscoveryDiagnosticCode;
  readonly message: string;
}

interface ParsedSnapshot {
  readonly sourceId: string;
  readonly specRevision: string;
  readonly schemaDigest?: Sha256Digest;
  readonly freshness?: ParsedFreshness;
  readonly operations: readonly ParsedOperation[];
  readonly rejectedOperations: readonly RejectedOperation[];
  readonly globalIssues: readonly GlobalIssue[];
}

interface RejectedOperation {
  readonly code: Extract<GraphqlCapabilityDiscoveryDiagnosticCode, "operation_malformed" | "coordinate_mismatch">;
  readonly selector?: string;
  readonly coordinate?: string;
  readonly rootKind?: string;
  readonly rootType?: string;
  readonly fieldName?: string;
  readonly declarationDigest: Sha256Digest;
}

type RejectionStub = Readonly<{
  readonly capabilityId?: string;
  readonly revision?: string;
}>;

interface OperationInspection {
  readonly unavailable: boolean;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
}

type OperationEvidenceDigestValue = Sha256Digest | "missing" | "invalid";

interface OperationEvidenceDigestMaterial {
  readonly specRevision: string;
  readonly sourceId: string;
  readonly schemaDigest: OperationEvidenceDigestValue;
  readonly operationDocumentDigest: OperationEvidenceDigestValue;
  readonly rootKind: GraphqlRootOperationKind;
  readonly rootType: string;
  readonly fieldName: string;
  readonly coordinate: string;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly deprecation: GraphqlDeprecationEvidence | "missing" | "invalid";
  readonly customScalars: readonly (GraphqlCustomScalarResolution | "missing" | "invalid")[];
}

/**
 * Discover provider-neutral candidates from inert, already-settled GraphQL
 * introspection data. No parser, network client, introspection call, query
 * executor, or schema inference hook is accepted at this boundary.
 */
export function discoverGraphqlCapabilities(
  input: GraphqlCapabilityDiscoveryInput,
): GraphqlCapabilityDiscoveryResult {
  const parsedInput = parseInput(input);
  const diagnostics: GraphqlCapabilityDiscoveryDiagnostic[] = [];
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
      rejectedOperation.code,
      snapshot.sourceId,
      binding?.capabilityId,
      {
        selector: rejectedOperation.selector,
        coordinate: rejectedOperation.coordinate,
        rootKind: rejectedOperation.rootKind,
        rootType: rejectedOperation.rootType,
        fieldName: rejectedOperation.fieldName,
        declarationDigest: rejectedOperation.declarationDigest,
      },
    ));
  }

  const coordinateCounts = new Map<string, number>();
  const selectorCounts = new Map<string, number>();
  for (const operation of snapshot.operations) {
    coordinateCounts.set(operation.coordinate, (coordinateCounts.get(operation.coordinate) ?? 0) + 1);
    selectorCounts.set(operation.selector, (selectorCounts.get(operation.selector) ?? 0) + 1);
  }

  const candidates: CapabilityDescriptorCandidate[] = [];
  const globallyUnavailable = snapshot.globalIssues.length > 0;
  for (const operation of snapshot.operations) {
    const duplicateCoordinate = (coordinateCounts.get(operation.coordinate) ?? 0) > 1;
    const duplicateSelector = (selectorCounts.get(operation.selector) ?? 0) > 1;
    const bindingEntries = bindingsBySelector.get(operation.selector) ?? [];
    if (duplicateCoordinate || duplicateSelector) {
      if (duplicateCoordinate) {
        diagnostics.push(diagnostic(
          "duplicate_coordinate",
          operation.selector,
          operation.coordinate,
          bindingEntries[0]?.capabilityId,
          "Multiple settled GraphQL declarations claim the same root field coordinate.",
        ));
      }
      if (duplicateSelector) {
        diagnostics.push(diagnostic(
          "duplicate_selector",
          operation.selector,
          operation.coordinate,
          bindingEntries[0]?.capabilityId,
          "Multiple settled GraphQL declarations claim the same exact selector.",
        ));
      }
      const binding = bindingEntries.length === 1 ? bindingEntries[0] : undefined;
      appendRejectionStub(rejectionStubs, createRejectionStub(
        duplicateCoordinate ? "duplicate_coordinate" : "duplicate_selector",
        snapshot.sourceId,
        binding?.capabilityId,
        {
          selector: operation.selector,
          coordinate: operation.coordinate,
          rootKind: operation.rootKind,
          rootType: operation.rootType,
          fieldName: operation.fieldName,
          duplicateCoordinate,
          duplicateSelector,
          declarationDigest: operation.declarationDigest,
        },
      ));
      continue;
    }
    if (bindingEntries.length === 0) {
      diagnostics.push(diagnostic(
        "binding_missing",
        operation.selector,
        operation.coordinate,
        undefined,
        "No exact local binding exists for this settled GraphQL root field.",
      ));
      appendRejectionStub(rejectionStubs, Object.freeze({}));
      continue;
    }
    if (bindingEntries.length > 1) {
      appendRejectionStub(rejectionStubs, Object.freeze({}));
      continue;
    }

    const binding = bindingEntries[0]!;
    const inspection = inspectOperation(operation, binding, snapshot, diagnostics);
    candidates.push(deepFreeze(buildCandidate(
      snapshot,
      operation,
      binding,
      globallyUnavailable || inspection.unavailable,
      inspection.inputSchemaDigest,
      inspection.outputSchemaDigest,
    )));
  }

  candidates.sort(compareCandidates);
  const frozenCandidates = Object.freeze(candidates);
  const contribution = createCapabilityCatalogContribution({
    sourceId: "graphql",
    candidates: frozenCandidates,
    rejections: rejectionStubs.map((stub) => ({
      ...stub,
      reason: "malformed-descriptor" as const,
    })),
  });
  const catalog = buildAggregateCapabilityCatalog([contribution], parsedInput.evaluatedAt);
  const sortedDiagnostics = diagnostics
    .map((entry) => deepFreeze(entry))
    .sort(compareDiagnostics);
  return Object.freeze({
    evaluatedAt: parsedInput.evaluatedAt,
    specRevision: snapshot.specRevision,
    candidates: frozenCandidates,
    diagnostics: Object.freeze(sortedDiagnostics),
    contribution,
    catalog,
  });
}

/** Returns only inert GraphQL capability candidates. */
export function discoverGraphqlCapabilityCandidates(
  input: GraphqlCapabilityDiscoveryInput,
): readonly CapabilityDescriptorCandidate[] {
  return discoverGraphqlCapabilities(input).candidates;
}

/** Returns the Core-branded catalog generated by the GraphQL adapter. */
export function discoverGraphqlCapabilityCatalog(
  input: GraphqlCapabilityDiscoveryInput,
): CapabilityCatalogSnapshot {
  return discoverGraphqlCapabilities(input).catalog;
}

function parseInput(input: GraphqlCapabilityDiscoveryInput): {
  readonly evaluatedAt: string;
  readonly snapshot: unknown;
  readonly bindings: unknown;
} {
  const record = requirePlainRecord(input, "GraphQL capability discovery input");
  requireExactKeys(record, ["evaluatedAt", "snapshot", "bindings"], "GraphQL capability discovery input");
  const evaluatedAt = dataProperty(record, "evaluatedAt");
  if (!isCanonicalTimestamp(evaluatedAt)) {
    throw new TypeError("GraphQL capability discovery evaluatedAt must be a canonical ISO timestamp.");
  }
  const bindings = cloneInert(dataProperty(record, "bindings"), "GraphQL capability discovery bindings", {
    maxNodes: MAX_BINDINGS * 32,
    maxDepth: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth * 2,
    maxStringUnits: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits * 4,
  });
  if (!Array.isArray(bindings)) throw new TypeError("GraphQL capability discovery bindings must be an array.");
  if (bindings.length > MAX_BINDINGS) throw new TypeError("GraphQL capability discovery bindings exceed the bounded maximum.");
  return {
    evaluatedAt,
    snapshot: dataProperty(record, "snapshot"),
    bindings,
  };
}

function parseSnapshot(
  value: unknown,
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
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
    addGlobalIssue(globalIssues, diagnostics, "snapshot_malformed", "The settled GraphQL source identity is malformed.");
  }
  if (specRevision !== GRAPHQL_SPEC_REVISION) {
    addGlobalIssue(globalIssues, diagnostics, "spec_revision_mismatch", "Only the exact GraphQL September2025 specification revision is admitted.");
  }
  if (record.completeness !== "complete") {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_incomplete", "Only complete GraphQL root-operation snapshots can provide discovery evidence.");
  }
  if (record.invalidated !== false) {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_invalidated", "The GraphQL snapshot is missing an explicit non-invalidated state.");
  }
  const schemaDigest = parseDigest(record.schemaDigest);
  if (schemaDigest === undefined) {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_schema_digest_invalid", "The settled GraphQL snapshot has no valid schema digest.");
  }
  const freshness = parseFreshness(record.freshness);
  if (freshness === undefined) {
    addGlobalIssue(globalIssues, diagnostics, "snapshot_freshness_invalid", "The GraphQL snapshot freshness or TTL evidence is malformed.");
  } else if (freshness.status === "stale" || freshness.status === "unknown"
    || Date.parse(freshness.validUntil) <= Date.parse(evaluatedAt)
    || Date.parse(freshness.observedAt) > Date.parse(evaluatedAt)) {
    const stale = freshness.status === "stale" || Date.parse(freshness.validUntil) <= Date.parse(evaluatedAt);
    addGlobalIssue(
      globalIssues,
      diagnostics,
      stale ? "snapshot_stale" : "snapshot_freshness_invalid",
      stale ? "The GraphQL snapshot is stale at the evaluation instant." : "The GraphQL snapshot freshness state is unknown or contradictory.",
    );
  }
  const rejectedOperations: RejectedOperation[] = [];
  const operations = parseOperations(record.operations, diagnostics, sourceId, rejectedOperations);
  return {
    sourceId,
    specRevision,
    ...(schemaDigest === undefined ? {} : { schemaDigest }),
    ...(freshness === undefined ? {} : { freshness }),
    operations,
    rejectedOperations: Object.freeze(rejectedOperations),
    globalIssues,
  };
}

/** Copy only settled fields owned by this adapter; unknown fields are ignored. */
function cloneSnapshot(source: Record<string, unknown>): Record<string, unknown> {
  const result = Object.create(null) as Record<string, unknown>;
  const fields = [
    "sourceId",
    "specRevision",
    "schemaDigest",
    "completeness",
    "invalidated",
    "freshness",
    "operations",
  ] as const;
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(source, field);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) {
      result[field] = undefined;
      continue;
    }
    try {
      result[field] = field === "operations"
        ? cloneOperations(descriptor.value)
        : cloneInert(descriptor.value, `GraphQL snapshot ${field}`, {
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

function cloneOperations(value: unknown): unknown {
  if (isProxy(value) || !Array.isArray(value)) return undefined;
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number"
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_OPERATIONS) {
    return undefined;
  }
  const length = lengthDescriptor.value;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) return undefined;
  const result: Record<string, unknown>[] = [];
  for (let index = 0; index < length; index += 1) {
    const entryDescriptor = descriptors[String(index)];
    if (!entryDescriptor || !entryDescriptor.enumerable || !("value" in entryDescriptor)) return undefined;
    const operation = asPlainRecord(entryDescriptor.value);
    if (operation === undefined) {
      result.push(Object.create(null) as Record<string, unknown>);
      continue;
    }
    const copied = Object.create(null) as Record<string, unknown>;
    const fields = [
      "selector",
      "rootKind",
      "rootType",
      "fieldName",
      "coordinate",
      "operationDocumentDigest",
      "operationEvidenceDigest",
      "inputSchema",
      "outputSchema",
      "deprecation",
      "customScalars",
    ] as const;
    for (const field of fields) {
      const fieldDescriptor = Object.getOwnPropertyDescriptor(operation, field);
      if (!fieldDescriptor || !fieldDescriptor.enumerable || !("value" in fieldDescriptor)) continue;
      try {
        copied[field] = field === "inputSchema" || field === "outputSchema"
          || field === "deprecation" || field === "customScalars"
          ? cloneInert(fieldDescriptor.value, `GraphQL operation ${field}`, {
            maxNodes: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxNodes,
            maxDepth: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxDepth,
            maxStringUnits: DEFAULT_JSON_SCHEMA_SAFETY_LIMITS.maxStringUnits,
          })
          : cloneInert(fieldDescriptor.value, `GraphQL operation ${field}`, {
            maxNodes: 64,
            maxDepth: 4,
            maxStringUnits: MAX_DEPRECATION_REASON_LENGTH,
          });
      } catch {
        // A malformed owned field becomes unavailable evidence. Unknown fields
        // such as execute, parser, and transport callbacks are never read.
      }
    }
    // Legacy aliases are never read. Preserve only their presence as an
    // invalid-evidence marker so they cannot be silently ignored or used for
    // compatibility semantics.
    for (const field of ["deprecated", "customScalarResolutions"] as const) {
      if (Object.getOwnPropertyDescriptor(operation, field) !== undefined) copied[field] = undefined;
    }
    result.push(copied);
  }
  return result;
}

function parseOperations(
  value: unknown,
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
  sourceId: string,
  rejectedOperations: RejectedOperation[],
): readonly ParsedOperation[] {
  if (!Array.isArray(value)) {
    diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, undefined, "The GraphQL operations collection is malformed or exceeds limits."));
    return [];
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (!lengthDescriptor || !("value" in lengthDescriptor) || typeof lengthDescriptor.value !== "number"
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_OPERATIONS) {
    diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, undefined, "The GraphQL operations collection is malformed or exceeds limits."));
    return [];
  }
  const result: ParsedOperation[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const entryDescriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entryDescriptor || !entryDescriptor.enumerable || !("value" in entryDescriptor)) {
      diagnostics.push(diagnostic("snapshot_malformed", undefined, undefined, undefined, "The GraphQL operations collection is malformed or exceeds limits."));
      return result;
    }
    const entry = entryDescriptor.value;
    const record = asPlainRecord(entry);
    const selector = record === undefined ? undefined : dataProperty(record, "selector");
    const rootKind = record === undefined ? undefined : dataProperty(record, "rootKind");
    const rootType = record === undefined ? undefined : dataProperty(record, "rootType");
    const fieldName = record === undefined ? undefined : dataProperty(record, "fieldName");
    const coordinate = record === undefined ? undefined : dataProperty(record, "coordinate");
    if (typeof selector !== "string" || !isMember(rootKind, ROOT_KINDS) || typeof rootType !== "string"
      || !GRAPHQL_NAME_PATTERN.test(rootType) || typeof fieldName !== "string" || !GRAPHQL_NAME_PATTERN.test(fieldName)
      || typeof coordinate !== "string" || !GRAPHQL_NAME_PATTERN.test(rootType) || coordinate !== `${rootType}.${fieldName}`
      || !isCanonicalSelector(selector, sourceId, rootKind, coordinate)) {
      const coordinateValue = typeof coordinate === "string" ? coordinate : undefined;
      const selectorValue = typeof selector === "string" ? selector : undefined;
      const code = typeof rootType === "string" && typeof fieldName === "string"
        && coordinate !== `${rootType}.${fieldName}`
        ? "coordinate_mismatch"
        : "operation_malformed";
      diagnostics.push(diagnostic(code, selectorValue, coordinateValue, undefined, "A settled GraphQL root operation declaration is malformed or is not exactly qualified for its source."));
      rejectedOperations.push({
        code,
        ...(typeof selector === "string" ? { selector } : {}),
        ...(typeof coordinate === "string" ? { coordinate } : {}),
        ...(isMember(rootKind, ROOT_KINDS) ? { rootKind } : {}),
        ...(typeof rootType === "string" ? { rootType } : {}),
        ...(typeof fieldName === "string" ? { fieldName } : {}),
        declarationDigest: deriveOperationDeclarationDigest(record),
      });
      continue;
    }
    if (record === undefined) continue;

    const operationDocumentDigestValue = record === undefined ? undefined : dataProperty(record, "operationDocumentDigest");
    const operationDocumentDigest = parseDigest(operationDocumentDigestValue);
    const operationDocumentDigestInvalid = operationDocumentDigestValue !== undefined && operationDocumentDigest === undefined;
    const operationEvidenceDigestValue = dataProperty(record, "operationEvidenceDigest");
    const operationEvidenceDigest = parseDigest(operationEvidenceDigestValue);
    const operationEvidenceDigestInvalid = operationEvidenceDigestValue !== undefined && operationEvidenceDigest === undefined;
    const inputSchemaValue = dataProperty(record, "inputSchema");
    const outputSchemaValue = dataProperty(record, "outputSchema");
    const inputSchemaPresent = Object.hasOwn(record, "inputSchema");
    const outputSchemaPresent = Object.hasOwn(record, "outputSchema");
    const inputSchema = asPlainRecord(inputSchemaValue);
    const outputSchema = asPlainRecord(outputSchemaValue);
    const inputSchemaInvalid = inputSchemaPresent && inputSchemaValue !== undefined && inputSchema === undefined;
    const outputSchemaInvalid = outputSchemaPresent && outputSchemaValue !== undefined && outputSchema === undefined;
    const deprecation = parseDeprecation(record);
    const customScalars = parseCustomScalars(record);
    const declarationDigest = sha256(stableStringify({
      selector,
      rootKind,
      rootType,
      fieldName,
      coordinate,
      operationDocumentDigest: operationDocumentDigest ?? "missing",
      operationEvidenceDigest: operationEvidenceDigest ?? "missing",
      inputSchema: inputSchema ?? (inputSchemaPresent ? "invalid" : "missing"),
      outputSchema: outputSchema ?? (outputSchemaPresent ? "invalid" : "missing"),
      deprecation,
      customScalars,
    }));
    result.push({
      selector,
      rootKind,
      rootType,
      fieldName,
      coordinate,
      ...(operationDocumentDigest === undefined ? {} : { operationDocumentDigest }),
      operationDocumentDigestInvalid,
      ...(operationEvidenceDigest === undefined ? {} : { operationEvidenceDigest }),
      operationEvidenceDigestInvalid,
      ...(inputSchema === undefined ? {} : { inputSchema }),
      inputSchemaPresent,
      inputSchemaInvalid,
      ...(outputSchema === undefined ? {} : { outputSchema }),
      outputSchemaPresent,
      outputSchemaInvalid,
      deprecation,
      customScalars,
      declarationDigest,
    });
  }
  return Object.freeze(result);
}

function deriveOperationDeclarationDigest(record: Record<string, unknown> | undefined): Sha256Digest {
  try {
    return sha256(stableStringify({
      selector: record === undefined ? undefined : dataProperty(record, "selector"),
      rootKind: record === undefined ? undefined : dataProperty(record, "rootKind"),
      rootType: record === undefined ? undefined : dataProperty(record, "rootType"),
      fieldName: record === undefined ? undefined : dataProperty(record, "fieldName"),
      coordinate: record === undefined ? undefined : dataProperty(record, "coordinate"),
      operationDocumentDigest: record === undefined ? undefined : dataProperty(record, "operationDocumentDigest"),
      operationEvidenceDigest: record === undefined ? undefined : dataProperty(record, "operationEvidenceDigest"),
      inputSchema: record === undefined ? undefined : dataProperty(record, "inputSchema"),
      outputSchema: record === undefined ? undefined : dataProperty(record, "outputSchema"),
    }));
  } catch {
    return sha256(`${GRAPHQL_CAPABILITY_DISCOVERY_REVISION}/operation/malformed`);
  }
}

function parseDeprecation(record: Record<string, unknown>): ParsedDeprecation {
  const deprecationPresent = Object.hasOwn(record, "deprecation");
  if (Object.hasOwn(record, "deprecated")) return { present: true, invalid: true };
  if (!deprecationPresent) return { present: false, invalid: false };
  const deprecation = deprecationPresent ? dataProperty(record, "deprecation") : undefined;
  if (deprecationPresent && typeof deprecation === "boolean") {
    return { present: true, invalid: false, isDeprecated: deprecation };
  }
  if (deprecationPresent) {
    const value = asPlainRecord(deprecation);
    if (value === undefined || !hasAllowedKeys(value, DEPRECATION_KEYS) || !Object.hasOwn(value, "isDeprecated")
      || typeof value.isDeprecated !== "boolean") return { present: true, invalid: true };
    const reason = dataProperty(value, "reason");
    if (reason !== undefined && (typeof reason !== "string" || reason.length > MAX_DEPRECATION_REASON_LENGTH)) {
      return { present: true, invalid: true };
    }
    return {
      present: true,
      invalid: false,
      isDeprecated: value.isDeprecated,
      ...(reason === undefined ? {} : { reason }),
    };
  }
  return { present: true, invalid: true };
}

function parseCustomScalars(record: Record<string, unknown>): ParsedOperation["customScalars"] {
  const customScalarsPresent = Object.hasOwn(record, "customScalars");
  if (Object.hasOwn(record, "customScalarResolutions")) return { present: true, invalid: true };
  if (!customScalarsPresent) return { present: false, invalid: false };
  const value = dataProperty(record, "customScalars");
  if (!Array.isArray(value) || value.length > MAX_CUSTOM_SCALARS) return { present: true, invalid: true };
  const values: ParsedScalar[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    const scalar = asPlainRecord(entry);
    if (scalar === undefined || !hasAllowedKeys(scalar, SCALAR_KEYS)
      || !Object.hasOwn(scalar, "name") || !Object.hasOwn(scalar, "resolved")) return { present: true, invalid: true };
    const name = dataProperty(scalar, "name");
    if (typeof name !== "string" || !GRAPHQL_NAME_PATTERN.test(name) || names.has(name)) return { present: true, invalid: true };
    names.add(name);
    const resolvedValue = dataProperty(scalar, "resolved");
    if (typeof resolvedValue !== "boolean") return { present: true, invalid: true };
    const schemaDigestValue = dataProperty(scalar, "schemaDigest");
    const schemaDigest = parseDigest(schemaDigestValue);
    if (Object.hasOwn(scalar, "schemaDigest") && schemaDigest === undefined) return { present: true, invalid: true };
    if (resolvedValue) {
      if (schemaDigest === undefined) return { present: true, invalid: true };
      values.push({ name, resolved: true, schemaDigest });
    } else {
      values.push({ name, resolved: false, ...(schemaDigest === undefined ? {} : { schemaDigest }) });
    }
  }
  values.sort((left, right) => compareCodeUnits(left.name, right.name) || Number(left.resolved) - Number(right.resolved));
  return { present: true, invalid: false, values: Object.freeze(values) };
}

function parseBindings(
  value: unknown,
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
  sourceId: string,
): readonly ParsedBinding[] {
  if (!Array.isArray(value) || value.length > MAX_BINDINGS) {
    throw new TypeError("GraphQL capability bindings must be a bounded array.");
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
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
  sourceId: string,
): ParsedBinding | undefined {
  const record = asPlainRecord(value);
  if (record === undefined) {
    diagnostics.push(diagnostic("binding_malformed", undefined, undefined, undefined, "A GraphQL capability binding is not inert plain data."));
    return undefined;
  }
  const bindingSourceId = dataProperty(record, "sourceId");
  const selector = dataProperty(record, "selector");
  const capabilityId = dataProperty(record, "capabilityId");
  if (bindingSourceId !== sourceId) {
    diagnostics.push(diagnostic("binding_source_mismatch", typeof selector === "string" ? selector : undefined, undefined, typeof capabilityId === "string" ? capabilityId : undefined, "A GraphQL capability binding is scoped to another source."));
    return undefined;
  }
  if (typeof selector !== "string" || typeof capabilityId !== "string" || !CAPABILITY_ID_PATTERN.test(capabilityId)
    || !isCanonicalGraphqlSelector(selector, sourceId) || !hasAllowedKeys(record, BINDING_KEYS)) {
    diagnostics.push(diagnostic("binding_identity_invalid", typeof selector === "string" ? selector : undefined, undefined, typeof capabilityId === "string" ? capabilityId : undefined, "A GraphQL capability binding has an invalid selector or capability identity."));
    return undefined;
  }
  const kind = parseMember(dataProperty(record, "kind"), KINDS);
  const ownerKind = parseMember(dataProperty(record, "ownerKind"), OWNER_KINDS);
  const implementationKind = parseMember(dataProperty(record, "implementationKind"), IMPLEMENTATION_KINDS);
  if (!kind || !ownerKind || !implementationKind) {
    diagnostics.push(diagnostic("binding_identity_invalid", selector, undefined, capabilityId, "A GraphQL capability binding has an invalid posture kind."));
    return undefined;
  }
  const effectRecord = asPlainRecord(dataProperty(record, "effect"));
  const effect = effectRecord === undefined ? undefined : normalizeActionEffectEnvelope(effectRecord);
  if (effectRecord === undefined || !effect || !hasExactKeys(effectRecord, EFFECT_KEYS)) {
    diagnostics.push(diagnostic("effect_invalid", selector, undefined, capabilityId, "The GraphQL local binding does not declare a complete canonical action effect."));
    return undefined;
  }
  const permissions = parseMembers(dataProperty(record, "permissions"), PERMISSIONS);
  const supportedCallers = parseExactSupportedCallers(dataProperty(record, "supportedCallers"));
  const approval = parseMember(dataProperty(record, "approval"), APPROVALS);
  const network = parseMember(dataProperty(record, "network"), NETWORK_POSTURES);
  const data = parseData(dataProperty(record, "data"));
  const limits = parseLimits(dataProperty(record, "limits"));
  if (!permissions || !supportedCallers || !approval || !network || !data || !limits) {
    diagnostics.push(diagnostic("binding_malformed", selector, undefined, capabilityId, "The GraphQL local binding has an incomplete or invalid posture."));
    return undefined;
  }
  const bindingDigestValue = parseOptionalDigest(dataProperty(record, "bindingDigest"));
  const ownerIdentityDigest = parseDigest(dataProperty(record, "ownerIdentityDigest"));
  const sourceIdentityDigest = parseDigest(dataProperty(record, "sourceIdentityDigest"));
  const implementationIdentityDigest = parseDigest(dataProperty(record, "implementationIdentityDigest"));
  if (bindingDigestValue.invalid || !ownerIdentityDigest || !sourceIdentityDigest || !implementationIdentityDigest) {
    diagnostics.push(diagnostic("binding_identity_invalid", selector, undefined, capabilityId, "The GraphQL local binding contains a malformed identity digest."));
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
  const contractRevisionValue = dataProperty(record, "contractRevision");
  const contractRevision = contractRevisionValue === undefined ? GRAPHQL_CAPABILITY_DISCOVERY_REVISION : contractRevisionValue;
  if (typeof contractRevision !== "string" || contractRevision.length === 0 || contractRevision.length > 127 || /[\u0000-\u001f\u007f]/u.test(contractRevision)) {
    diagnostics.push(diagnostic("binding_malformed", selector, undefined, capabilityId, "The GraphQL contract revision is malformed."));
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
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
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
        diagnostics.push(diagnostic("binding_duplicate", selector, undefined, entry.capabilityId, "Multiple local bindings claim the same exact GraphQL selector."));
      }
    }
  }
  return groups;
}

function inspectOperation(
  operation: ParsedOperation,
  binding: ParsedBinding,
  snapshot: ParsedSnapshot,
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
): OperationInspection {
  let unavailable = false;
  if (operation.fieldName.startsWith("__")) {
    unavailable = true;
    diagnostics.push(diagnostic("introspection_field_rejected", operation.selector, operation.coordinate, binding.capabilityId, "GraphQL introspection fields are not portable capabilities."));
  }
  if (operation.operationDocumentDigestInvalid || operation.operationDocumentDigest === undefined) {
    unavailable = true;
    diagnostics.push(diagnostic("operation_document_digest_invalid", operation.selector, operation.coordinate, binding.capabilityId, "The settled GraphQL operation document has no valid digest."));
  }

  const inputSchemaDigest = inspectSchema(
    operation.inputSchema,
    operation.inputSchemaPresent,
    operation.inputSchemaInvalid,
    "input",
    operation,
    binding,
    diagnostics,
  );
  if (!inputSchemaDigest.ok) unavailable = true;
  const outputSchemaDigest = inspectSchema(
    operation.outputSchema,
    operation.outputSchemaPresent,
    operation.outputSchemaInvalid,
    "output",
    operation,
    binding,
    diagnostics,
  );
  if (!outputSchemaDigest.ok) unavailable = true;

  if (!operation.deprecation.present) {
    unavailable = true;
    diagnostics.push(diagnostic("deprecation_evidence_missing", operation.selector, operation.coordinate, binding.capabilityId, "The settled GraphQL field has no deprecation evidence."));
  } else if (operation.deprecation.invalid || operation.deprecation.isDeprecated === undefined) {
    unavailable = true;
    diagnostics.push(diagnostic("deprecation_evidence_invalid", operation.selector, operation.coordinate, binding.capabilityId, "The settled GraphQL field deprecation evidence is malformed."));
  } else if (operation.deprecation.isDeprecated) {
    unavailable = true;
    diagnostics.push(diagnostic("deprecated_field", operation.selector, operation.coordinate, binding.capabilityId, "Deprecated GraphQL fields are not admitted as capability declarations."));
  }

  if (!operation.customScalars.present) {
    unavailable = true;
    diagnostics.push(diagnostic("custom_scalar_evidence_missing", operation.selector, operation.coordinate, binding.capabilityId, "The settled GraphQL operation has no custom-scalar resolution evidence."));
  } else if (operation.customScalars.invalid || operation.customScalars.values === undefined) {
    unavailable = true;
    diagnostics.push(diagnostic("custom_scalar_evidence_invalid", operation.selector, operation.coordinate, binding.capabilityId, "The settled GraphQL custom-scalar resolution evidence is malformed."));
  } else if (operation.customScalars.values.some((scalar) => !scalar.resolved)) {
    unavailable = true;
    diagnostics.push(diagnostic("custom_scalar_unresolved", operation.selector, operation.coordinate, binding.capabilityId, "Every custom scalar used by a GraphQL operation must have settled resolution evidence."));
  }

  const expectedOperationEvidenceDigest = deriveOperationEvidenceDigest({
    specRevision: snapshot.specRevision,
    sourceId: snapshot.sourceId,
    schemaDigest: snapshot.schemaDigest ?? "missing",
    operationDocumentDigest: operation.operationDocumentDigest ?? "missing",
    rootKind: operation.rootKind,
    rootType: operation.rootType,
    fieldName: operation.fieldName,
    coordinate: operation.coordinate,
    inputSchemaDigest: inputSchemaDigest.digest,
    outputSchemaDigest: outputSchemaDigest.digest,
    deprecation: operation.deprecation.present && !operation.deprecation.invalid
      && operation.deprecation.isDeprecated !== undefined
      ? {
        isDeprecated: operation.deprecation.isDeprecated,
        ...(operation.deprecation.reason === undefined ? {} : { reason: operation.deprecation.reason }),
      }
      : operation.deprecation.present ? "invalid" : "missing",
    customScalars: operation.customScalars.values === undefined
      ? [operation.customScalars.present ? "invalid" : "missing"]
      : operation.customScalars.values,
  });
  if (operation.operationEvidenceDigestInvalid
    || operation.operationEvidenceDigest === undefined
    || operation.operationEvidenceDigest !== expectedOperationEvidenceDigest) {
    unavailable = true;
    diagnostics.push(diagnostic(
      "operation_evidence_digest_invalid",
      operation.selector,
      operation.coordinate,
      binding.capabilityId,
      "The settled GraphQL operation evidence digest is missing, malformed, or does not match the settled operation evidence.",
    ));
  }

  return {
    unavailable,
    inputSchemaDigest: inputSchemaDigest.digest,
    outputSchemaDigest: outputSchemaDigest.digest,
  };
}

function inspectSchema(
  value: Readonly<Record<string, unknown>> | undefined,
  present: boolean,
  invalid: boolean,
  direction: "input" | "output",
  operation: ParsedOperation,
  binding: ParsedBinding,
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
): { readonly ok: boolean; readonly digest: Sha256Digest } {
  const absentDigest = direction === "input" ? GRAPHQL_INPUT_SCHEMA_ABSENT_DIGEST : GRAPHQL_OUTPUT_SCHEMA_ABSENT_DIGEST;
  if (!present || value === undefined) {
    diagnostics.push(diagnostic(
      direction === "input" ? "input_schema_missing" : "output_schema_missing",
      operation.selector,
      operation.coordinate,
      binding.capabilityId,
      `The settled GraphQL operation has no ${direction} schema evidence.`,
    ));
    return { ok: false, digest: absentDigest };
  }
  const checked = invalid
    ? { ok: false as const, reason: "malformed" as const }
    : validateSchema(value, direction);
  if (!checked.ok) {
    if (checked.reason === "reference") {
      diagnostics.push(diagnostic("schema_reference_rejected", operation.selector, operation.coordinate, binding.capabilityId, "GraphQL JSON Schema references are not resolved at this boundary."));
    } else {
      diagnostics.push(diagnostic(
        direction === "input" ? "input_schema_invalid" : "output_schema_invalid",
        operation.selector,
        operation.coordinate,
        binding.capabilityId,
        `The GraphQL ${direction} JSON Schema is not an admitted JSON Schema 2020-12 object${checked.reason === undefined ? "" : ` (${checked.reason})`}.`,
      ));
    }
    return { ok: false, digest: absentDigest };
  }
  return { ok: true, digest: checked.digest as Sha256Digest };
}

function buildCandidate(
  snapshot: ParsedSnapshot,
  operation: ParsedOperation,
  binding: ParsedBinding,
  unavailable: boolean,
  inputSchemaDigest: Sha256Digest,
  outputSchemaDigest: Sha256Digest,
): CapabilityDescriptorCandidate {
  const revision = sha256(stableStringify({
    adapterRevision: GRAPHQL_CAPABILITY_DISCOVERY_REVISION,
    specRevision: snapshot.specRevision,
    sourceId: snapshot.sourceId,
    schemaDigest: snapshot.schemaDigest ?? "missing",
    selector: operation.selector,
    rootKind: operation.rootKind,
    rootType: operation.rootType,
    fieldName: operation.fieldName,
    coordinate: operation.coordinate,
    operationDocumentDigest: operation.operationDocumentDigest ?? "missing",
    operationEvidenceDigest: operation.operationEvidenceDigest ?? "missing",
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
    artifacts: outputSchemaDigest === GRAPHQL_OUTPUT_SCHEMA_ABSENT_DIGEST
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
        schemaDigest: snapshot.schemaDigest ?? "missing",
        operationDocumentDigest: operation.operationDocumentDigest ?? "missing",
        operationEvidenceDigest: operation.operationEvidenceDigest ?? "missing",
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

function validateSchema(
  value: unknown,
  direction: "input" | "output",
): CapabilityJsonSchemaDigestResult {
  return normalizeAndDigestCapabilityJsonSchema(value, direction, {
    referencePolicy: "none",
    requireSchemaDialect: true,
  });
}

function validateFreshness(value: unknown): ParsedFreshness | undefined {
  const record = asPlainRecord(value);
  if (record === undefined || !isCanonicalTimestamp(dataProperty(record, "observedAt"))
    || !isCanonicalTimestamp(dataProperty(record, "validUntil"))) return undefined;
  const observedAt = dataProperty(record, "observedAt") as string;
  const validUntil = dataProperty(record, "validUntil") as string;
  const observedTime = Date.parse(observedAt);
  const validUntilTime = Date.parse(validUntil);
  const status = dataProperty(record, "status");
  if (observedTime >= validUntilTime || validUntilTime - observedTime > MAX_FRESHNESS_WINDOW_MS
    || (status !== undefined && status !== "current" && status !== "stale" && status !== "unknown")) return undefined;
  return {
    observedAt,
    validUntil,
    ...(status === undefined ? {} : { status }),
  };
}

function parseFreshness(value: unknown): ParsedFreshness | undefined {
  return validateFreshness(value);
}

function parseData(value: unknown): CapabilityDataPosture | undefined {
  const record = asPlainRecord(value);
  if (record === undefined || !hasExactKeys(record, ["input", "output", "retention"])) return undefined;
  const input = dataProperty(record, "input");
  const output = dataProperty(record, "output");
  const retention = dataProperty(record, "retention");
  if (!isMember(input, DATA_CLASSIFICATIONS) || !isMember(output, DATA_CLASSIFICATIONS) || !isMember(retention, RETENTIONS)) return undefined;
  return { input, output, retention };
}

function parseLimits(value: unknown): CapabilityLimits | undefined {
  const record = asPlainRecord(value);
  if (record === undefined || !hasExactKeys(record, ["maxInputBytes", "maxOutputBytes", "maxDurationMs", "maxArtifacts"])) return undefined;
  const maxInputBytes = dataProperty(record, "maxInputBytes");
  const maxOutputBytes = dataProperty(record, "maxOutputBytes");
  const maxDurationMs = dataProperty(record, "maxDurationMs");
  const maxArtifacts = dataProperty(record, "maxArtifacts");
  if (!boundedInteger(maxInputBytes, 1, 16 * 1024 * 1024)
    || !boundedInteger(maxOutputBytes, 1, 64 * 1024 * 1024)
    || !boundedInteger(maxDurationMs, 1, 24 * 60 * 60 * 1_000)
    || !boundedInteger(maxArtifacts, 0, 256)) return undefined;
  return { maxInputBytes, maxOutputBytes, maxDurationMs, maxArtifacts };
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

function normalizeDeprecationForEvidence(
  value: GraphqlDeprecationEvidence | boolean,
): GraphqlDeprecationEvidence {
  if (typeof value === "boolean") return { isDeprecated: value };
  return {
    isDeprecated: value.isDeprecated,
    ...(value.reason === undefined ? {} : { reason: value.reason }),
  };
}

function normalizeCustomScalarsForEvidence(
  values: readonly GraphqlCustomScalarResolution[],
): readonly GraphqlCustomScalarResolution[] {
  return values
    .map((scalar): GraphqlCustomScalarResolution => scalar.resolved
      ? { name: scalar.name, resolved: true, schemaDigest: scalar.schemaDigest }
      : {
        name: scalar.name,
        resolved: false,
        ...(scalar.schemaDigest === undefined ? {} : { schemaDigest: scalar.schemaDigest }),
      })
    .sort((left, right) => compareCodeUnits(left.name, right.name) || Number(left.resolved) - Number(right.resolved));
}

function deriveOperationEvidenceDigest(material: OperationEvidenceDigestMaterial): Sha256Digest {
  const customScalars = material.customScalars.length === 1 && typeof material.customScalars[0] === "string"
    ? material.customScalars[0]
    : material.customScalars
      .filter((scalar): scalar is GraphqlCustomScalarResolution => typeof scalar !== "string")
      .map((scalar) => ({
        name: scalar.name,
        resolved: scalar.resolved,
        schemaDigest: scalar.schemaDigest ?? "missing",
      }))
      .sort((left, right) => compareCodeUnits(left.name, right.name) || Number(left.resolved) - Number(right.resolved));
  return sha256(stableStringify({
    adapterRevision: GRAPHQL_CAPABILITY_DISCOVERY_REVISION,
    specRevision: material.specRevision,
    sourceId: material.sourceId,
    schemaDigest: material.schemaDigest,
    operationDocumentDigest: material.operationDocumentDigest,
    rootKind: material.rootKind,
    rootType: material.rootType,
    fieldName: material.fieldName,
    coordinate: material.coordinate,
    inputSchemaDigest: material.inputSchemaDigest,
    outputSchemaDigest: material.outputSchemaDigest,
    deprecation: material.deprecation,
    customScalars,
  }));
}

function cloneEffect(effect: ActionEffectEnvelope): ActionEffectEnvelope {
  const normalized = normalizeActionEffectEnvelope(effect);
  if (!normalized) throw new TypeError("GraphQL local effect unexpectedly became malformed.");
  return {
    ...normalized,
    boundaries: [...normalized.boundaries],
    consequences: [...normalized.consequences],
  };
}

function addGlobalIssue(
  issues: GlobalIssue[],
  diagnostics: GraphqlCapabilityDiscoveryDiagnostic[],
  code: GraphqlCapabilityDiscoveryDiagnosticCode,
  message: string,
): void {
  issues.push({ code, message });
  diagnostics.push(diagnostic(code, undefined, undefined, undefined, message));
}

function diagnostic(
  code: GraphqlCapabilityDiscoveryDiagnosticCode,
  selector: string | undefined,
  coordinate: string | undefined,
  capabilityId: string | undefined,
  message: string,
  severity: "warning" | "error" = "error",
): GraphqlCapabilityDiscoveryDiagnostic {
  return {
    code,
    ...(selector === undefined ? {} : { selector }),
    ...(coordinate === undefined ? {} : { coordinate }),
    ...(capabilityId === undefined ? {} : { capabilityId }),
    message,
    severity,
  };
}

function compareDiagnostics(left: GraphqlCapabilityDiscoveryDiagnostic, right: GraphqlCapabilityDiscoveryDiagnostic): number {
  return compareCodeUnits(left.selector ?? "", right.selector ?? "")
    || compareCodeUnits(left.coordinate ?? "", right.coordinate ?? "")
    || compareCodeUnits(left.capabilityId ?? "", right.capabilityId ?? "")
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.message, right.message);
}

function compareCandidates(left: CapabilityDescriptorCandidate, right: CapabilityDescriptorCandidate): number {
  return compareCodeUnits(left.capabilityId, right.capabilityId) || compareCodeUnits(left.revision, right.revision);
}

function createRejectionStub(
  code: Extract<GraphqlCapabilityDiscoveryDiagnosticCode, "operation_malformed" | "coordinate_mismatch" | "duplicate_coordinate" | "duplicate_selector">,
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
      adapterRevision: GRAPHQL_CAPABILITY_DISCOVERY_REVISION,
      sourceId,
      rejectionCode: code,
      ...material,
    })),
  });
}

function appendRejectionStub(stubs: RejectionStub[], stub: RejectionStub): void {
  if (stubs.length < MAX_CATALOG_ENTRIES) stubs.push(stub);
}

function isSafeCapabilityId(value: string | undefined): value is string {
  return typeof value === "string" && CAPABILITY_ID_PATTERN.test(value) && value.length <= 127;
}

function canonicalSelector(sourceId: string, rootKind: GraphqlRootOperationKind, coordinate: string): string {
  return `graphql:${sourceId}:${rootKind}:${coordinate}`;
}

function isCanonicalSelector(
  selector: string,
  sourceId: string,
  rootKind: GraphqlRootOperationKind,
  coordinate: string,
): boolean {
  return selector === canonicalSelector(sourceId, rootKind, coordinate);
}

function isCanonicalGraphqlSelector(selector: string, sourceId: string): boolean {
  const prefix = `graphql:${sourceId}:`;
  if (!selector.startsWith(prefix)) return false;
  const remainder = selector.slice(prefix.length);
  const separator = remainder.indexOf(":");
  if (separator <= 0) return false;
  const rootKind = remainder.slice(0, separator);
  const coordinate = remainder.slice(separator + 1);
  if (!isMember(rootKind, ROOT_KINDS)) return false;
  const dot = coordinate.indexOf(".");
  if (dot <= 0 || dot !== coordinate.lastIndexOf(".")) return false;
  const rootType = coordinate.slice(0, dot);
  const fieldName = coordinate.slice(dot + 1);
  return GRAPHQL_NAME_PATTERN.test(rootType) && GRAPHQL_NAME_PATTERN.test(fieldName)
    && isCanonicalSelector(selector, sourceId, rootKind, coordinate);
}

function hasExactKeys(record: Record<string, unknown> | undefined, keys: readonly string[]): boolean {
  if (record === undefined) return false;
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function hasAllowedKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(record).every((key) => keys.includes(key));
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (!hasExactKeys(record, keys)) throw new TypeError(`${label} contains unknown or missing fields.`);
}

function dataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor.value : undefined;
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
  const record = asPlainRecord(value);
  if (record === undefined) throw new TypeError(`${label} must be inert plain data.`);
  return record;
}

function asPlainRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainRecord(value) ? value : undefined;
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
    const descriptors = Object.getOwnPropertyDescriptors(current);
    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      const lengthDescriptor = descriptors.length;
      if (prototype !== Array.prototype || lengthDescriptor === undefined || !("value" in lengthDescriptor)
        || typeof lengthDescriptor.value !== "number" || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0 || lengthDescriptor.value > budget.maxNodes) throw new TypeError(`${label} contains an exotic array.`);
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) throw new TypeError(`${label} contains array metadata.`);
      const result: unknown[] = [];
      for (let index = 0; index < lengthDescriptor.value; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new TypeError(`${label} contains an accessor or array hole.`);
        result.push(visit(descriptor.value, depth + 1));
      }
      if (keys.length !== lengthDescriptor.value + 1) throw new TypeError(`${label} contains array metadata.`);
      return result;
    }
    if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${label} contains an exotic object.`);
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

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum && value <= maximum;
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
