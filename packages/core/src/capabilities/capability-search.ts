import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import {
  assertCapabilityCatalogSnapshot,
  type CapabilityCatalogSnapshot,
  type CapabilityCallerId,
  type CapabilityDescriptor,
  type CapabilityKind,
  type Sha256Digest,
} from "./capability-catalog.js";

/** Provider-neutral contract revisions for the bounded discovery operations. */
export const CAPABILITY_SEARCH_CONTRACT = "capability.search/v1" as const;
export const CAPABILITY_DESCRIBE_CONTRACT = "capability.describe/v1" as const;

/** The search contract is deliberately bounded before a caller reaches a provider. */
export const CAPABILITY_SEARCH_DEFAULT_LIMIT = 16 as const;
export const CAPABILITY_SEARCH_MAX_LIMIT = 64 as const;
export const CAPABILITY_SEARCH_MAX_QUERY_LENGTH = 256 as const;

const CAPABILITY_CALLERS: readonly CapabilityCallerId[] = [
  "kiln-runtime",
  "kiln-cli",
  "kiln-gui",
  "kiln-tui",
  "kiln-sdk",
  "kiln-widget",
  "codex",
  "claude",
  "opencode-v2",
];
const CAPABILITY_KINDS: readonly CapabilityKind[] = [
  "portable-tool",
  "hosted-tool",
  "harness-native-tool",
  "agent-backed",
];
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const REVISION_PATTERN = /^(?:v\d+|v?\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?|sha256:[a-f0-9]{64})$/u;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface CapabilitySearchRequest {
  readonly caller: CapabilityCallerId;
  readonly evaluatedAt: string;
  readonly query?: string;
  readonly capabilityId?: string;
  readonly kind?: CapabilityKind;
  readonly limit?: number;
}

export interface CapabilityDescribeRequest {
  readonly caller: CapabilityCallerId;
  readonly evaluatedAt: string;
  readonly capabilityId: string;
  readonly revision: string;
  readonly descriptorDigest?: Sha256Digest;
}

/** A model-safe descriptor: governance metadata is present, dispatch is not. */
export type CapabilityDescriptorDisclosure = Omit<CapabilityDescriptor, "implementationReferences">;

export type CapabilitySearchDecision = "selected" | "no-match";
export type CapabilityDescribeDecision =
  | "selected"
  | "not-found"
  | "descriptor-mismatch"
  | "unsupported-caller"
  | "stale";

export interface CapabilitySearchEvidence {
  readonly contract: typeof CAPABILITY_SEARCH_CONTRACT | typeof CAPABILITY_DESCRIBE_CONTRACT;
  readonly catalogDigest: Sha256Digest;
  /** Digest of caller, time, selector, and query; raw query text is not evidence. */
  readonly requestScopeDigest: Sha256Digest;
  readonly decision: CapabilitySearchDecision | CapabilityDescribeDecision;
  readonly descriptorDigests: readonly Sha256Digest[];
  /** Runtime adds these opaque scope facts when selection crosses a route. */
  readonly runtimeScope?: {
    readonly routeDigest: Sha256Digest;
    readonly surfaceDigest: Sha256Digest;
    readonly authorityAdmissionId: Sha256Digest;
  };
  readonly materializedToolName?: string;
}

export interface CapabilitySearchResult {
  readonly contract: typeof CAPABILITY_SEARCH_CONTRACT;
  readonly operation: "search";
  readonly catalogDigest: Sha256Digest;
  readonly observedAt: string;
  readonly totalEligible: number;
  readonly matched: number;
  readonly descriptors: readonly CapabilityDescriptorDisclosure[];
  readonly evidence: CapabilitySearchEvidence;
}

export interface CapabilityDescribeResult {
  readonly contract: typeof CAPABILITY_DESCRIBE_CONTRACT;
  readonly operation: "describe";
  readonly catalogDigest: Sha256Digest;
  readonly observedAt: string;
  readonly decision: CapabilityDescribeDecision;
  readonly descriptor?: CapabilityDescriptorDisclosure;
  readonly evidence: CapabilitySearchEvidence;
}

/**
 * Searches the Core-branded catalog without exposing the full inventory.
 * Selection is deterministic and returns only eligible, current descriptors.
 */
