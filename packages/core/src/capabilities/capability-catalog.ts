import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { deriveAuthorityFromEffect, normalizeActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";

export type Sha256Digest = `sha256:${string}`;

export type CapabilityKind =
  | "portable-tool"
  | "hosted-tool"
  | "harness-native-tool"
  | "agent-backed";

export type CapabilityPermission =
  | "workspace-read"
  | "workspace-write"
  | "machine-execution"
  | "network-access"
  | "external-state"
  | "credential-use";

export type CapabilityApprovalPosture = "none" | "conditional" | "required";
export type CapabilityNetworkPosture = "none" | "restricted" | "open";
export type CapabilityDataClassification = "public" | "internal" | "sensitive";
export type CapabilityRetention = "none" | "ephemeral" | "persistent";
export type CapabilityOwnerKind = "kiln" | "provider" | "harness" | "service" | "agent";
export type CapabilityCallerId =
  | "kiln-runtime"
  | "kiln-cli"
  | "kiln-gui"
  | "kiln-tui"
  | "kiln-sdk"
  | "kiln-widget"
  | "codex"
  | "claude"
  | "opencode-v2";
export type CapabilityImplementationKind = "runtime-tool" | "provider-tool" | "harness-tool" | "agent";
export type CapabilityProvenanceSource = "kiln" | "harness" | "provider" | "protocol" | "operator";

export type CapabilityCatalogReason =
  | "eligible"
  | "duplicate-identity"
  | "revision-drift"
  | "schema-mismatch"
  | "unsupported-effect"
  | "stale-evidence"
  | "unavailable-evidence"
  | "contradictory-evidence"
  | "malformed-descriptor"
  | "secret-bearing-field";

export interface CapabilityArtifactDeclaration {
  readonly mediaType: string;
  readonly schemaDigest?: Sha256Digest;
}

export interface CapabilityDataPosture {
  readonly input: CapabilityDataClassification;
  readonly output: CapabilityDataClassification;
  readonly retention: CapabilityRetention;
}

export interface CapabilityOwner {
  readonly kind: CapabilityOwnerKind;
  readonly identityDigest: Sha256Digest;
}

export interface CapabilityFreshness {
  readonly observedAt: string;
  readonly validUntil: string;
  readonly status: "available" | "unavailable";
}

export interface CapabilityProvenance {
  readonly sourceType: CapabilityProvenanceSource;
  readonly sourceIdentityDigest: Sha256Digest;
  readonly sourceDigest: Sha256Digest;
}

export interface CapabilityLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxDurationMs: number;
  readonly maxArtifacts: number;
}

export interface CapabilityImplementationReference {
  readonly identityDigest: Sha256Digest;
  readonly kind: CapabilityImplementationKind;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
}

export interface CapabilityDescriptorCandidate {
  readonly capabilityId: string;
  readonly revision: string;
  readonly kind: CapabilityKind;
  readonly owner: CapabilityOwner;
  readonly inputSchemaDigest: Sha256Digest;
  readonly outputSchemaDigest: Sha256Digest;
  readonly artifacts: readonly CapabilityArtifactDeclaration[];
  readonly effect: ActionEffectEnvelope;
  readonly permissions: readonly CapabilityPermission[];
  readonly approval: CapabilityApprovalPosture;
  readonly network: CapabilityNetworkPosture;
  readonly data: CapabilityDataPosture;
  readonly supportedCallers: readonly CapabilityCallerId[];
  readonly freshness: CapabilityFreshness;
  readonly provenance: CapabilityProvenance;
  readonly limits: CapabilityLimits;
  readonly implementationReferences: readonly CapabilityImplementationReference[];
}

export interface CapabilityDescriptor extends CapabilityDescriptorCandidate {
  readonly descriptorDigest: Sha256Digest;
}

export interface CapabilityCatalogDecision {
  readonly capabilityId?: string;
  readonly revision?: string;
  readonly descriptorDigest?: Sha256Digest;
  readonly status: "eligible" | "ineligible";
  readonly reasons: readonly CapabilityCatalogReason[];
}

export interface CapabilityCatalogSnapshot {
  readonly evaluatedAt: string;
  readonly catalogDigest: Sha256Digest;
  readonly descriptors: readonly CapabilityDescriptor[];
  readonly decisions: readonly CapabilityCatalogDecision[];
}

/**
 * A bounded, inert rejection reported by a discovery producer.
 *
 * Rejections are evidence, not authority. A producer can preserve a safe
 * identity when it has one, but it cannot provide descriptor content for a
 * rejected candidate. Core folds this evidence together with every candidate
 * before it decides the aggregate catalog.
 */
export interface CapabilityCatalogRejectionEvidence {
  readonly capabilityId?: string;
  readonly revision?: string;
  readonly descriptorDigest?: Sha256Digest;
  readonly reason: Exclude<CapabilityCatalogReason, "eligible">;
}

/**
 * Branded inert input from one discovery producer. The brand is process-local
 * and deliberately does not survive serialization or copying.
 */
