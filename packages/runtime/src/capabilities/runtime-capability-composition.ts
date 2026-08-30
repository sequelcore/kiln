import {
  assertCapabilityCatalogContribution,
  assertCapabilityCatalogSnapshot,
  buildAggregateCapabilityCatalog,
  capabilityDescribe,
  capabilitySearch,
  CAPABILITY_DESCRIBE_CONTRACT,
  CAPABILITY_SEARCH_CONTRACT,
  normalizeAndDigestCapabilityJsonSchema,
  type CapabilityArtifactDeclaration,
  type CapabilityCatalogContribution,
  type CapabilityCatalogSnapshot,
  type CapabilityCallerId,
  type CapabilityDataClassification,
  type CapabilityDataPosture,
  type CapabilityDescribeResult,
  type CapabilityDescribeRequest,
  type CapabilityDescriptor,
  type CapabilityDescriptorDisclosure,
  type CapabilityFreshness,
  type CapabilityImplementationReference,
  type CapabilityImplementationKind,
  type CapabilityNetworkPosture,
  type CapabilityRetention,
  type CapabilitySearchEvidence,
  type CapabilitySearchResult,
  type CapabilitySearchRequest,
  type Sha256Digest,
} from "@kilnai/core/capabilities";
import {
  deriveAuthorityFromEffect,
  isValidNarrowing,
  type AuthorityDescriptor,
} from "@kilnai/core/engine";
import {
  EXECUTION_DATA_CLASSIFICATIONS,
  type ExecutionDataClassification,
  type ToolDefinition,
} from "@kilnai/core/agents";
import { sha256ContentIdentity } from "@kilnai/core/content-addressing";
import type { NetPolicy } from "@kilnai/core/sandbox";
import {
  deriveAuthorityRouteDigest,
  defineEffectiveAuthorityAdmissionBundle,
  type CapabilityParticipation,
  type EffectiveAuthorityAdmissionBundle,
} from "../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";

export const CAPABILITY_SEARCH_TOOL_NAME = "capability.search" as const;
export const CAPABILITY_DESCRIBE_TOOL_NAME = "capability.describe" as const;

export interface RuntimeCapabilityToolResult {
  readonly output: string;
  readonly isError: boolean;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export type RuntimeCapabilityToolExecutor = (
  input: Record<string, unknown>,
) => Promise<RuntimeCapabilityToolResult>;

export type RuntimeCapabilityDescribeDecision =
  | CapabilityDescribeResult["decision"]
  | "outside-authority"
  | "not-materializable"
  | "safety-mismatch";

export interface RuntimeCapabilitySelectionScope {
  readonly generationId: Sha256Digest;
  readonly routeDigest: Sha256Digest;
  readonly surfaceDigest: Sha256Digest;
  readonly authorityAdmissionId: Sha256Digest;
}

export type RuntimeCapabilitySearchEvidence = Omit<CapabilitySearchEvidence, "decision" | "runtimeScope"> & {
  readonly decision:
    | CapabilitySearchEvidence["decision"]
    | "outside-authority"
    | "not-materializable"
    | "safety-mismatch";
  readonly runtimeScope: RuntimeCapabilitySelectionScope;
};

export interface RuntimeCapabilitySearchResult {
  readonly contract: CapabilitySearchResult["contract"];
  readonly operation: "search";
  readonly catalogDigest: Sha256Digest;
  readonly observedAt: string;
  readonly totalEligible: number;
  readonly matched: number;
  readonly descriptors: readonly CapabilityDescriptorDisclosure[];
  readonly evidence: RuntimeCapabilitySearchEvidence;
  readonly scope: RuntimeCapabilitySelectionScope;
}

export interface RuntimeCapabilityDescribeResult {
  readonly contract: CapabilityDescribeResult["contract"];
  readonly operation: "describe";
  readonly catalogDigest: Sha256Digest;
  readonly observedAt: string;
  readonly decision: RuntimeCapabilityDescribeDecision;
  readonly descriptor?: CapabilityDescriptorDisclosure;
  /** Runtime-private selected definition; never serialize as capability evidence. */
  readonly tool?: ToolDefinition;
  readonly evidence: RuntimeCapabilitySearchEvidence;
  readonly scope: RuntimeCapabilitySelectionScope;
}

export interface RuntimeCapabilitySearchExecutionMetadata {
  readonly kind: "capability";
  readonly operation: "search";
  readonly contract: typeof CAPABILITY_SEARCH_CONTRACT;
  readonly generationId: Sha256Digest;
  readonly caller: CapabilityCallerId;
  /** Evaluation instant fixed by the authority admission for this turn. */
  readonly evaluatedAt: string;
  readonly decision: "selected" | "no-match";
  readonly evidence: RuntimeCapabilitySearchEvidence;
}

export interface RuntimeCapabilityDescribeExecutionMetadata {
  readonly kind: "capability";
  readonly operation: "describe";
  readonly contract: typeof CAPABILITY_DESCRIBE_CONTRACT;
  readonly generationId: Sha256Digest;
  readonly caller: CapabilityCallerId;
  readonly evaluatedAt: string;
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest?: Sha256Digest;
  readonly decision: RuntimeCapabilityDescribeDecision;
  readonly evidence: RuntimeCapabilitySearchEvidence;
}

export type RuntimeToolDefinitionInput = Omit<ToolDefinition, "tags"> & {
  readonly tags: Iterable<string>;
};

/** The only definitions projected before a capability is selected. */
export const RUNTIME_CAPABILITY_SEARCH_TOOL: ToolDefinition = normalizeToolDefinition({
  name: CAPABILITY_SEARCH_TOOL_NAME,
  description: "Find eligible provider-neutral capabilities without loading deferred tool schemas.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", maxLength: 256 },
      capabilityId: { type: "string" },
      kind: {
        type: "string",
        enum: ["portable-tool", "hosted-tool", "harness-native-tool", "agent-backed"],
      },
      limit: { type: "integer", minimum: 1, maximum: 64 },
    },
    additionalProperties: false,
  },
  tags: ["capability-discovery", "read-only"],
});

export const RUNTIME_CAPABILITY_DESCRIBE_TOOL: ToolDefinition = normalizeToolDefinition({
  name: CAPABILITY_DESCRIBE_TOOL_NAME,
  description: "Describe one exact eligible capability before its deferred tool schema is materialized.",
  inputSchema: {
    type: "object",
    properties: {
      capabilityId: { type: "string" },
      revision: { type: "string" },
      descriptorDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    },
    required: ["capabilityId", "revision"],
    additionalProperties: false,
  },
  tags: ["capability-discovery", "read-only"],
});

export const RUNTIME_CAPABILITY_DISCOVERY_TOOLS: readonly ToolDefinition[] = Object.freeze([
  RUNTIME_CAPABILITY_SEARCH_TOOL,
  RUNTIME_CAPABILITY_DESCRIBE_TOOL,
]);

/**
 * Projects only the fixed discovery contracts into the initial provider
 * request. Capability-specific schemas remain private until describe selects
 * an exact materialization.
 */
export function projectRuntimeCapabilityDiscoveryTools(
  baseTools: readonly ToolDefinition[] | undefined,
  binding: RuntimeCapabilityTurnBinding | undefined,
): readonly ToolDefinition[] | undefined {
  if (binding === undefined) return baseTools;
  const discoveryByName = new Map(binding.discoveryTools.map((tool) => [tool.name, tool] as const));
  const projected: ToolDefinition[] = [];
  // Reserve the canonical discovery names before considering caller tools.
  // A caller shadow is omitted entirely; the canonical definition is appended
  // below, so a provider can never observe a caller-owned schema under a
  // Runtime-owned discovery identity.
  const names = new Set(discoveryByName.keys());
  for (const tool of baseTools ?? []) {
    if (names.has(tool.name)) continue;
    const normalized = normalizeToolDefinition(tool);
    if (!names.has(normalized.name)) {
      projected.push(normalized);
      names.add(normalized.name);
    }
  }
  for (const tool of binding.discoveryTools) {
    projected.push(tool);
  }
  return Object.freeze(projected);
}

/** Runtime-private executor port. The function is never included in a projection. */
export type RuntimeCapabilityExecutor = (
  input: Record<string, unknown>,
) => Promise<RuntimeCapabilityToolResult>;

export type RuntimeCapabilityRequirementStatus =
  | { readonly status: "not-required" }
  | {
      readonly status: "unresolved";
      readonly reason:
        | "retention-authority-not-configured"
        | "budget-authority-not-configured"
        | "artifact-authority-not-configured";
    };

/** Private requirement facts supplied by the Runtime adapter for one tool. */
export interface RuntimeCapabilityMaterializationRequirements {
  readonly data: CapabilityDataPosture;
  readonly network: CapabilityNetworkPosture;
  readonly artifacts: readonly CapabilityArtifactDeclaration[];
  /** Optional because a capability may not consume turn-budget authority. */
  readonly budget?: RuntimeCapabilityRequirementStatus;
}

/** Freshness and revocation are checked again at every selection/invocation. */
export interface RuntimeCapabilityFreshnessGuard {
  readonly observedAt: string;
  readonly validUntil: string;
  readonly status: "available" | "unavailable";
  /** Returns true when the immutable materialization has been revoked. */
  readonly revocationGuard?: () => boolean;
}