export function capabilitySearch(
  snapshot: CapabilityCatalogSnapshot,
  request: CapabilitySearchRequest,
): CapabilitySearchResult {
  const catalog = assertCapabilityCatalogSnapshot(snapshot);
  const parsed = parseSearchRequest(request);
  const current = catalog.descriptors.filter((descriptor) =>
    isCurrentDescriptor(descriptor, parsed.evaluatedAt)
    && descriptor.supportedCallers.includes(parsed.caller)
    && (parsed.kind === undefined || descriptor.kind === parsed.kind)
    && (parsed.capabilityId === undefined || descriptor.capabilityId === parsed.capabilityId));
  const matches = current
    .map((descriptor, index) => ({
      descriptor,
      index,
      score: scoreDescriptor(descriptor, parsed.query),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.descriptor);
  const descriptors = matches.slice(0, parsed.limit).map(toDisclosure);
  const evidence = buildEvidence(
    CAPABILITY_SEARCH_CONTRACT,
    catalog.catalogDigest,
    parsed,
    descriptors.length > 0 ? "selected" : "no-match",
    descriptors,
  );
  return Object.freeze({
    contract: CAPABILITY_SEARCH_CONTRACT,
    operation: "search",
    catalogDigest: catalog.catalogDigest,
    observedAt: parsed.evaluatedAt,
    totalEligible: current.length,
    matched: matches.length,
    descriptors: Object.freeze(descriptors),
    evidence,
  });
}

/**
 * Describes one exact current descriptor. A missing, stale, unsupported, or
 * digest-mismatched descriptor never returns governance or schema metadata.
 */
export function capabilityDescribe(
  snapshot: CapabilityCatalogSnapshot,
  request: CapabilityDescribeRequest,
): CapabilityDescribeResult {
  const catalog = assertCapabilityCatalogSnapshot(snapshot);
  const parsed = parseDescribeRequest(request);
  const identity = catalog.descriptors.find((descriptor) =>
    descriptor.capabilityId === parsed.capabilityId && descriptor.revision === parsed.revision);
  const decision: CapabilityDescribeDecision = identity === undefined
    ? "not-found"
    : parsed.descriptorDigest !== undefined && identity.descriptorDigest !== parsed.descriptorDigest
      ? "descriptor-mismatch"
      : !identity.supportedCallers.includes(parsed.caller)
        ? "unsupported-caller"
        : !isCurrentDescriptor(identity, parsed.evaluatedAt)
          ? "stale"
          : "selected";
  const descriptor = decision === "selected" && identity !== undefined
    ? toDisclosure(identity)
    : undefined;
  const evidence = buildEvidence(
    CAPABILITY_DESCRIBE_CONTRACT,
    catalog.catalogDigest,
    parsed,
    decision,
    descriptor === undefined ? [] : [descriptor],
  );
  return Object.freeze({
    contract: CAPABILITY_DESCRIBE_CONTRACT,
    operation: "describe",
    catalogDigest: catalog.catalogDigest,
    observedAt: parsed.evaluatedAt,
    decision,
    ...(descriptor === undefined ? {} : { descriptor }),
    evidence,
  });
}

function parseSearchRequest(input: CapabilitySearchRequest): CapabilitySearchRequest {
  if (!isRecord(input)) throw new TypeError("Capability search request must be an object.");
  if (!isCaller(input.caller)) throw new TypeError("Capability search caller is not supported.");
  assertCanonicalTimestamp(input.evaluatedAt, "Capability search evaluatedAt");
  if (input.query !== undefined
    && (typeof input.query !== "string" || input.query.length > CAPABILITY_SEARCH_MAX_QUERY_LENGTH)) {
    throw new TypeError("Capability search query exceeds the bounded maximum.");
  }
  if (input.capabilityId !== undefined && !CAPABILITY_ID_PATTERN.test(input.capabilityId)) {
    throw new TypeError("Capability search capabilityId is malformed.");
  }
  if (input.kind !== undefined && !isKind(input.kind)) {
    throw new TypeError("Capability search kind is not supported.");
  }
  const limit = input.limit ?? CAPABILITY_SEARCH_DEFAULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CAPABILITY_SEARCH_MAX_LIMIT) {
    throw new TypeError("Capability search limit must be a bounded positive integer.");
  }
  return Object.freeze({
    caller: input.caller,
    evaluatedAt: input.evaluatedAt,
    ...(input.query === undefined ? {} : { query: input.query.trim() }),
    ...(input.capabilityId === undefined ? {} : { capabilityId: input.capabilityId }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    limit,
  });
}

function parseDescribeRequest(input: CapabilityDescribeRequest): CapabilityDescribeRequest {
  if (!isRecord(input)) throw new TypeError("Capability describe request must be an object.");
  if (!isCaller(input.caller)) throw new TypeError("Capability describe caller is not supported.");
  assertCanonicalTimestamp(input.evaluatedAt, "Capability describe evaluatedAt");
  if (typeof input.capabilityId !== "string" || !CAPABILITY_ID_PATTERN.test(input.capabilityId)) {
    throw new TypeError("Capability describe capabilityId is malformed.");
  }
  if (typeof input.revision !== "string" || !REVISION_PATTERN.test(input.revision)) {
    throw new TypeError("Capability describe revision is malformed.");
  }
  if (input.descriptorDigest !== undefined && (
    typeof input.descriptorDigest !== "string" || !SHA256_PATTERN.test(input.descriptorDigest)
  )) {
    throw new TypeError("Capability describe descriptorDigest is malformed.");
  }
  return Object.freeze({
    caller: input.caller,
    evaluatedAt: input.evaluatedAt,
    capabilityId: input.capabilityId,
    revision: input.revision,
    ...(input.descriptorDigest === undefined ? {} : { descriptorDigest: input.descriptorDigest }),
  });
}

function buildEvidence(
  contract: CapabilitySearchEvidence["contract"],
  catalogDigest: Sha256Digest,
  request: CapabilitySearchRequest | CapabilityDescribeRequest,
  decision: CapabilitySearchEvidence["decision"],
  descriptors: readonly CapabilityDescriptorDisclosure[],
): CapabilitySearchEvidence {
  const requestScope = {
    caller: request.caller,
    evaluatedAt: request.evaluatedAt,
    ...("query" in request && request.query !== undefined ? { queryDigest: digestText(request.query) } : {}),
    ...(request.capabilityId === undefined ? {} : { capabilityId: request.capabilityId }),
    ...(!("kind" in request) || request.kind === undefined ? {} : { kind: request.kind }),
    ...("limit" in request ? { limit: request.limit } : {}),
    ...("revision" in request ? { revision: request.revision } : {}),
    ...(!("descriptorDigest" in request) || request.descriptorDigest === undefined
      ? {}
      : { descriptorDigest: request.descriptorDigest }),
  };
  return Object.freeze({
    contract,
    catalogDigest,
    requestScopeDigest: digestText(stableSerialize(requestScope)),
    decision,
    descriptorDigests: Object.freeze(descriptors.map((descriptor) => descriptor.descriptorDigest)),
  });
}

function toDisclosure(descriptor: CapabilityDescriptor): CapabilityDescriptorDisclosure {
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

function scoreDescriptor(descriptor: CapabilityDescriptor, query: string | undefined): number {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) return 1;
  const id = descriptor.capabilityId.toLowerCase();
  if (id === normalizedQuery) return 10_000;
  if (id.startsWith(normalizedQuery)) return 8_000;
  if (id.includes(normalizedQuery)) return 6_000;
  const queryParts = tokenize(normalizedQuery);
  const idParts = tokenize(id);
  const matchedParts = queryParts.filter((part) => idParts.some((idPart) => idPart === part || idPart.startsWith(part)));
  return matchedParts.length === queryParts.length ? 1_000 + matchedParts.length : matchedParts.length;
}

function tokenize(value: string): readonly string[] {
  return value.split(/[.\s_-]+/u).map((part) => part.trim()).filter(Boolean);
}

function isCurrentDescriptor(descriptor: CapabilityDescriptor, evaluatedAt: string): boolean {
  const evaluationTime = Date.parse(evaluatedAt);
  const observedAt = Date.parse(descriptor.freshness.observedAt);
  const validUntil = Date.parse(descriptor.freshness.validUntil);
  return descriptor.freshness.status === "available"
    && observedAt <= evaluationTime
    && validUntil > evaluationTime;
}

function assertCanonicalTimestamp(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    || Number.isNaN(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
}

function isCaller(value: unknown): value is CapabilityCallerId {
  return typeof value === "string" && CAPABILITY_CALLERS.includes(value as CapabilityCallerId);
}

function isKind(value: unknown): value is CapabilityKind {
  return typeof value === "string" && CAPABILITY_KINDS.includes(value as CapabilityKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function digestText(value: string): Sha256Digest {
  return sha256ContentIdentity(value) as Sha256Digest;
}

function stableSerialize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(",")}}`;
  }
  throw new TypeError("Capability request scope contains an unsupported value.");
}