export interface CapabilityCatalogContribution {
  readonly sourceId: string;
  readonly candidates: readonly unknown[];
  readonly rejections: readonly CapabilityCatalogRejectionEvidence[];
}

const CANDIDATE_KEYS = [
  "capabilityId", "revision", "kind", "owner", "inputSchemaDigest", "outputSchemaDigest",
  "artifacts", "effect", "permissions", "approval", "network", "data", "supportedCallers",
  "freshness", "provenance", "limits", "implementationReferences",
] as const;
const ARTIFACT_KEYS = ["mediaType", "schemaDigest"] as const;
const OWNER_KEYS = ["kind", "identityDigest"] as const;
const EFFECT_KEYS = ["operation", "boundaries", "reversibility", "dataEgress", "identityUse", "consequences", "idempotency"] as const;
const DATA_KEYS = ["input", "output", "retention"] as const;
const FRESHNESS_KEYS = ["observedAt", "validUntil", "status"] as const;
const PROVENANCE_KEYS = ["sourceType", "sourceIdentityDigest", "sourceDigest"] as const;
const LIMIT_KEYS = ["maxInputBytes", "maxOutputBytes", "maxDurationMs", "maxArtifacts"] as const;
const IMPLEMENTATION_KEYS = ["identityDigest", "kind", "inputSchemaDigest", "outputSchemaDigest"] as const;

const KINDS = ["portable-tool", "hosted-tool", "harness-native-tool", "agent-backed"] as const;
const PERMISSIONS = ["workspace-read", "workspace-write", "machine-execution", "network-access", "external-state", "credential-use"] as const;
const APPROVALS = ["none", "conditional", "required"] as const;
const NETWORK_POSTURES = ["none", "restricted", "open"] as const;
const DATA_CLASSIFICATIONS = ["public", "internal", "sensitive"] as const;
const RETENTIONS = ["none", "ephemeral", "persistent"] as const;
const OWNER_KINDS = ["kiln", "provider", "harness", "service", "agent"] as const;
const CALLER_IDS = ["kiln-runtime", "kiln-cli", "kiln-gui", "kiln-tui", "kiln-sdk", "kiln-widget", "codex", "claude", "opencode-v2"] as const;
const PROVENANCE_SOURCES = ["kiln", "harness", "provider", "protocol", "operator"] as const;
const IMPLEMENTATION_KINDS = ["runtime-tool", "provider-tool", "harness-tool", "agent"] as const;
const UNKNOWN_EFFECT_VALUES = new Set(["unknown"]);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const REVISION_PATTERN = /^(?:v\d+|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?|sha256:[a-f0-9]{64})$/u;
const MEDIA_TYPE_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;
const SECRET_KEY_PATTERN = /(?:^|[_-])(authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|api[_-]?key|access[_-]?key|command|endpoint|environment|env|path)(?:$|[_-])/iu;
const SECRET_COMPACT_KEYS = new Set([
  "authorization", "cookie", "credential", "credentials", "password", "passwd", "privatekey",
  "secret", "token", "apitoken", "apikey", "accesskey", "command", "endpoint", "environment", "env", "path",
]);
const SECRET_VALUE_PATTERNS = [
  /(?:^|[._:/+\-])Bearer\s+\S+/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:^|[._:/+\-])[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/iu,
  /(?:^|[._:/+\-])(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])sk-(?:proj-)?[A-Za-z0-9_-]{8,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])AIza[0-9A-Za-z_-]{20,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])glpat-[0-9A-Za-z_-]{10,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])xox[baprs]-[0-9A-Za-z-]{10,}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])AKIA[0-9A-Z]{16}(?=$|[.:/+])/u,
  /(?:^|[._:/+\-])eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=$|[.:/+])/u,
  /(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/iu,
] as const;
const AUTHENTIC_SNAPSHOTS = new WeakSet<CapabilityCatalogSnapshot>();
const AUTHENTIC_CONTRIBUTIONS = new WeakSet<CapabilityCatalogContribution>();
const MAX_CANDIDATE_INSPECTION_NODES = 1_024;
const MAX_CANDIDATE_INSPECTION_DEPTH = 32;
const MAX_CANDIDATE_STRING_UNITS = 16_384;
const MAX_CATALOG_INSPECTION_NODES = 1_000_000;
const MAX_CATALOG_STRING_UNITS = 12_000_000;
const MAX_CATALOG_ENTRIES = 10_000;
const MAX_CONTRIBUTION_ENTRIES = 10_000;
const SOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,126}$/u;
const CONTRIBUTION_KEYS = ["sourceId", "candidates", "rejections"] as const;
const REJECTION_KEYS = ["capabilityId", "revision", "descriptorDigest", "reason"] as const;
const REJECTION_REASONS = [
  "duplicate-identity",
  "revision-drift",
  "schema-mismatch",
  "unsupported-effect",
  "stale-evidence",
  "unavailable-evidence",
  "contradictory-evidence",
  "malformed-descriptor",
  "secret-bearing-field",
] as const satisfies readonly Exclude<CapabilityCatalogReason, "eligible">[];