/**
 * Process-local materialization. Schemas and identities are public evidence;
 * the executor remains private to the generation closure.
 */
export interface RuntimeCapabilityMaterializationRecord {
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest: Sha256Digest;
  /** Caller-supplied values are checked against canonical digests below. */
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly implementationReference: CapabilityImplementationReference;
  readonly toolName: string;
  readonly tool: ToolDefinition;
  readonly executor: RuntimeCapabilityExecutor;
  readonly requirements: RuntimeCapabilityMaterializationRequirements;
  readonly freshness: RuntimeCapabilityFreshnessGuard;
}

export interface RuntimeCapabilityCompositionScope {
  readonly projectId: string;
  readonly appId: string;
  readonly surfaceId: string;
  readonly caller: CapabilityCallerId;
  readonly surfaceDigest: Sha256Digest;
}

/** No authority is inferred for unresolved dimensions. */
export interface RuntimeCapabilityAuthorityCandidateRequirements {
  readonly data: CapabilityDataPosture;
  readonly network: CapabilityNetworkPosture;
  readonly artifacts: {
    readonly status: "not-required" | "unresolved";
    readonly reason?: "artifact-authority-not-configured";
    readonly declarations: readonly CapabilityArtifactDeclaration[];
  };
  readonly retention: RuntimeCapabilityRequirementStatus;
  readonly budget: RuntimeCapabilityRequirementStatus;
}

export type RuntimeCapabilityMaterializationStatus =
  | "materializable"
  | "not-materializable"
  | "unavailable";

/** Complete authority-facing candidate metadata without implementations/schemas. */
export interface RuntimeCapabilityAuthorityCandidate extends CapabilityDescriptorDisclosure {
  readonly candidateAuthority: AuthorityDescriptor;
  readonly materializationStatus: RuntimeCapabilityMaterializationStatus;
  /** Local tool identity is needed by Runtime authority mapping, never by providers. */
  readonly toolName?: string;
  readonly requirements: RuntimeCapabilityAuthorityCandidateRequirements;
}

/** Durable generation-linked branch of the canonical bundle capability state. */
export type RuntimeCapabilityAuthorityAdmissionLinkage = Extract<
  CapabilityParticipation,
  { readonly status: "generation-linked" }
>;

/**
 * Complete authority-facing projection prepared before a turn bundle is
 * computed. It contains candidate effects/scopes and identities only; deferred
 * schemas, private references, and executors never cross this boundary.
 */
export interface RuntimeCapabilityAuthorityCandidateProjection {
  readonly generationId: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly candidateProjectionDigest: Sha256Digest;
  readonly surfaceDigest: Sha256Digest;
  readonly caller: CapabilityCallerId;
  readonly discoveryToolNames: readonly [typeof CAPABILITY_SEARCH_TOOL_NAME, typeof CAPABILITY_DESCRIBE_TOOL_NAME];
  readonly candidates: readonly RuntimeCapabilityAuthorityCandidate[];
}

export interface RuntimeCapabilityAuthorityAdmissionBindingInput {
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle;
}

export interface RuntimeCapabilityMaterializedTool {
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest: Sha256Digest;
  /** The exact frozen definition used by describe and the next provider round. */
  readonly tool: ToolDefinition;
  /** Closure over the exact private materialization executor. */
  readonly invoke: RuntimeCapabilityExecutor;
}

export interface RuntimeCapabilityDescribeSelector {
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest?: Sha256Digest;
}

export interface RuntimeCapabilitySearchSelector {
  readonly query?: string;
  readonly capabilityId?: string;
  readonly kind?: CapabilitySearchRequest["kind"];
  readonly limit?: number;
}

export interface RuntimeCapabilityGeneration {
  readonly generationId: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly scope: RuntimeCapabilityCompositionScope;
  readonly materializationDigest: Sha256Digest;
  readonly candidateProjectionDigest: Sha256Digest;
  readonly discoveryTools: readonly ToolDefinition[];
  readonly authorityCandidates: readonly RuntimeCapabilityAuthorityCandidate[];
  readonly authorityCandidateProjection: RuntimeCapabilityAuthorityCandidateProjection;
  readonly isInvalidated: () => boolean;
  /** Monotonic state transition; content and digests never change. */
  readonly invalidate: () => void;
  readonly bindToExistingEffectiveAuthorityAdmissionBundle: (
    input: RuntimeCapabilityAuthorityAdmissionBindingInput,
  ) => RuntimeCapabilityTurnBinding;
}

export interface RuntimeCapabilityTurnBinding {
  readonly generationId: Sha256Digest;
  readonly catalogDigest: Sha256Digest;
  readonly candidateProjectionDigest: Sha256Digest;
  readonly evaluatedAt: string;
  readonly validUntil: string;
  readonly scope: RuntimeCapabilityCompositionScope;
  readonly routeDigest: Sha256Digest;
  readonly surfaceDigest: Sha256Digest;
  readonly authorityAdmissionId: Sha256Digest;
  readonly caller: CapabilityCallerId;
  readonly discoveryTools: readonly ToolDefinition[];
  readonly authorityCandidates: readonly RuntimeCapabilityAuthorityCandidate[];
  readonly search: (selector: RuntimeCapabilitySearchSelector) => RuntimeCapabilitySearchResult;
  readonly describe: (selector: RuntimeCapabilityDescribeSelector) => RuntimeCapabilityDescribeResult;
  /** Returns a stable handle over the exact private record, or undefined. */
  readonly materialize: (selector: RuntimeCapabilityDescribeSelector) => RuntimeCapabilityMaterializedTool | undefined;
  /** Discovery executors are closures over this binding and its exact generation. */
  readonly createDiscoveryToolExecutors: () => ReadonlyMap<string, RuntimeCapabilityToolExecutor>;
}

export interface RuntimeCapabilityCompositionFactoryInput {
  readonly catalog?: CapabilityCatalogSnapshot;
  readonly contributions?: readonly CapabilityCatalogContribution[];
  readonly evaluatedAt: string;
  readonly projectId: string;
  readonly appId: string;
  readonly surfaceId: string;
  readonly caller: CapabilityCallerId;
  readonly materializations: readonly RuntimeCapabilityMaterializationRecord[];
}

/**
 * Immutable-input factory for one or more replay-identical Runtime
 * capability generations. No mutable registry or process-wide catalog exists.
 */
export class RuntimeCapabilityCompositionFactory {
  private readonly catalog: CapabilityCatalogSnapshot;
  private readonly evaluatedAt: string;
  private readonly scope: RuntimeCapabilityCompositionScope;
  private readonly records: readonly InternalMaterialization[];

  public constructor(input: RuntimeCapabilityCompositionFactoryInput) {
    this.evaluatedAt = canonicalInstant(input.evaluatedAt, "evaluatedAt");
    this.scope = normalizeScope(input);
    this.catalog = resolveCatalog(input);
    this.records = normalizeMaterializations(input.materializations, this.catalog);
    assertNoCollisions(this.records);
  }

  /** Build an immutable generation; repeated preparation has identical identity. */
  public prepare(): RuntimeCapabilityGeneration {
    return prepareGeneration(this.catalog, this.evaluatedAt, this.scope, this.records);
  }

  /** Explicit alias for callers that prefer the durable term. */
  public prepareGeneration(): RuntimeCapabilityGeneration {
    return this.prepare();
  }
}

export function createRuntimeCapabilityCompositionFactory(
  input: RuntimeCapabilityCompositionFactoryInput,
): RuntimeCapabilityCompositionFactory {
  return new RuntimeCapabilityCompositionFactory(input);
}

/** Creates the exact evidence link a Phase 3 authority owner must persist. */
export function createRuntimeCapabilityAuthorityAdmissionLink(input: {
  readonly generation: RuntimeCapabilityGeneration;
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle;
  readonly caller: CapabilityCallerId;
}): RuntimeCapabilityAuthorityAdmissionLinkage {
  const routeDigest = deriveAuthorityRouteDigest({
    admittedAt: input.authorityAdmission.admittedAt,
    execution: input.authorityAdmission.turn.execution,
  });
  if (input.generation.isInvalidated()) throw new TypeError("Capability generation is invalidated.");
  if (input.caller !== input.generation.scope.caller) throw new TypeError("Capability authority linkage caller contradicts generation scope.");
  const admittedAt = canonicalInstant(input.authorityAdmission.admittedAt, "authorityAdmission.admittedAt");
  if (Date.parse(admittedAt) < Date.parse(input.generation.evaluatedAt)
    || Date.parse(admittedAt) >= Date.parse(input.generation.validUntil)) {
    throw new TypeError("Capability authority admission time is outside the generation freshness window.");
  }
  const body: Omit<RuntimeCapabilityAuthorityAdmissionLinkage, "evidenceDigest"> = {
    schemaRevision: 1,
    status: "generation-linked",
    generationId: input.generation.generationId,
    catalogDigest: input.generation.catalogDigest,
    candidateProjectionDigest: input.generation.candidateProjectionDigest,
    routeDigest,
    surfaceDigest: input.generation.scope.surfaceDigest,
    caller: input.caller,
  };
  return Object.freeze({
    ...body,
    evidenceDigest: digestCanonical(body),
  });
}