type SafeIdentity = Pick<CapabilityCatalogDecision, "capabilityId" | "revision" | "descriptorDigest">;
interface InspectionBudget {
  remainingNodes: number;
  remainingStringUnits: number;
}

type CandidateResult = {
  readonly groupingKey?: string;
  readonly publicIdentity: SafeIdentity;
  readonly secretBearing: boolean;
} & (
  | { readonly candidate: CapabilityDescriptorCandidate; readonly descriptor: CapabilityDescriptor; readonly localReason?: CapabilityCatalogReason }
  | { readonly decision: CapabilityCatalogDecision }
);

type CatalogEntry =
  | { readonly kind: "candidate"; readonly value: unknown }
  | { readonly kind: "rejection"; readonly evidence: CapabilityCatalogRejectionEvidence };

/**
 * Parse and freeze one producer contribution. The copy is made through data
 * descriptors only, so no accessor, callback, proxy, or exotic object can
 * cross the Core boundary. Rejected candidate values remain inert evidence and
 * are evaluated by the aggregate builder, where their safe decision is made.
 */
export function createCapabilityCatalogContribution(input: unknown): CapabilityCatalogContribution {
  let copied: unknown;
  try {
    copied = createInertSnapshot(input, {
      remainingNodes: MAX_CATALOG_INSPECTION_NODES,
      remainingStringUnits: MAX_CATALOG_STRING_UNITS,
    }, {
      maxNodes: MAX_CATALOG_INSPECTION_NODES,
      maxDepth: MAX_CANDIDATE_INSPECTION_DEPTH,
      maxStringUnits: MAX_CATALOG_STRING_UNITS,
      arrayLengthLimit: (path) => path.length === 1
        && (path[0] === "candidates" || path[0] === "rejections")
        ? MAX_CONTRIBUTION_ENTRIES
        : MAX_CANDIDATE_INSPECTION_NODES,
    });
  } catch {
    throw new TypeError("Capability catalog contribution must contain bounded inert data.");
  }
  if (!isRecord(copied) || !hasExactKeys(copied, CONTRIBUTION_KEYS)) {
    throw new TypeError("Capability catalog contribution has an unsupported shape.");
  }
  const sourceId = copied.sourceId;
  if (typeof sourceId !== "string" || !SOURCE_ID_PATTERN.test(sourceId) || containsSecret(sourceId)) {
    throw new TypeError("Capability catalog contribution sourceId is malformed.");
  }
  const candidates = copied.candidates;
  if (!Array.isArray(candidates) || candidates.length > MAX_CONTRIBUTION_ENTRIES) {
    throw new TypeError("Capability catalog contribution candidates exceed the bounded maximum.");
  }
  const rawRejections = copied.rejections;
  if (!Array.isArray(rawRejections) || rawRejections.length > MAX_CONTRIBUTION_ENTRIES) {
    throw new TypeError("Capability catalog contribution rejections exceed the bounded maximum.");
  }
  if (candidates.length + rawRejections.length > MAX_CATALOG_ENTRIES) {
    throw new TypeError("Capability catalog contribution entries exceed the bounded maximum.");
  }
  const safeCandidates: unknown[] = [];
  const rejections = rawRejections.map((value) => parseContributionRejection(value));
  for (const candidate of candidates) {
    if (containsSecret(candidate)) {
      rejections.push({ reason: "secret-bearing-field" });
    } else {
      safeCandidates.push(candidate);
    }
  }
  if (safeCandidates.length + rejections.length > MAX_CATALOG_ENTRIES) {
    throw new TypeError("Capability catalog contribution entries exceed the bounded maximum.");
  }
  const sortedCandidates = safeCandidates
    .sort((left, right) => compareCodeUnits(canonicalEntryKey(left), canonicalEntryKey(right)));
  const sortedRejections = rejections
    .sort((left, right) => compareCodeUnits(canonicalEntryKey(left), canonicalEntryKey(right)));
  const contribution = deepFreeze({
    sourceId,
    candidates: sortedCandidates,
    rejections: sortedRejections,
  });
  AUTHENTIC_CONTRIBUTIONS.add(contribution);
  return contribution;
}

/** Returns only contributions created by Core's inert contribution parser. */
export function assertCapabilityCatalogContribution(value: unknown): CapabilityCatalogContribution {
  if (!value || typeof value !== "object" || !AUTHENTIC_CONTRIBUTIONS.has(value as CapabilityCatalogContribution)) {
    throw new TypeError("Capability catalog contribution must be a Core-built contribution.");
  }
  return value as CapabilityCatalogContribution;
}

/**
 * Build one catalog from every producer contribution. Contributions are
 * ordered by their safe source identity before inspection, making budget
 * consumption and replay independent of caller ordering.
 */