/**
 * Attaches generation evidence to an already-composed authority bundle. The
 * returned bundle is a new immutable content identity; no permission facet is
 * recalculated or widened by this operation.
 */
export function linkEffectiveAuthorityAdmissionBundleToRuntimeCapabilityGeneration(input: {
  readonly generation: RuntimeCapabilityGeneration;
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle;
  readonly caller?: CapabilityCallerId;
}): EffectiveAuthorityAdmissionBundle {
  const linkage = createRuntimeCapabilityAuthorityAdmissionLink({
    generation: input.generation,
    authorityAdmission: input.authorityAdmission,
    caller: input.caller ?? input.generation.scope.caller,
  });
  return defineEffectiveAuthorityAdmissionBundle({
    ...input.authorityAdmission,
    turn: {
      ...input.authorityAdmission.turn,
      capabilityParticipation: linkage,
    },
  });
}

/** Returns the exact public candidate projection for coordinator admission. */
export function createRuntimeCapabilityAuthorityCandidateProjection(
  generation: RuntimeCapabilityGeneration,
): RuntimeCapabilityAuthorityCandidateProjection {
  return generation.authorityCandidateProjection;
}

/**
 * Binds the already-prepared public candidate projection to the routed turn.
 * This creates evidence only; permission decisions remain owned by the bundle.
 */
export function createCapabilityParticipationForAuthorityProjection(input: {
  readonly projection: RuntimeCapabilityAuthorityCandidateProjection;
  readonly admittedAt: string;
  readonly execution: EffectiveAuthorityAdmissionBundle["turn"]["execution"];
}): RuntimeCapabilityAuthorityAdmissionLinkage {
  const projection = assertRuntimeCapabilityAuthorityCandidateProjection(input.projection);
  const routeDigest = deriveAuthorityRouteDigest({
    admittedAt: input.admittedAt,
    execution: input.execution,
  });
  const body: Omit<RuntimeCapabilityAuthorityAdmissionLinkage, "evidenceDigest"> = {
    schemaRevision: 1,
    status: "generation-linked",
    generationId: projection.generationId,
    catalogDigest: projection.catalogDigest,
    candidateProjectionDigest: projection.candidateProjectionDigest,
    routeDigest,
    surfaceDigest: projection.surfaceDigest,
    caller: projection.caller,
  };
  return Object.freeze({ ...body, evidenceDigest: digestCanonical(body) });
}

/**
 * Revalidates the authority-facing projection at the coordinator boundary.
 * This intentionally rejects private materialization fields even when a
 * caller supplies a structurally plausible object.
 */
export function assertRuntimeCapabilityAuthorityCandidateProjection(
  value: unknown,
): RuntimeCapabilityAuthorityCandidateProjection {
  if (!isPlainRecord(value)
    || !isDigest(value.generationId)
    || !isDigest(value.catalogDigest)
    || !isDigest(value.candidateProjectionDigest)
    || !isDigest(value.surfaceDigest)
    || !isCapabilityCaller(value.caller)
    || !Array.isArray(value.discoveryToolNames)
    || value.discoveryToolNames.length !== 2
    || value.discoveryToolNames[0] !== CAPABILITY_SEARCH_TOOL_NAME
    || value.discoveryToolNames[1] !== CAPABILITY_DESCRIBE_TOOL_NAME
    || !Array.isArray(value.candidates)) {
    throw new TypeError("Capability authority candidate projection is malformed.");
  }
  for (const candidate of value.candidates) {
    if (!isPlainRecord(candidate)
      || "implementationReferences" in candidate
      || "implementationReference" in candidate
      || "tool" in candidate
      || "executor" in candidate
      || "inputSchema" in candidate
      || "outputSchema" in candidate
      || typeof candidate.capabilityId !== "string"
      || typeof candidate.revision !== "string"
      || typeof candidate.descriptorDigest !== "string"
      || (candidate.toolName !== undefined && typeof candidate.toolName !== "string")) {
      throw new TypeError("Capability authority candidate projection contains private or malformed materialization data.");
    }
  }
  const surface = {
    discoveryToolNames: value.discoveryToolNames,
    candidates: value.candidates,
  };
  if (digestCanonical(surface) !== value.candidateProjectionDigest) {
    throw new TypeError("Capability authority candidate projection digest does not match its content.");
  }
  return deepFreeze(clonePlain(value)) as unknown as RuntimeCapabilityAuthorityCandidateProjection;
}

/**
 * Stable identity for the public ToolDefinition replay surface. Runtime
 * admission uses this identity when an existing tool name competes with a
 * selected capability materialization.
 */
export function runtimeCapabilityToolDefinitionDigest(tool: ToolDefinition): Sha256Digest {
  return digestCanonical(toolReplaySurface(normalizeToolDefinition(tool)));
}

function resolveCatalog(input: RuntimeCapabilityCompositionFactoryInput): CapabilityCatalogSnapshot {
  if ((input.catalog === undefined) === (input.contributions === undefined)) {
    throw new TypeError("Runtime capability composition requires exactly one Core catalog source.");
  }
  if (input.catalog !== undefined) return assertCapabilityCatalogSnapshot(input.catalog);
  const contributions = input.contributions;
  if (contributions === undefined || !Array.isArray(contributions)) {
    throw new TypeError("Runtime capability contributions must be an array.");
  }
  contributions.forEach(assertCapabilityCatalogContribution);
  return buildAggregateCapabilityCatalog(contributions, input.evaluatedAt);
}

interface InternalMaterialization {
  readonly key: string;
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptor: CapabilityDescriptor;
  readonly descriptorDigest: Sha256Digest;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly implementationReference: CapabilityImplementationReference;
  readonly toolName: string;
  readonly tool: ToolDefinition;
  readonly executor: RuntimeCapabilityExecutor;
  readonly requirements: RuntimeCapabilityMaterializationRequirements;
  readonly freshness: RuntimeCapabilityFreshnessGuard;
}

function normalizeMaterializations(
  values: readonly RuntimeCapabilityMaterializationRecord[],
  catalog: CapabilityCatalogSnapshot,
): readonly InternalMaterialization[] {
  if (!Array.isArray(values)) throw new TypeError("Runtime capability materializations must be an array.");
  const normalized = values.map((value, index) => normalizeMaterialization(value, catalog, index));
  return Object.freeze(normalized);
}

function normalizeMaterialization(
  value: RuntimeCapabilityMaterializationRecord,
  catalog: CapabilityCatalogSnapshot,
  index: number,
): InternalMaterialization {
  if (!isPlainRecord(value)) throw new TypeError(`Capability materialization[${index}] must be a plain record.`);
  const descriptor = catalog.descriptors.find((candidate) =>
    candidate.capabilityId === value.capabilityId && candidate.revision === value.revision);
  if (!descriptor || descriptor.descriptorDigest !== value.descriptorDigest) {
    throw new TypeError("Capability materialization must bind an exact Core descriptor identity and digest.");
  }
  if (!isDigest(value.inputSchemaDigest) || !isDigest(value.outputSchemaDigest)
    || !isDigest(value.implementationIdentityDigest)) {
    throw new TypeError("Capability materialization must carry canonical schema and implementation digests.");
  }
  const tool = normalizeToolDefinition(value.tool);
  const actualInput = schemaDigest(tool.inputSchema, "input");
  const actualOutput = schemaDigest(tool.outputSchema, "output");
  if (actualInput !== value.inputSchemaDigest || actualInput !== descriptor.inputSchemaDigest
    || actualOutput !== value.outputSchemaDigest || actualOutput !== descriptor.outputSchemaDigest) {
    throw new TypeError("Capability materialization actual schema digest does not match Core declaration.");
  }
  if (typeof value.executor !== "function") {
    throw new TypeError("Capability materialization executor must be a process-local function.");
  }
  if (value.toolName !== tool.name || value.toolName.trim().length === 0) {
    throw new TypeError("Capability materialization tool identity must match its ToolDefinition.");
  }
  const implementationReference = normalizeImplementationReference(value.implementationReference);
  if (value.implementationIdentityDigest !== implementationReference.identityDigest
    || implementationReference.inputSchemaDigest !== actualInput
    || implementationReference.outputSchemaDigest !== actualOutput) {
    throw new TypeError("Capability materialization implementation identity or schema pair contradicts the actual tool.");
  }
  const declaredReference = descriptor.implementationReferences.find((reference) =>
    sameImplementationReference(reference, implementationReference));
  if (!declaredReference) {
    throw new TypeError("Capability materialization implementation reference is not declared by Core.");
  }
  const requirements = normalizeRequirements(value.requirements, descriptor);
  const freshness = normalizeFreshnessGuard(value.freshness, descriptor.freshness);
  return Object.freeze({
    key: capabilityIdentityKey(value.capabilityId, value.revision),
    capabilityId: value.capabilityId,
    revision: value.revision,
    descriptor,
    descriptorDigest: descriptor.descriptorDigest,
    inputSchemaDigest: actualInput,
    outputSchemaDigest: actualOutput,
    implementationIdentityDigest: implementationReference.identityDigest,
    implementationReference,
    toolName: value.toolName,
    tool,
    executor: value.executor,
    requirements,
    freshness,
  });
}

function normalizeRequirements(
  value: RuntimeCapabilityMaterializationRequirements,
  descriptor: CapabilityDescriptor,
): RuntimeCapabilityMaterializationRequirements {
  if (!isPlainRecord(value)) throw new TypeError("Capability materialization requirements must be a plain record.");
  const data = normalizeDataPosture(value.data);
  const network = normalizeNetworkPosture(value.network);
  const artifacts = normalizeArtifacts(value.artifacts);
  if (!sameCanonical(data, descriptor.data) || network !== descriptor.network
    || !sameCanonical(artifacts, descriptor.artifacts)) {
    throw new TypeError("Capability materialization private requirements contradict the Core descriptor.");
  }
  const budget = value.budget === undefined ? undefined : normalizeRequirementStatus(value.budget, "budget");
  return Object.freeze({
    data,
    network,
    artifacts,
    ...(budget === undefined ? {} : { budget }),
  });
}

function normalizeFreshnessGuard(
  value: RuntimeCapabilityFreshnessGuard,
  descriptor: CapabilityFreshness,
): RuntimeCapabilityFreshnessGuard {
  if (!isPlainRecord(value)) throw new TypeError("Capability materialization freshness guard must be a plain record.");
  const observedAt = canonicalInstant(value.observedAt, "materialization.freshness.observedAt");
  const validUntil = canonicalInstant(value.validUntil, "materialization.freshness.validUntil");
  if (Date.parse(observedAt) >= Date.parse(validUntil) || value.status !== "available" && value.status !== "unavailable"
    || value.status !== descriptor.status) {
    throw new TypeError("Capability materialization freshness guard is contradictory.");
  }
  if (Date.parse(observedAt) < Date.parse(descriptor.observedAt)
    || Date.parse(validUntil) > Date.parse(descriptor.validUntil)) {
    throw new TypeError("Capability materialization freshness guard exceeds Core freshness evidence.");
  }
  if (value.revocationGuard !== undefined && typeof value.revocationGuard !== "function") {
    throw new TypeError("Capability materialization revocation guard must be a function.");
  }
  return Object.freeze({
    observedAt,
    validUntil,
    status: value.status,
    ...(value.revocationGuard === undefined ? {} : { revocationGuard: value.revocationGuard }),
  });
}

function assertNoCollisions(values: readonly InternalMaterialization[]): void {
  const identityKeys = new Set<string>();
  const toolNames = new Set<string>([CAPABILITY_SEARCH_TOOL_NAME, CAPABILITY_DESCRIBE_TOOL_NAME]);
  const implementations = new Set<Sha256Digest>();
  for (const value of values) {
    if (identityKeys.has(value.key)) throw new TypeError("Capability materialization contains a duplicate descriptor identity.");
    identityKeys.add(value.key);
    if (toolNames.has(value.toolName)) throw new TypeError("Capability materialization shadows a reserved or duplicate tool name.");
    toolNames.add(value.toolName);
    if (implementations.has(value.implementationIdentityDigest)) {
      throw new TypeError("Capability materialization contains a colliding implementation identity.");
    }
    implementations.add(value.implementationIdentityDigest);
  }
}

function prepareGeneration(
  catalog: CapabilityCatalogSnapshot,
  evaluatedAt: string,
  scope: RuntimeCapabilityCompositionScope,
  records: readonly InternalMaterialization[],
): RuntimeCapabilityGeneration {
  const recordByKey = new Map(records.map((record): readonly [string, InternalMaterialization] => [record.key, record]));
  const authorityCandidates = Object.freeze(catalog.descriptors.map((descriptor) => {
    const record = recordByKey.get(capabilityIdentityKey(descriptor.capabilityId, descriptor.revision));
    return projectAuthorityCandidate(descriptor, record);
  }));
  const discoveryToolNames = Object.freeze([
    CAPABILITY_SEARCH_TOOL_NAME,
    CAPABILITY_DESCRIBE_TOOL_NAME,
  ] as const);
  const candidateProjectionSurface = {
    discoveryToolNames,
    candidates: authorityCandidates,
  } as const;
  const candidateProjectionDigest = digestCanonical(candidateProjectionSurface);
  const materializationSurface = Object.freeze(records.map((record) => ({
    capabilityId: record.capabilityId,
    revision: record.revision,
    descriptorDigest: record.descriptorDigest,
    inputSchemaDigest: record.inputSchemaDigest,
    outputSchemaDigest: record.outputSchemaDigest,
    implementationIdentityDigest: record.implementationIdentityDigest,
    implementationReference: record.implementationReference,
    toolName: record.toolName,
    tool: toolReplaySurface(record.tool),
    requirements: record.requirements,
    freshness: {
      observedAt: record.freshness.observedAt,
      validUntil: record.freshness.validUntil,
      status: record.freshness.status,
    },
  })));
  const materializationDigest = digestCanonical(materializationSurface);
  const firstDescriptor = catalog.descriptors[0];
  const descriptorValidUntil = firstDescriptor === undefined
    ? evaluatedAt
    : catalog.descriptors.slice(1).reduce((latest, descriptor) =>
      Date.parse(descriptor.freshness.validUntil) < Date.parse(latest) ? descriptor.freshness.validUntil : latest,
    firstDescriptor.freshness.validUntil);
  const validUntil = records.reduce((latest, record) =>
    Date.parse(record.freshness.validUntil) < Date.parse(latest) ? record.freshness.validUntil : latest,
  descriptorValidUntil);
  const generationIdentity = {
    catalogDigest: catalog.catalogDigest,
    evaluatedAt,
    validUntil,
    scope,
    materializationDigest,
    candidateProjectionDigest,
    discoveryTools: RUNTIME_CAPABILITY_DISCOVERY_TOOLS_REPLAY_SURFACE,
  };
  const generationId = digestCanonical(generationIdentity);
  const completeAuthorityCandidateProjection: RuntimeCapabilityAuthorityCandidateProjection = Object.freeze({
    generationId,
    catalogDigest: catalog.catalogDigest,
    candidateProjectionDigest,
    surfaceDigest: scope.surfaceDigest,
    caller: scope.caller,
    discoveryToolNames,
    candidates: authorityCandidates,
  });
  let invalidated = false;
  const generation: RuntimeCapabilityGeneration = {
    generationId,
    catalogDigest: catalog.catalogDigest,
    evaluatedAt,
    validUntil,
    scope,
    materializationDigest,
    candidateProjectionDigest,
    discoveryTools: RUNTIME_CAPABILITY_DISCOVERY_TOOLS,
    authorityCandidates,
    authorityCandidateProjection: completeAuthorityCandidateProjection,
    isInvalidated: () => invalidated,
    invalidate: () => {
      invalidated = true;
    },
    bindToExistingEffectiveAuthorityAdmissionBundle: (input) => bindGeneration(
      generation,
      catalog,
      records,
      input,
    ),
  };
  return Object.freeze(generation);
}

const RUNTIME_CAPABILITY_DISCOVERY_TOOLS_REPLAY_SURFACE = Object.freeze(
  RUNTIME_CAPABILITY_DISCOVERY_TOOLS.map(toolReplaySurface),
);

function projectAuthorityCandidate(
  descriptor: CapabilityDescriptor,
  record: InternalMaterialization | undefined,
): RuntimeCapabilityAuthorityCandidate {
  const retention: RuntimeCapabilityRequirementStatus = descriptor.data.retention === "none"
    ? { status: "not-required" }
    : { status: "unresolved", reason: "retention-authority-not-configured" };
  const artifactStatus: Pick<RuntimeCapabilityAuthorityCandidateRequirements["artifacts"], "status" | "reason"> = descriptor.artifacts.length === 0
    || descriptor.data.retention === "none"
    ? { status: "not-required" }
    : { status: "unresolved", reason: "artifact-authority-not-configured" };
  const budget: RuntimeCapabilityRequirementStatus = record?.requirements.budget
    ?? { status: "not-required" };
  const unresolvedRequirement = retention.status === "unresolved"
    || artifactStatus.status === "unresolved"
    || budget.status === "unresolved";
  const materializationStatus: RuntimeCapabilityMaterializationStatus = record === undefined
    ? "not-materializable"
    : record.freshness.status !== "available"
      ? "unavailable"
      : unresolvedRequirement ? "not-materializable" : "materializable";
  return Object.freeze({
    ...discloseDescriptor(descriptor),
    candidateAuthority: cloneAuthority(deriveAuthorityFromEffect(descriptor.effect)),
    materializationStatus,
    ...(record === undefined ? {} : { toolName: record.toolName }),
    requirements: Object.freeze({
      data: cloneDataPosture(descriptor.data),
      network: descriptor.network,
      artifacts: Object.freeze({
        ...artifactStatus,
       declarations: Object.freeze(descriptor.artifacts.map(cloneArtifactDeclaration)),
      }),
      retention: Object.freeze(retention),
      budget: Object.freeze(budget),
    }),
  });
}