export function buildAggregateCapabilityCatalog(
  contributions: readonly CapabilityCatalogContribution[],
  evaluatedAt: string,
): CapabilityCatalogSnapshot {
  if (!Array.isArray(contributions)) throw new TypeError("Capability catalog contributions must be an array.");
  if (contributions.length > MAX_CATALOG_ENTRIES) {
    throw new TypeError("Capability catalog contributions exceed the bounded maximum.");
  }
  const authenticated = contributions.map(assertCapabilityCatalogContribution);
  const sourceIds = new Set<string>();
  for (const contribution of authenticated) {
    if (sourceIds.has(contribution.sourceId)) {
      throw new TypeError("Capability catalog contributions contain duplicate sourceId.");
    }
    sourceIds.add(contribution.sourceId);
  }
  const sortedContributions = [...authenticated].sort((left, right) => compareCodeUnits(left.sourceId, right.sourceId));
  let totalEntries = 0;
  for (const contribution of sortedContributions) {
    totalEntries += contribution.candidates.length + contribution.rejections.length;
    if (totalEntries > MAX_CATALOG_ENTRIES) {
      throw new TypeError("Capability catalog contributions exceed the bounded maximum.");
    }
  }
  const entries: CatalogEntry[] = [];
  for (const contribution of sortedContributions) {
    for (const candidate of contribution.candidates) entries.push({ kind: "candidate", value: candidate });
    for (const rejection of contribution.rejections) entries.push({ kind: "rejection", evidence: rejection });
  }
  return buildCatalogEntries(entries, evaluatedAt);
}

export function buildCapabilityCatalog(candidates: readonly unknown[], evaluatedAt: string): CapabilityCatalogSnapshot {
  return buildCatalogEntries(candidates.map((value) => ({ kind: "candidate" as const, value })), evaluatedAt);
}

function buildCatalogEntries(entries: readonly CatalogEntry[], evaluatedAt: string): CapabilityCatalogSnapshot {
  const evaluatedTime = parseCanonicalInstant(evaluatedAt);
  if (evaluatedTime === undefined) throw new TypeError("Capability catalog evaluatedAt must be a canonical ISO timestamp.");
  if (!Array.isArray(entries)) throw new TypeError("Capability catalog entries must be an array.");
  if (entries.length > MAX_CATALOG_ENTRIES) throw new TypeError("Capability catalog entries exceed the bounded maximum.");

  const inspectionBudget: InspectionBudget = {
    remainingNodes: MAX_CATALOG_INSPECTION_NODES,
    remainingStringUnits: MAX_CATALOG_STRING_UNITS,
  };
  const parsed = entries.map((entry) => entry.kind === "candidate"
    ? inspectAndParseCandidate(entry.value, evaluatedTime, inspectionBudget)
    : rejectionResult(entry.evidence));
  const standaloneDecisions: CapabilityCatalogDecision[] = [];
  const groups = new Map<string, CandidateResult[]>();
  for (const result of parsed) {
    if (!result.groupingKey) {
      if (!("decision" in result)) throw new TypeError("Capability catalog candidate has no validated identity.");
      standaloneDecisions.push(result.decision);
      continue;
    }
    const group = groups.get(result.groupingKey) ?? [];
    group.push(result);
    groups.set(result.groupingKey, group);
  }

  const descriptors: CapabilityDescriptor[] = [];
  const decisions: CapabilityCatalogDecision[] = [...standaloneDecisions];
  for (const group of groups.values()) {
    const first = group[0]!;
    if (group.length > 1) {
      const parsedGroup = group.filter(isParsedCandidate);
      const reason = parsedGroup.length > 1
        && new Set(parsedGroup.map((entry) => entry.descriptor.descriptorDigest)).size > 1
        ? "revision-drift"
        : "duplicate-identity";
      decisions.push(group.some((entry) => entry.secretBearing)
        ? bareIneligible(reason)
        : identityIneligible(first.publicIdentity, reason));
      continue;
    }
    if ("decision" in first) {
      decisions.push(first.decision);
      continue;
    }
    if (first.localReason) {
      decisions.push(ineligible(first.candidate, first.localReason, first.descriptor.descriptorDigest));
      continue;
    }
    descriptors.push(first.descriptor);
    decisions.push(deepFreeze({
      capabilityId: first.candidate.capabilityId,
      revision: first.candidate.revision,
      descriptorDigest: first.descriptor.descriptorDigest,
      status: "eligible" as const,
      reasons: ["eligible" as const],
    }));
  }

  descriptors.sort(compareDescriptors);
  decisions.sort(compareDecisions);
  const snapshotValue = deepFreeze({ evaluatedAt, descriptors, decisions });
  const snapshot = deepFreeze({
    evaluatedAt,
    catalogDigest: sha256ContentIdentity(stableStringify(snapshotValue)) as Sha256Digest,
    descriptors,
    decisions,
  });
  AUTHENTIC_SNAPSHOTS.add(snapshot);
  return snapshot;
}

/** Returns only snapshots constructed and validated by this Core module. */
export function assertCapabilityCatalogSnapshot(value: unknown): CapabilityCatalogSnapshot {
  if (!value || typeof value !== "object" || !AUTHENTIC_SNAPSHOTS.has(value as CapabilityCatalogSnapshot)) {
    throw new TypeError("Capability catalog snapshot must be a Core-built snapshot.");
  }
  return value as CapabilityCatalogSnapshot;
}