function bindGeneration(
  generation: RuntimeCapabilityGeneration,
  catalog: CapabilityCatalogSnapshot,
  records: readonly InternalMaterialization[],
  input: RuntimeCapabilityAuthorityAdmissionBindingInput,
): RuntimeCapabilityTurnBinding {
  assertBindingLinkage(generation, input);
  const routeDigest = routeDigestForAuthority(input.authorityAdmission);
  const linkage = input.authorityAdmission.turn.capabilityParticipation;
  if (linkage.status !== "generation-linked" || routeDigest !== linkage.routeDigest) {
    throw new TypeError("Capability authority linkage route evidence contradicts the admission bundle.");
  }
  if (generation.isInvalidated()) throw new TypeError("Capability generation is invalidated.");
  const evaluatedAt = canonicalInstant(input.authorityAdmission.admittedAt, "authorityAdmission.admittedAt");
  if (Date.parse(evaluatedAt) < Date.parse(generation.evaluatedAt)
    || Date.parse(evaluatedAt) >= Date.parse(generation.validUntil)) {
    throw new TypeError("Capability authority admission time is outside the generation freshness window.");
  }
  const recordByKey = new Map(records.map((record): readonly [string, InternalMaterialization] => [record.key, record]));
  const selectionCache = new Map<string, RuntimeCapabilityMaterializedTool>();
  const scope: RuntimeCapabilitySelectionScope = Object.freeze({
    generationId: generation.generationId,
    routeDigest,
    surfaceDigest: generation.scope.surfaceDigest,
    authorityAdmissionId: input.authorityAdmission.admissionId,
  });
  const materialize = (selector: RuntimeCapabilityDescribeSelector): RuntimeCapabilityMaterializedTool | undefined => {
    const parsedSelector = normalizeMaterializeSelector(selector, generation, evaluatedAt);
    if (parsedSelector === undefined) return undefined;
    if (!isGenerationUsable(generation, evaluatedAt)) return undefined;
    const record = recordByKey.get(capabilityIdentityKey(parsedSelector.capabilityId, parsedSelector.revision));
    if (!record || !isRecordUsable(record, evaluatedAt)) return undefined;
    const descriptor = record.descriptor;
    if (parsedSelector.descriptorDigest !== undefined && parsedSelector.descriptorDigest !== descriptor.descriptorDigest) return undefined;
    if (!isAuthorized(input.authorityAdmission, record, descriptor, generation.scope.caller)) return undefined;
    const cached = selectionCache.get(record.key);
    if (cached) return cached;
    const selected: RuntimeCapabilityMaterializedTool = Object.freeze({
      capabilityId: record.capabilityId,
      revision: record.revision,
      descriptorDigest: record.descriptorDigest,
      tool: record.tool,
      invoke: async (toolInput: Record<string, unknown>) => {
        if (!isGenerationUsable(generation, evaluatedAt)
          || !isRecordUsable(record, evaluatedAt)
          || !isAuthorized(input.authorityAdmission, record, descriptor, generation.scope.caller)) {
          return {
            output: "Capability materialization is stale, revoked, or outside current authority.",
            isError: true,
            metadata: Object.freeze({
              kind: "capability",
              operation: "invoke",
              decision: "outside-authority",
              generationId: generation.generationId,
            }),
          };
        }
        return record.executor(toolInput);
      },
    });
    selectionCache.set(record.key, selected);
    return selected;
  };
  const search = (selector: unknown): RuntimeCapabilitySearchResult => {
    const request = normalizeSearchSelector(selector, generation, evaluatedAt);
    const core = capabilitySearch(catalog, request);
    const descriptors = isGenerationUsable(generation, request.evaluatedAt)
      ? core.descriptors.filter((descriptor) => {
        const record = recordByKey.get(capabilityIdentityKey(descriptor.capabilityId, descriptor.revision));
        return record !== undefined && isRecordUsable(record, request.evaluatedAt)
          && isAuthorized(input.authorityAdmission, record, record.descriptor, generation.scope.caller);
      })
      : [];
    const evidence = runtimeEvidence(core.evidence, descriptors, scope, descriptors.length > 0 ? "selected" : "no-match");
    return Object.freeze({
      contract: core.contract,
      operation: core.operation,
      catalogDigest: core.catalogDigest,
      observedAt: core.observedAt,
      totalEligible: descriptors.length,
      matched: descriptors.length,
      descriptors: Object.freeze(descriptors),
      evidence,
      scope,
    });
  };
  const describe = (selector: unknown): RuntimeCapabilityDescribeResult => {
    const request = normalizeDescribeSelector(selector, generation, evaluatedAt);
    const core = capabilityDescribe(catalog, request);
    let decision: RuntimeCapabilityDescribeDecision = core.decision;
    const descriptor = core.descriptor;
    if (decision === "selected" && descriptor !== undefined) {
      const record = recordByKey.get(capabilityIdentityKey(descriptor.capabilityId, descriptor.revision));
      if (!isGenerationUsable(generation, request.evaluatedAt) || !record || !isRecordUsable(record, request.evaluatedAt)) {
        decision = "stale";
      } else if (!isAuthorized(input.authorityAdmission, record, record.descriptor, generation.scope.caller)) {
        decision = "outside-authority";
      }
    }
    const selectedDescriptor = decision === "selected" ? descriptor : undefined;
    const selected = selectedDescriptor === undefined ? undefined : materialize({
      capabilityId: selectedDescriptor.capabilityId,
      revision: selectedDescriptor.revision,
      descriptorDigest: selectedDescriptor.descriptorDigest,
    });
    if (decision === "selected" && !selected) decision = "outside-authority";
    const evidence = runtimeEvidence(
      core.evidence,
      selectedDescriptor === undefined || decision !== "selected" ? [] : [selectedDescriptor],
      scope,
      decision,
      selected?.tool.name,
    );
    return Object.freeze({
      contract: core.contract,
      operation: core.operation,
      catalogDigest: core.catalogDigest,
      observedAt: core.observedAt,
      decision,
      ...(selectedDescriptor === undefined || decision !== "selected" ? {} : { descriptor: selectedDescriptor }),
      ...(selected === undefined || decision !== "selected" ? {} : { tool: selected.tool }),
      evidence,
      scope,
    });
  };
  const createDiscoveryToolExecutors = (): ReadonlyMap<string, RuntimeCapabilityToolExecutor> => immutableReadonlyMap<string, RuntimeCapabilityToolExecutor>([
    [CAPABILITY_SEARCH_TOOL_NAME, async (toolInput) => {
      const result = search(toolInput);
      const metadata: RuntimeCapabilitySearchExecutionMetadata = {
        kind: "capability",
        operation: "search",
        contract: CAPABILITY_SEARCH_CONTRACT,
        generationId: generation.generationId,
        caller: generation.scope.caller,
         evaluatedAt,
        decision: result.evidence.decision === "selected" ? "selected" : "no-match",
        evidence: result.evidence,
      };
      return {
        output: stableSerialize({
          contract: result.contract,
          operation: result.operation,
          catalogDigest: result.catalogDigest,
          observedAt: result.observedAt,
          totalEligible: result.totalEligible,
          matched: result.matched,
          descriptors: result.descriptors,
          evidence: result.evidence,
          scope: result.scope,
        }),
        isError: false,
        metadata: Object.freeze({ ...metadata }),
      };
    }],
    [CAPABILITY_DESCRIBE_TOOL_NAME, async (toolInput) => {
      const request = normalizeDescribeSelector(toolInput, generation, evaluatedAt);
      const result = describe(request);
      const metadata: RuntimeCapabilityDescribeExecutionMetadata = {
        kind: "capability",
        operation: "describe",
        contract: CAPABILITY_DESCRIBE_CONTRACT,
        generationId: generation.generationId,
        caller: generation.scope.caller,
         evaluatedAt,
        capabilityId: request.capabilityId,
        revision: request.revision,
        ...(request.descriptorDigest === undefined ? {} : { descriptorDigest: request.descriptorDigest }),
        decision: result.decision,
        evidence: result.evidence,
      };
      return {
        output: stableSerialize({
          contract: result.contract,
          operation: result.operation,
          catalogDigest: result.catalogDigest,
          observedAt: result.observedAt,
          decision: result.decision,
          ...(result.descriptor === undefined ? {} : { descriptor: result.descriptor }),
          evidence: result.evidence,
          scope: result.scope,
        }),
        isError: result.decision !== "selected",
        metadata: Object.freeze({ ...metadata }),
      };
    }],
  ]);
  const binding: RuntimeCapabilityTurnBinding = {
    generationId: generation.generationId,
    catalogDigest: generation.catalogDigest,
    candidateProjectionDigest: generation.candidateProjectionDigest,
    evaluatedAt,
    validUntil: generation.validUntil,
    scope: generation.scope,
    routeDigest,
    surfaceDigest: generation.scope.surfaceDigest,
    authorityAdmissionId: input.authorityAdmission.admissionId,
    caller: generation.scope.caller,
    discoveryTools: generation.discoveryTools,
    authorityCandidates: generation.authorityCandidates,
    search,
    describe,
    materialize,
    createDiscoveryToolExecutors,
  };
  return Object.freeze(binding);
}

/** Parses only metadata emitted by the canonical describe executor. */
export function readRuntimeCapabilityDescribeExecutionMetadata(
  value: unknown,
): RuntimeCapabilityDescribeExecutionMetadata | undefined {
  if (!isPlainRecord(value)
    || value.kind !== "capability"
    || value.operation !== "describe"
    || value.contract !== CAPABILITY_DESCRIBE_CONTRACT
    || !isDigest(value.generationId)
    || !isCapabilityCaller(value.caller)
    || canonicalInstantOrUndefined(value.evaluatedAt) === undefined
    || typeof value.capabilityId !== "string"
    || typeof value.revision !== "string"
    || !isRuntimeCapabilityDescribeDecision(value.decision)) {
    return undefined;
  }
  const evaluatedAt = canonicalInstantOrUndefined(value.evaluatedAt);
  if (evaluatedAt === undefined) return undefined;
  const descriptorDigest = value.descriptorDigest === undefined
    ? undefined
    : isDigest(value.descriptorDigest) ? value.descriptorDigest : undefined;
  if (value.descriptorDigest !== undefined && descriptorDigest === undefined) return undefined;
  const evidence = readRuntimeCapabilityEvidence(value.evidence);
  if (evidence === undefined || evidence.decision !== value.decision) return undefined;
  return {
    kind: "capability",
    operation: "describe",
    contract: CAPABILITY_DESCRIBE_CONTRACT,
    generationId: value.generationId,
    caller: value.caller,
    evaluatedAt,
    capabilityId: value.capabilityId,
    revision: value.revision,
    ...(descriptorDigest === undefined ? {} : { descriptorDigest }),
    decision: value.decision,
    evidence,
  };
}

function assertBindingLinkage(
  generation: RuntimeCapabilityGeneration,
  input: RuntimeCapabilityAuthorityAdmissionBindingInput,
): void {
  if (!isPlainRecord(input) || !isPlainRecord(input.authorityAdmission)) {
    throw new TypeError("Capability authority binding requires an explicit generation linkage and admission evidence.");
  }
  const authorityAdmission = assertPersistableAuthorityAdmissionBundle(input.authorityAdmission);
  const embedded = authorityAdmission.turn.capabilityParticipation;
  const linkage = embedded;
  if (!isPlainRecord(linkage)) {
    throw new TypeError("Capability authority binding requires generation-linked capability participation in the admission.");
  }
  if (linkage.status !== "generation-linked"
    || linkage.schemaRevision !== 1
    || !isDigest(linkage.generationId)
    || !isDigest(linkage.catalogDigest)
    || !isDigest(linkage.candidateProjectionDigest)
    || !isDigest(linkage.routeDigest)
    || !isDigest(linkage.surfaceDigest)
    || !isCapabilityCaller(linkage.caller)
    || !isDigest(linkage.evidenceDigest)) {
    throw new TypeError("Capability authority binding linkage is missing canonical evidence.");
  }
  const expectedBody: Omit<RuntimeCapabilityAuthorityAdmissionLinkage, "evidenceDigest"> = {
    schemaRevision: 1,
    status: "generation-linked",
    generationId: generation.generationId,
    catalogDigest: generation.catalogDigest,
    candidateProjectionDigest: generation.candidateProjectionDigest,
    routeDigest: linkage.routeDigest,
    surfaceDigest: generation.scope.surfaceDigest,
    caller: generation.scope.caller,
  };
  if (embedded.status !== "generation-linked"
    || stableSerialize(embedded) !== stableSerialize(linkage)
    || linkage.generationId !== generation.generationId
    || linkage.catalogDigest !== generation.catalogDigest
    || linkage.candidateProjectionDigest !== generation.candidateProjectionDigest
    || linkage.surfaceDigest !== generation.scope.surfaceDigest
    || linkage.caller !== generation.scope.caller
    || linkage.evidenceDigest !== digestCanonical(expectedBody)) {
    throw new TypeError("Capability authority binding linkage contradicts generation, surface, caller, or admission.");
  }
  const routeDigest = routeDigestForAuthority(authorityAdmission);
  if (linkage.routeDigest !== routeDigest) {
    throw new TypeError("Capability authority binding linkage route evidence contradicts the admission bundle.");
  }
}

function isAuthorized(
  authorityAdmission: EffectiveAuthorityAdmissionBundle,
  record: InternalMaterialization,
  descriptor: CapabilityDescriptor,
  caller: CapabilityCallerId,
): boolean {
  if (!descriptor.supportedCallers.includes(caller)) return false;
  const permission = authorityAdmission.turn.tools.allowedToolPermissions.find((entry) => entry.toolName === record.toolName);
  if (!permission || !permission.authority.allowed || !isValidNarrowing(descriptor.effect, permission.effectEnvelope)) return false;
  if (!isDataPostureAdmitted(descriptor.data, authorityAdmission)) return false;
  if (!isNetworkPostureAdmitted(descriptor.network, authorityAdmission.turn.tools.hostEnforcement?.netPolicy)) return false;
  const requirements = authorityRequirements(record, descriptor);
  return requirements.retention.status === "not-required"
    && requirements.budget.status === "not-required"
    && requirements.artifacts.status === "not-required";
}

function authorityRequirements(
  record: InternalMaterialization,
  descriptor: CapabilityDescriptor,
): RuntimeCapabilityAuthorityCandidateRequirements {
  const retention: RuntimeCapabilityRequirementStatus = descriptor.data.retention === "none"
    ? { status: "not-required" }
    : { status: "unresolved", reason: "retention-authority-not-configured" };
  const artifactStatus = descriptor.artifacts.length === 0
    ? { status: "not-required" as const }
    : { status: "unresolved" as const, reason: "artifact-authority-not-configured" as const };
  return {
    data: descriptor.data,
    network: descriptor.network,
    artifacts: {
      ...artifactStatus,
      declarations: descriptor.artifacts,
    },
    retention,
    budget: record.requirements.budget ?? { status: "not-required" },
  };
}

function isDataPostureAdmitted(
  data: CapabilityDataPosture,
  authorityAdmission: EffectiveAuthorityAdmissionBundle,
): boolean {
  const execution = authorityAdmission.turn.execution;
  if (execution.status !== "routed" || execution.dataPolicy.decision.status !== "admitted") return false;
  const maximum = execution.dataPolicy.evidence?.maximumClassification;
  if (!isExecutionDataClassification(maximum)) return false;
  const maximumIndex = EXECUTION_DATA_CLASSIFICATIONS.indexOf(maximum);
  return [data.input, data.output].every((classification) =>
    EXECUTION_DATA_CLASSIFICATIONS.indexOf(capabilityDataClassification(classification)) <= maximumIndex);
}

function isNetworkPostureAdmitted(requirement: CapabilityNetworkPosture, policy: NetPolicy | undefined): boolean {
  if (requirement === "none") return true;
  if (policy === undefined || policy === "none") return false;
  if (requirement === "open") return policy === "full";
  return policy === "package-managers" || policy === "documentation" || policy === "full";
}

function routeDigestForAuthority(authorityAdmission: EffectiveAuthorityAdmissionBundle): Sha256Digest {
  return deriveAuthorityRouteDigest({
    admittedAt: authorityAdmission.admittedAt,
    execution: authorityAdmission.turn.execution,
  });
}