function inspectAndParseCandidate(value: unknown, evaluatedTime: number, budget: InspectionBudget): CandidateResult {
  const safeIdentity = extractSafeIdentityFromDescriptors(value);
  const groupingKey = groupingKeyFor(safeIdentity);
  try {
    return parseCandidate(createInertSnapshot(value, budget), evaluatedTime);
  } catch (error) {
    if (error instanceof CatalogInspectionBudgetError) {
      throw new TypeError("Capability catalog inspection budget exceeded.");
    }
    return {
      groupingKey,
      publicIdentity: safeIdentity,
      secretBearing: false,
      decision: identityIneligible(safeIdentity, "malformed-descriptor"),
    };
  }
}

function rejectionResult(evidence: CapabilityCatalogRejectionEvidence): CandidateResult {
  const publicIdentity: SafeIdentity = {
    ...(evidence.capabilityId === undefined ? {} : { capabilityId: evidence.capabilityId }),
    ...(evidence.revision === undefined ? {} : { revision: evidence.revision }),
    ...(evidence.descriptorDigest === undefined ? {} : { descriptorDigest: evidence.descriptorDigest }),
  };
  return {
    groupingKey: groupingKeyFor(publicIdentity),
    publicIdentity,
    secretBearing: evidence.reason === "secret-bearing-field",
    decision: evidence.capabilityId === undefined && evidence.revision === undefined
      ? bareIneligible(evidence.reason)
      : identityIneligible(publicIdentity, evidence.reason),
  };
}

function parseContributionRejection(value: unknown): CapabilityCatalogRejectionEvidence {
  if (containsSecret(value)) return { reason: "secret-bearing-field" };
  if (!isRecord(value) || !hasOnlyKeys(value, REJECTION_KEYS) || !Object.hasOwn(value, "reason")) {
    return { reason: "malformed-descriptor" };
  }
  const capabilityId = value.capabilityId;
  const revision = value.revision;
  const descriptorDigest = value.descriptorDigest;
  const reason = value.reason;
  return {
    ...(typeof capabilityId === "string" && CAPABILITY_ID_PATTERN.test(capabilityId) ? { capabilityId } : {}),
    ...(typeof revision === "string" && REVISION_PATTERN.test(revision) ? { revision } : {}),
    ...(typeof descriptorDigest === "string" && SHA256_PATTERN.test(descriptorDigest)
      ? { descriptorDigest: descriptorDigest as Sha256Digest }
      : {}),
    reason: typeof reason === "string" && REJECTION_REASONS.includes(reason as typeof REJECTION_REASONS[number])
      ? reason as Exclude<CapabilityCatalogReason, "eligible">
      : "malformed-descriptor",
  };
}

function parseCandidate(value: unknown, evaluatedTime: number): CandidateResult {
  const safeIdentity = extractSafeIdentity(value);
  const groupingKey = groupingKeyFor(safeIdentity);
  if (containsSecret(value)) {
    return { groupingKey, publicIdentity: {}, secretBearing: true, decision: bareIneligible("secret-bearing-field") };
  }
  if (!isRecord(value) || !hasExactKeys(value, CANDIDATE_KEYS)) {
    return {
      groupingKey,
      publicIdentity: safeIdentity,
      secretBearing: false,
      decision: identityIneligible(safeIdentity, "malformed-descriptor"),
    };
  }
  try {
    const candidate = normalizeCandidate(value);
    const descriptorDigest = sha256ContentIdentity(stableStringify(candidate)) as Sha256Digest;
    const descriptor = deepFreeze(insertDescriptorDigest(candidate, descriptorDigest));
    return {
      groupingKey: `${candidate.capabilityId}\u0000${candidate.revision}`,
      publicIdentity: { capabilityId: candidate.capabilityId, revision: candidate.revision },
      secretBearing: false,
      candidate,
      descriptor,
      localReason: determineLocalReason(candidate, evaluatedTime),
    };
  } catch (error) {
    const reason = error instanceof CatalogValidationError ? error.reason : "malformed-descriptor";
    return {
      groupingKey,
      publicIdentity: safeIdentity,
      secretBearing: false,
      decision: identityIneligible(safeIdentity, reason),
    };
  }
}

function normalizeCandidate(value: Record<string, unknown>): CapabilityDescriptorCandidate {
  const capabilityId = normalizeCapabilityId(value.capabilityId);
  const revision = normalizeRevision(value.revision);
  const kind = member(value.kind, KINDS);
  const owner = normalizeOwner(value.owner);
  const inputSchemaDigest = digest(value.inputSchemaDigest);
  const outputSchemaDigest = digest(value.outputSchemaDigest);
  const artifacts = normalizeArtifacts(value.artifacts);
  const effect = normalizeEffect(value.effect);
  const permissions = uniqueMembers(value.permissions, PERMISSIONS, 6);
  const approval = member(value.approval, APPROVALS);
  const network = member(value.network, NETWORK_POSTURES);
  const data = normalizeData(value.data);
  const supportedCallers = uniqueMembers(value.supportedCallers, CALLER_IDS, CALLER_IDS.length, false);
  const freshness = normalizeFreshness(value.freshness);
  const provenance = normalizeProvenance(value.provenance);
  const limits = normalizeLimits(value.limits);
  const implementationReferences = normalizeImplementationReferences(value.implementationReferences);
  return deepFreeze({
    capabilityId, revision, kind, owner, inputSchemaDigest, outputSchemaDigest, artifacts, effect,
    permissions, approval, network, data, supportedCallers, freshness, provenance, limits,
    implementationReferences,
  });
}