function normalizeSearchSelector(
  selector: unknown,
  generation: RuntimeCapabilityGeneration,
  evaluatedAt = generation.evaluatedAt,
): CapabilitySearchRequest {
  if (!isPlainRecord(selector)) throw new TypeError("Capability search selector must be a plain record.");
  const query = selector.query;
  if (query !== undefined && typeof query !== "string") {
    throw new TypeError("Capability search selector query must be a string.");
  }
  const capabilityId = selector.capabilityId;
  if (capabilityId !== undefined && typeof capabilityId !== "string") {
    throw new TypeError("Capability search selector capabilityId must be a string.");
  }
  const kind = selector.kind;
  if (kind !== undefined && !isCapabilityKind(kind)) {
    throw new TypeError("Capability search selector kind is not supported.");
  }
  const limit = selector.limit;
  if (limit !== undefined && (typeof limit !== "number" || !Number.isSafeInteger(limit))) {
    throw new TypeError("Capability search selector limit must be a safe integer.");
  }
  return {
    caller: generation.scope.caller,
    evaluatedAt,
    ...(query === undefined ? {} : { query }),
    ...(capabilityId === undefined ? {} : { capabilityId }),
    ...(kind === undefined ? {} : { kind }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function normalizeDescribeSelector(
  selector: unknown,
  generation: RuntimeCapabilityGeneration,
  evaluatedAt = generation.evaluatedAt,
): CapabilityDescribeRequest {
  if (!isPlainRecord(selector)) throw new TypeError("Capability describe selector must be a plain record.");
  const capabilityId = selector.capabilityId;
  const revision = selector.revision;
  if (typeof capabilityId !== "string" || typeof revision !== "string") {
    throw new TypeError("Capability describe selector requires capabilityId and revision strings.");
  }
  const descriptorDigest = selector.descriptorDigest;
  if (descriptorDigest !== undefined && !isDigest(descriptorDigest)) {
    throw new TypeError("Capability describe selector descriptorDigest is malformed.");
  }
  return {
    caller: generation.scope.caller,
    evaluatedAt,
    capabilityId,
    revision,
    ...(descriptorDigest === undefined ? {} : { descriptorDigest }),
  };
}

function normalizeMaterializeSelector(
  selector: unknown,
  generation: RuntimeCapabilityGeneration,
  evaluatedAt: string,
): RuntimeCapabilityDescribeSelector | undefined {
  try {
    const request = normalizeDescribeSelector(selector, generation, evaluatedAt);
    return {
      capabilityId: request.capabilityId,
      revision: request.revision,
      ...(request.descriptorDigest === undefined ? {} : { descriptorDigest: request.descriptorDigest }),
    };
  } catch {
    return undefined;
  }
}

function isGenerationUsable(generation: RuntimeCapabilityGeneration, evaluatedAt: string): boolean {
  return !generation.isInvalidated()
    && canonicalInstantOrUndefined(evaluatedAt) !== undefined
    && Date.parse(evaluatedAt) >= Date.parse(generation.evaluatedAt)
    && Date.parse(evaluatedAt) < Date.parse(generation.validUntil);
}

function isRecordUsable(record: InternalMaterialization, evaluatedAt: string): boolean {
  if (record.freshness.status !== "available"
    || canonicalInstantOrUndefined(evaluatedAt) === undefined
    || Date.parse(record.freshness.observedAt) > Date.parse(evaluatedAt)
    || Date.parse(record.freshness.validUntil) <= Date.parse(evaluatedAt)) {
    return false;
  }
  try {
    return !(record.freshness.revocationGuard?.() ?? false);
  } catch {
    return false;
  }
}

function runtimeEvidence(
  evidence: CapabilitySearchEvidence,
  descriptors: readonly CapabilityDescriptorDisclosure[],
  scope: RuntimeCapabilitySelectionScope,
  decision: RuntimeCapabilitySearchEvidence["decision"],
  materializedToolName?: string,
): RuntimeCapabilitySearchEvidence {
  return Object.freeze({
    ...evidence,
    decision,
    descriptorDigests: Object.freeze(descriptors.map((descriptor) => descriptor.descriptorDigest)),
    runtimeScope: scope,
    ...(materializedToolName === undefined ? {} : { materializedToolName }),
  });
}

function readRuntimeCapabilityEvidence(value: unknown): RuntimeCapabilitySearchEvidence | undefined {
  if (!isPlainRecord(value)
    || !isDigest(value.catalogDigest)
    || !isDigest(value.requestScopeDigest)
    || !isRuntimeCapabilityEvidenceDecision(value.decision)
    || !Array.isArray(value.descriptorDigests)
    || !value.descriptorDigests.every(isDigest)) {
    return undefined;
  }
  const runtimeScope = value.runtimeScope;
  if (!isPlainRecord(runtimeScope)
    || !isDigest(runtimeScope.generationId)
    || !isDigest(runtimeScope.routeDigest)
    || !isDigest(runtimeScope.surfaceDigest)
    || !isDigest(runtimeScope.authorityAdmissionId)) {
    return undefined;
  }
  if (value.materializedToolName !== undefined && typeof value.materializedToolName !== "string") {
    return undefined;
  }
  const contract = value.contract;
  if (contract !== CAPABILITY_SEARCH_CONTRACT && contract !== CAPABILITY_DESCRIBE_CONTRACT) {
    return undefined;
  }
  return Object.freeze({
    contract,
    catalogDigest: value.catalogDigest,
    requestScopeDigest: value.requestScopeDigest,
    decision: value.decision,
    descriptorDigests: Object.freeze([...value.descriptorDigests]),
    runtimeScope: Object.freeze({
      generationId: runtimeScope.generationId,
      routeDigest: runtimeScope.routeDigest,
      surfaceDigest: runtimeScope.surfaceDigest,
      authorityAdmissionId: runtimeScope.authorityAdmissionId,
    }),
    ...(value.materializedToolName === undefined ? {} : { materializedToolName: value.materializedToolName }),
  });
}

function discloseDescriptor(descriptor: CapabilityDescriptor): CapabilityDescriptorDisclosure {
  return Object.freeze({
    capabilityId: descriptor.capabilityId,
    revision: descriptor.revision,
    kind: descriptor.kind,
    owner: Object.freeze({ ...descriptor.owner }),
    inputSchemaDigest: descriptor.inputSchemaDigest,
    outputSchemaDigest: descriptor.outputSchemaDigest,
    artifacts: Object.freeze(descriptor.artifacts.map((artifact) => Object.freeze({ ...artifact }))),
    effect: Object.freeze({
      ...descriptor.effect,
      boundaries: Object.freeze([...descriptor.effect.boundaries]),
      consequences: Object.freeze([...descriptor.effect.consequences]),
    }),
    permissions: Object.freeze([...descriptor.permissions]),
    approval: descriptor.approval,
    network: descriptor.network,
    data: Object.freeze({ ...descriptor.data }),
    supportedCallers: Object.freeze([...descriptor.supportedCallers]),
    freshness: Object.freeze({ ...descriptor.freshness }),
    provenance: Object.freeze({ ...descriptor.provenance }),
    limits: Object.freeze({ ...descriptor.limits }),
    descriptorDigest: descriptor.descriptorDigest,
  });
}

function normalizeToolDefinition(input: RuntimeToolDefinitionInput): ToolDefinition {
  if (!isPlainRecord(input) || typeof input.name !== "string" || input.name.trim().length === 0
    || typeof input.description !== "string" || input.description.length > 16_384
    || containsSecret(input.name) || containsSecret(input.description)) {
    throw new TypeError("Capability materialization must contain a safe canonical ToolDefinition.");
  }
  const inputSchema = normalizeAndDigestCapabilityJsonSchema(input.inputSchema, "input", {
    requireObjectType: true,
  });
  if (!inputSchema.ok || !inputSchema.present) throw new TypeError("Capability ToolDefinition input schema is malformed.");
  const outputSchema = normalizeAndDigestCapabilityJsonSchema(input.outputSchema, "output", {
    present: input.outputSchema !== undefined,
  });
  if (!outputSchema.ok) throw new TypeError("Capability ToolDefinition output schema is malformed.");
  const tags = readTags(input.tags);
  return Object.freeze({
    name: input.name,
    description: input.description,
    inputSchema: deepFreeze(inputSchema.value),
    ...(outputSchema.present ? { outputSchema: deepFreeze(outputSchema.value) } : {}),
    ...(input.strict === true ? { strict: true as const } : {}),
    tags: immutableReadonlySet(tags),
  });
}

function schemaDigest(value: unknown, direction: "input" | "output"): Sha256Digest {
  const result = normalizeAndDigestCapabilityJsonSchema(value, direction, {
    // Core's absent-schema sentinel is part of the durable digest contract;
    // never turn an omitted output schema into an empty or forced schema.
    present: value !== undefined,
    ...(direction === "input" ? { requireObjectType: true } : {}),
  });
  if (!result.ok) throw new TypeError("Capability ToolDefinition schema cannot be canonicalized.");
  return result.digest;
}

function normalizeImplementationReference(value: unknown): CapabilityImplementationReference {
  if (!isPlainRecord(value) || !isDigest(value.identityDigest) || !isDigest(value.inputSchemaDigest)
    || !isDigest(value.outputSchemaDigest)
    || !isImplementationKind(value.kind)) {
    throw new TypeError("Capability implementation reference is malformed.");
  }
  return Object.freeze({
    identityDigest: value.identityDigest,
    kind: value.kind,
    inputSchemaDigest: value.inputSchemaDigest,
    outputSchemaDigest: value.outputSchemaDigest,
  });
}

function isImplementationKind(value: unknown): value is CapabilityImplementationKind {
  return value === "runtime-tool"
    || value === "provider-tool"
    || value === "harness-tool"
    || value === "agent";
}

function normalizeDataPosture(value: unknown): CapabilityDataPosture {
  if (!isPlainRecord(value) || !isCapabilityDataClassification(value.input)
    || !isCapabilityDataClassification(value.output)
    || !isCapabilityDataRetention(value.retention)) {
    throw new TypeError("Capability materialization data requirements are malformed.");
  }
  return Object.freeze({
    input: value.input,
    output: value.output,
    retention: value.retention,
  });
}

function isCapabilityDataClassification(value: unknown): value is CapabilityDataClassification {
  return value === "public" || value === "internal" || value === "sensitive";
}

function isCapabilityDataRetention(value: unknown): value is CapabilityRetention {
  return value === "none" || value === "ephemeral" || value === "persistent";
}

function cloneArtifactDeclaration(value: CapabilityArtifactDeclaration): CapabilityArtifactDeclaration {
  return Object.freeze({
    mediaType: value.mediaType,
    ...(value.schemaDigest === undefined ? {} : { schemaDigest: value.schemaDigest }),
  });
}

function cloneDataPosture(value: CapabilityDataPosture): CapabilityDataPosture {
  return Object.freeze({
    input: value.input,
    output: value.output,
    retention: value.retention,
  });
}

function cloneAuthority(value: AuthorityDescriptor): AuthorityDescriptor {
  return Object.freeze({
    level: value.level,
    allowed: value.allowed,
    requiresApproval: value.requiresApproval,
    reason: value.reason,
  });
}

function normalizeNetworkPosture(value: CapabilityNetworkPosture): CapabilityNetworkPosture {
  if (value !== "none" && value !== "restricted" && value !== "open") {
    throw new TypeError("Capability materialization network requirements are malformed.");
  }
  return value;
}

function normalizeArtifacts(value: readonly CapabilityArtifactDeclaration[]): readonly CapabilityArtifactDeclaration[] {
  if (!Array.isArray(value)) throw new TypeError("Capability materialization artifact requirements are malformed.");
  const artifacts = value.map((artifact) => {
    if (!isPlainRecord(artifact) || typeof artifact.mediaType !== "string" || artifact.mediaType.trim().length === 0
      || (artifact.schemaDigest !== undefined && !isDigest(artifact.schemaDigest))) {
      throw new TypeError("Capability materialization artifact requirements are malformed.");
    }
    return Object.freeze({
      mediaType: artifact.mediaType,
      ...(artifact.schemaDigest === undefined ? {} : { schemaDigest: artifact.schemaDigest }),
    });
  }).sort((left, right) => compareCodeUnits(stableSerialize(left), stableSerialize(right)));
  if (new Set(artifacts.map((artifact) => stableSerialize(artifact))).size !== artifacts.length) {
    throw new TypeError("Capability materialization artifact requirements contain duplicates.");
  }
  return Object.freeze(artifacts);
}

function normalizeRequirementStatus(
  value: unknown,
  dimension: "retention" | "budget" | "artifact",
): RuntimeCapabilityRequirementStatus {
  if (!isPlainRecord(value)) throw new TypeError("Capability materialization unresolved requirement is malformed.");
  if (value.status === "not-required") return Object.freeze({ status: "not-required" });
  const reason = `${dimension}-authority-not-configured` as const;
  if (value.status !== "unresolved" || value.reason !== reason) {
    throw new TypeError("Capability materialization unresolved requirement is malformed.");
  }
  return Object.freeze({ status: "unresolved", reason });
}

function canonicalInstant(value: unknown, label: string): string {
  const canonical = canonicalInstantOrUndefined(value);
  if (canonical === undefined) throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  return canonical;
}

function canonicalInstantOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) return undefined;
  return value;
}

function normalizeScope(input: RuntimeCapabilityCompositionFactoryInput): RuntimeCapabilityCompositionScope {
  const projectId = safeIdentifier(input.projectId, "projectId");
  const appId = safeIdentifier(input.appId, "appId");
  const surfaceId = safeIdentifier(input.surfaceId, "surfaceId");
  if (!isCapabilityCaller(input.caller)) throw new TypeError("Capability composition caller is not supported.");
  const surfaceDigest = digestCanonical({ projectId, appId, surfaceId, caller: input.caller });
  return Object.freeze({ projectId, appId, surfaceId, caller: input.caller, surfaceDigest });
}

function safeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u.test(value) || containsSecret(value)) {
    throw new TypeError(`Capability composition ${label} is malformed.`);
  }
  return value;
}