function normalizeArtifacts(value: unknown): readonly CapabilityArtifactDeclaration[] {
  if (!Array.isArray(value) || value.length > 32) malformed();
  const artifacts = value.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, ARTIFACT_KEYS) || typeof entry.mediaType !== "string" || !MEDIA_TYPE_PATTERN.test(entry.mediaType)) malformed();
    return entry.schemaDigest === undefined
      ? { mediaType: entry.mediaType }
      : { mediaType: entry.mediaType, schemaDigest: digest(entry.schemaDigest) };
  });
  artifacts.sort((left, right) => compareCodeUnits(stableStringify(left), stableStringify(right)));
  if (new Set(artifacts.map(stableStringify)).size !== artifacts.length) malformed();
  return deepFreeze(artifacts);
}

function normalizeOwner(value: unknown): CapabilityOwner {
  if (!isRecord(value) || !hasExactKeys(value, OWNER_KEYS)) malformed();
  return deepFreeze({
    kind: member(value.kind, OWNER_KINDS),
    identityDigest: digest(value.identityDigest),
  });
}

function normalizeEffect(value: unknown): ActionEffectEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, EFFECT_KEYS)) unsupportedEffect();
  const normalized = normalizeActionEffectEnvelope(value);
  if (!normalized || Object.values(normalized).some((item) => typeof item === "string" && UNKNOWN_EFFECT_VALUES.has(item))
    || normalized.consequences.includes("unknown")) unsupportedEffect();
  return normalized;
}

function normalizeData(value: unknown): CapabilityDataPosture {
  if (!isRecord(value) || !hasExactKeys(value, DATA_KEYS)) malformed();
  return deepFreeze({
    input: member(value.input, DATA_CLASSIFICATIONS),
    output: member(value.output, DATA_CLASSIFICATIONS),
    retention: member(value.retention, RETENTIONS),
  });
}

function normalizeFreshness(value: unknown): CapabilityFreshness {
  if (!isRecord(value) || !hasExactKeys(value, FRESHNESS_KEYS)) malformed();
  if (parseCanonicalInstant(value.observedAt) === undefined || parseCanonicalInstant(value.validUntil) === undefined) malformed();
  return deepFreeze({
    observedAt: value.observedAt as string,
    validUntil: value.validUntil as string,
    status: member(value.status, ["available", "unavailable"] as const),
  });
}

function normalizeProvenance(value: unknown): CapabilityProvenance {
  if (!isRecord(value) || !hasExactKeys(value, PROVENANCE_KEYS)) malformed();
  return deepFreeze({
    sourceType: member(value.sourceType, PROVENANCE_SOURCES),
    sourceIdentityDigest: digest(value.sourceIdentityDigest),
    sourceDigest: digest(value.sourceDigest),
  });
}

function normalizeLimits(value: unknown): CapabilityLimits {
  if (!isRecord(value) || !hasExactKeys(value, LIMIT_KEYS)) malformed();
  return deepFreeze({
    maxInputBytes: boundedInteger(value.maxInputBytes, 1, 16 * 1024 * 1024),
    maxOutputBytes: boundedInteger(value.maxOutputBytes, 1, 64 * 1024 * 1024),
    maxDurationMs: boundedInteger(value.maxDurationMs, 1, 24 * 60 * 60 * 1000),
    maxArtifacts: boundedInteger(value.maxArtifacts, 0, 256),
  });
}

function normalizeImplementationReferences(value: unknown): readonly CapabilityImplementationReference[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 16) malformed();
  const references = value.map((entry) => {
    if (!isRecord(entry) || !hasExactKeys(entry, IMPLEMENTATION_KEYS)) malformed();
    return deepFreeze({
      identityDigest: digest(entry.identityDigest),
      kind: member(entry.kind, IMPLEMENTATION_KINDS),
      inputSchemaDigest: digest(entry.inputSchemaDigest),
      outputSchemaDigest: digest(entry.outputSchemaDigest),
    });
  });
  references.sort((left, right) => compareCodeUnits(stableStringify(left), stableStringify(right)));
  if (new Set(references.map((entry) => entry.identityDigest)).size !== references.length) malformed();
  return deepFreeze(references);
}

function determineLocalReason(candidate: CapabilityDescriptorCandidate, evaluatedTime: number): CapabilityCatalogReason | undefined {
  if (candidate.implementationReferences.some((reference) =>
    reference.inputSchemaDigest !== candidate.inputSchemaDigest || reference.outputSchemaDigest !== candidate.outputSchemaDigest)) {
    return "schema-mismatch";
  }
  const observedAt = Date.parse(candidate.freshness.observedAt);
  const validUntil = Date.parse(candidate.freshness.validUntil);
  if (observedAt >= validUntil || observedAt > evaluatedTime) return "contradictory-evidence";
  if (candidate.freshness.status === "unavailable") return "unavailable-evidence";
  if (validUntil <= evaluatedTime) return "stale-evidence";
  if (hasContradictoryPosture(candidate)) return "contradictory-evidence";
  return undefined;
}