function toolReplaySurface(tool: ToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchemaDigest: schemaDigest(tool.inputSchema, "input"),
    outputSchemaDigest: tool.outputSchema === undefined ? undefined : schemaDigest(tool.outputSchema, "output"),
    strict: tool.strict === true ? true : undefined,
    tags: [...tool.tags].sort(compareCodeUnits),
  };
}

function sameImplementationReference(left: CapabilityImplementationReference, right: CapabilityImplementationReference): boolean {
  return left.identityDigest === right.identityDigest
    && left.kind === right.kind
    && left.inputSchemaDigest === right.inputSchemaDigest
    && left.outputSchemaDigest === right.outputSchemaDigest;
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
}

function capabilityIdentityKey(capabilityId: string, revision: string): string {
  return `${capabilityId}\u0000${revision}`;
}

function capabilityDataClassification(value: CapabilityDataClassification): ExecutionDataClassification {
  return value === "sensitive" ? "restricted" : value;
}

function isExecutionDataClassification(value: unknown): value is ExecutionDataClassification {
  return EXECUTION_DATA_CLASSIFICATIONS.includes(value as ExecutionDataClassification);
}

function isDigest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isCapabilityCaller(value: unknown): value is CapabilityCallerId {
  return typeof value === "string" && [
    "kiln-runtime", "kiln-cli", "kiln-gui", "kiln-tui", "kiln-sdk", "kiln-widget",
    "codex", "claude", "opencode-v2",
  ].includes(value);
}

function isCapabilityKind(value: unknown): value is NonNullable<CapabilitySearchRequest["kind"]> {
  return value === "portable-tool"
    || value === "hosted-tool"
    || value === "harness-native-tool"
    || value === "agent-backed";
}

function isRuntimeCapabilityDescribeDecision(value: unknown): value is RuntimeCapabilityDescribeDecision {
  return value === "selected"
    || value === "not-found"
    || value === "descriptor-mismatch"
    || value === "unsupported-caller"
    || value === "stale"
    || value === "outside-authority"
    || value === "not-materializable"
    || value === "safety-mismatch";
}

function isRuntimeCapabilityEvidenceDecision(value: unknown): value is RuntimeCapabilitySearchEvidence["decision"] {
  return value === "selected"
    || value === "no-match"
    || value === "not-found"
    || value === "descriptor-mismatch"
    || value === "unsupported-caller"
    || value === "stale"
    || value === "outside-authority"
    || value === "not-materializable"
    || value === "safety-mismatch";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsSecret(value: string): boolean {
  return /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|credential|private[_-]?key|authorization|cookie|command|endpoint|environment|path)/iu.test(value)
    || /(?:^|[._:/+\-])Bearer\s+\S+/iu.test(value);
}

function readTags(value: unknown): readonly string[] {
  if (typeof value !== "object" || value === null || typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] !== "function") {
    throw new TypeError("Capability ToolDefinition tags must be iterable.");
  }
  const tags: string[] = [];
  try {
    for (const tag of value as Iterable<unknown>) {
      if (typeof tag !== "string" || tag.length > 256 || containsSecret(tag)) {
        throw new TypeError("Capability ToolDefinition tags must contain safe strings.");
      }
      tags.push(tag);
    }
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError("Capability ToolDefinition tags must be iterable.");
  }
  return Object.freeze([...new Set(tags)].sort(compareCodeUnits));
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (!isPlainRecord(value)) throw new TypeError("Capability replay surface must contain plain JSON values.");
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
    .join(",")}}`;
}

function digestCanonical(value: unknown): Sha256Digest {
  return sha256ContentIdentity(stableSerialize(value)) as Sha256Digest;
}

function compareCodeUnits(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function clonePlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map((entry) => clonePlain(entry)) as T;
  if (isPlainRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clonePlain(entry)])) as T;
  }
  return value;
}

function immutableReadonlySet<T>(values: readonly T[]): ReadonlySet<T> {
  const snapshot = Object.freeze([...values]);
  const view = {
    get size(): number { return snapshot.length; },
    has(value: T): boolean { return snapshot.includes(value); },
    keys(): SetIterator<T> { return snapshot[Symbol.iterator]() as unknown as SetIterator<T>; },
    values(): SetIterator<T> { return snapshot[Symbol.iterator]() as unknown as SetIterator<T>; },
    entries(): SetIterator<[T, T]> {
      return snapshot.map((value) => [value, value] as [T, T])[Symbol.iterator]() as unknown as SetIterator<[T, T]>;
    },
    forEach(callbackfn: (value: T, key: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
      for (const value of snapshot) callbackfn.call(thisArg, value, value, readonlyView);
    },
    [Symbol.iterator](): SetIterator<T> { return snapshot[Symbol.iterator]() as unknown as SetIterator<T>; },
  };
  const readonlyView = view as unknown as ReadonlySet<T>;
  return Object.freeze(readonlyView);
}

function immutableReadonlyMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const snapshot = Object.freeze(entries.map(([key, value]) => Object.freeze([key, value] as const)));
  const view = {
    get size(): number { return snapshot.length; },
    get(key: K): V | undefined { return snapshot.find(([entryKey]) => Object.is(entryKey, key))?.[1]; },
    has(key: K): boolean { return snapshot.some(([entryKey]) => Object.is(entryKey, key)); },
    keys(): MapIterator<K> { return snapshot.map(([key]) => key)[Symbol.iterator]() as unknown as MapIterator<K>; },
    values(): MapIterator<V> { return snapshot.map(([, value]) => value)[Symbol.iterator]() as unknown as MapIterator<V>; },
    entries(): MapIterator<[K, V]> {
      return snapshot.map(([key, value]) => [key, value] as [K, V])[Symbol.iterator]() as unknown as MapIterator<[K, V]>;
    },
    forEach(callbackfn: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
      for (const [key, value] of snapshot) callbackfn.call(thisArg, value, key, readonlyView);
    },
    [Symbol.iterator](): MapIterator<[K, V]> { return view.entries(); },
  };
  const readonlyView = view as unknown as ReadonlyMap<K, V>;
  return Object.freeze(readonlyView);
}