function hasContradictoryPosture(candidate: CapabilityDescriptorCandidate): boolean {
  const { effect, permissions } = candidate;
  const has = (permission: CapabilityPermission): boolean => permissions.includes(permission);
  if (effect.boundaries.includes("workspace") && !has(effect.operation === "observe" ? "workspace-read" : "workspace-write")) return true;
  if (effect.boundaries.includes("machine") && !has("machine-execution")) return true;
  const needsNetwork = effect.boundaries.includes("network") || effect.dataEgress !== "none";
  if (needsNetwork && (candidate.network === "none" || !has("network-access"))) return true;
  if (candidate.network !== "none" && !has("network-access")) return true;
  if (candidate.network === "none" && has("network-access")) return true;
  const needsExternal = effect.boundaries.includes("external-system") || effect.consequences.includes("external-state");
  if (needsExternal && !has("external-state")) return true;
  if (effect.identityUse !== "none" && !has("credential-use")) return true;
  return candidate.approval === "none" && deriveAuthorityFromEffect(effect).requiresApproval;
}

function insertDescriptorDigest(candidate: CapabilityDescriptorCandidate, descriptorDigest: Sha256Digest): CapabilityDescriptor {
  const { capabilityId, revision, ...rest } = candidate;
  return { capabilityId, revision, descriptorDigest, ...rest };
}

function ineligible(candidate: CapabilityDescriptorCandidate, reason: CapabilityCatalogReason, descriptorDigest?: Sha256Digest): CapabilityCatalogDecision {
  return deepFreeze({
    capabilityId: candidate.capabilityId,
    revision: candidate.revision,
    ...(descriptorDigest ? { descriptorDigest } : {}),
    status: "ineligible" as const,
    reasons: [reason],
  });
}

function bareIneligible(reason: CapabilityCatalogReason): CapabilityCatalogDecision {
  return deepFreeze({ status: "ineligible", reasons: [reason] });
}

function identityIneligible(identity: SafeIdentity, reason: CapabilityCatalogReason): CapabilityCatalogDecision {
  return deepFreeze({ ...identity, status: "ineligible" as const, reasons: [reason] });
}

function isParsedCandidate(result: CandidateResult): result is Extract<CandidateResult, { candidate: CapabilityDescriptorCandidate }> {
  return "candidate" in result;
}

function extractSafeIdentity(value: unknown): Pick<CapabilityCatalogDecision, "capabilityId" | "revision"> {
  if (!isRecord(value)) return {};
  return {
    ...(typeof value.capabilityId === "string" && CAPABILITY_ID_PATTERN.test(value.capabilityId) ? { capabilityId: value.capabilityId } : {}),
    ...(typeof value.revision === "string" && REVISION_PATTERN.test(value.revision) ? { revision: value.revision } : {}),
  };
}

function extractSafeIdentityFromDescriptors(value: unknown): SafeIdentity {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return {};
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const capabilityId = dataString(descriptors.capabilityId);
    const revision = dataString(descriptors.revision);
    return {
      ...(capabilityId && CAPABILITY_ID_PATTERN.test(capabilityId) ? { capabilityId } : {}),
      ...(revision && REVISION_PATTERN.test(revision) ? { revision } : {}),
    };
  } catch {
    return {};
  }
}

function dataString(descriptor: PropertyDescriptor | undefined): string | undefined {
  return descriptor && descriptor.enumerable && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

function groupingKeyFor(identity: SafeIdentity): string | undefined {
  return identity.capabilityId && identity.revision
    ? `${identity.capabilityId}\u0000${identity.revision}`
    : undefined;
}

interface InertSnapshotLimits {
  readonly maxNodes: number;
  readonly maxDepth: number;
  readonly maxStringUnits: number;
  readonly arrayLengthLimit?: (path: readonly (string | number)[]) => number;
}

function createInertSnapshot(
  value: unknown,
  budget: InspectionBudget,
  limits: InertSnapshotLimits = {
    maxNodes: MAX_CANDIDATE_INSPECTION_NODES,
    maxDepth: MAX_CANDIDATE_INSPECTION_DEPTH,
    maxStringUnits: MAX_CANDIDATE_STRING_UNITS,
  },
): unknown {
  const seen = new WeakSet<object>();
  const local = { nodes: 0, stringUnits: 0 };

  const snapshot = (current: unknown, depth: number, path: readonly (string | number)[]): unknown => {
    local.nodes += 1;
    budget.remainingNodes -= 1;
    if (budget.remainingNodes < 0) throw new CatalogInspectionBudgetError();
    if (local.nodes > limits.maxNodes || depth > limits.maxDepth) {
      throw new CandidateInspectionError();
    }
    if (typeof current === "string") {
      local.stringUnits += current.length;
      budget.remainingStringUnits -= current.length;
      if (budget.remainingStringUnits < 0) throw new CatalogInspectionBudgetError();
      if (local.stringUnits > limits.maxStringUnits) throw new CandidateInspectionError();
      return current;
    }
    if (current === null || typeof current === "boolean" || typeof current === "number" || current === undefined) {
      return current;
    }
    if (typeof current !== "object") throw new CandidateInspectionError();
    if (seen.has(current)) throw new CandidateInspectionError();
    seen.add(current);

    const prototype = Object.getPrototypeOf(current);
    if (Array.isArray(current)) {
      if (prototype !== Array.prototype) throw new CandidateInspectionError();
      const descriptors = Object.getOwnPropertyDescriptors(current) as unknown as Record<PropertyKey, PropertyDescriptor>;
      const lengthDescriptor = descriptors.length;
      const arrayLength = lengthDescriptor?.value;
      const maxArrayLength = limits.arrayLengthLimit?.(path) ?? MAX_CANDIDATE_INSPECTION_NODES;
      if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(arrayLength)
        || typeof arrayLength !== "number" || arrayLength < 0 || arrayLength > maxArrayLength) {
        throw new CandidateInspectionError();
      }
      const keys = Reflect.ownKeys(descriptors);
      if (keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))) {
        throw new CandidateInspectionError();
      }
      const result: unknown[] = [];
      for (let index = 0; index < arrayLength; index++) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new CandidateInspectionError();
        result.push(snapshot(descriptor.value, depth + 1, [...path, index]));
      }
      if (keys.length !== arrayLength + 1) throw new CandidateInspectionError();
      return result;
    }

    if (prototype !== Object.prototype && prototype !== null) throw new CandidateInspectionError();
    const descriptors = Object.getOwnPropertyDescriptors(current) as Record<PropertyKey, PropertyDescriptor>;
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 64 || keys.some((key) => typeof key !== "string")) throw new CandidateInspectionError();
    const result = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) throw new CandidateInspectionError();
      Object.defineProperty(result, key, {
        value: snapshot(descriptor.value, depth + 1, [...path, key]),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
    return result;
  };

  return snapshot(value, 0, []);
}

function containsSecret(value: unknown): boolean {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (++visited > 100_000) return true;
    if (typeof current === "string") {
      if (current.length > 4_096 || SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(current))) return true;
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.length > 100_000) return true;
      for (const entry of current) pending.push(entry);
      continue;
    }
    for (const [key, entry] of Object.entries(current as Record<string, unknown>)) {
      if (isSecretKey(key)) return true;
      pending.push(entry);
    }
  }
  return false;
}

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) || SECRET_COMPACT_KEYS.has(key.replace(/[^A-Za-z]/gu, "").toLowerCase());
}

function uniqueMembers<const T extends readonly string[]>(
  value: unknown,
  members: T,
  maximum: number,
  allowEmpty = true,
): readonly T[number][] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) malformed();
  const normalized = value.map((entry) => member(entry, members));
  if (new Set(normalized).size !== normalized.length) malformed();
  return deepFreeze(normalized.sort((left, right) => members.indexOf(left) - members.indexOf(right)));
}

function member<const T extends readonly string[]>(value: unknown, members: T): T[number] {
  if (typeof value !== "string" || !members.includes(value)) malformed();
  return value as T[number];
}

function normalizeCapabilityId(value: unknown): string {
  if (typeof value !== "string" || !CAPABILITY_ID_PATTERN.test(value) || value.length > 127) malformed();
  return value;
}

function normalizeRevision(value: unknown): string {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value) || value.length > 127) malformed();
  return value;
}

function digest(value: unknown): Sha256Digest {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) malformed();
  return value as Sha256Digest;
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) malformed();
  return value as number;
}

function parseCanonicalInstant(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

function compareDescriptors(left: CapabilityDescriptor, right: CapabilityDescriptor): number {
  return compareCodeUnits(left.capabilityId, right.capabilityId) || compareCodeUnits(left.revision, right.revision);
}

function compareDecisions(left: CapabilityCatalogDecision, right: CapabilityCatalogDecision): number {
  return compareCodeUnits(left.capabilityId ?? "", right.capabilityId ?? "")
    || compareCodeUnits(left.revision ?? "", right.revision ?? "")
    || compareCodeUnits(left.reasons[0]!, right.reasons[0]!);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.every((key) => allowed.includes(key)) && allowed.every((key) => key in value || key === "schemaDigest");
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}

function canonicalEntryKey(value: unknown): string {
  return stableStringify(value) ?? "undefined";
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index++) {
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

class CatalogValidationError extends TypeError {
  constructor(readonly reason: CapabilityCatalogReason) {
    super(`Capability catalog candidate is ${reason}.`);
  }
}

class CandidateInspectionError extends TypeError {}
class CatalogInspectionBudgetError extends TypeError {}

function malformed(): never {
  throw new CatalogValidationError("malformed-descriptor");
}

function unsupportedEffect(): never {
  throw new CatalogValidationError("unsupported-effect");
}
