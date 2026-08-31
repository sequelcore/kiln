import { isProxy } from "node:util/types";

import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import {
  buildAggregateCapabilityCatalog,
  createCapabilityCatalogContribution,
  type CapabilityCatalogContribution,
  type CapabilityCatalogSnapshot,
  type CapabilityDescriptorCandidate,
  type CapabilityLimits,
  type Sha256Digest,
} from "./capability-catalog.js";
import {
  normalizeAndDigestCapabilityJsonSchema,
  type CapabilityJsonSchemaDigest,
} from "./capability-json-schema-safety.js";
import {
  VISION_ANALYZE_CAPABILITY_ID,
  VISION_ANALYZE_CONTRACT,
  VISION_ANALYZE_INPUT_SCHEMA,
  VISION_ANALYZE_TOOL_NAME,
  VISION_ANALYSIS_OUTPUT_SCHEMA,
} from "./vision-analysis-capability.js";

/** Revision of the Core adapter that contributes the vision capability. */
export const VISION_ANALYZE_CAPABILITY_DISCOVERY_REVISION = "vision-analyze-capability-discovery/v1" as const;

/** Catalog revision for the provider-neutral `vision.analyze` capability. */
export const VISION_ANALYZE_CAPABILITY_REVISION = "v1" as const;

/** Stable contribution identity for this one semantic capability. */
export const VISION_ANALYZE_DISCOVERY_SOURCE_ID = "vision-analyze" as const;

/** The canonical schema digests bound to every discovered vision tool. */
export const VISION_ANALYZE_INPUT_SCHEMA_DIGEST = schemaDigest(VISION_ANALYZE_INPUT_SCHEMA, "input");
export const VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST = schemaDigest(VISION_ANALYSIS_OUTPUT_SCHEMA, "output");

/** The maximum effect of an agent-backed image analysis invocation. */
export const VISION_ANALYZE_EFFECT: ActionEffectEnvelope = Object.freeze({
  operation: "observe",
  boundaries: Object.freeze(["process", "workspace", "machine", "network"] as const),
  reversibility: "reversible",
  dataEgress: "project-data",
  identityUse: "authenticated",
  consequences: Object.freeze(["financial"] as const),
  idempotency: "idempotent",
});

/** Bounded limits used by the first provider-neutral vision route. */
export const VISION_ANALYZE_LIMITS: CapabilityLimits = Object.freeze({
  maxInputBytes: 64 * 1024,
  maxOutputBytes: 64 * 1024,
  maxDurationMs: 120_000,
  maxArtifacts: 0,
});

export const VISION_ANALYZE_IMPLEMENTATION_STATUSES = [
  "available",
  "unavailable",
  "configured_unavailable",
  "validation_failed",
  "invalid",
] as const;

export type VisionAnalyzeImplementationResolutionStatus =
  (typeof VISION_ANALYZE_IMPLEMENTATION_STATUSES)[number];

/** Safe diagnostic codes accepted from the configuration owner. */
export const VISION_ANALYZE_DIAGNOSTIC_CODES = [
  "not_configured",
  "implementation_unavailable",
  "evidence_unavailable",
  "evidence_stale",
  "invalid_declaration",
] as const;

export type VisionAnalyzeDiagnosticCode = (typeof VISION_ANALYZE_DIAGNOSTIC_CODES)[number];

/** Content-free diagnostic evidence from the already-resolved configuration boundary. */
export interface VisionAnalyzeImplementationDiagnostic {
  readonly code: VisionAnalyzeDiagnosticCode;
}

/**
 * Inert availability and evidence for one agent-backed implementation.
 *
 * Provider configuration, credentials, routes, callbacks, executable paths,
 * and model options intentionally have no representation here. The owning
 * configuration/runtime boundary supplies only opaque identity digests and
 * bounded freshness evidence.
 */
export interface VisionAnalyzeImplementationResolution {
  readonly status: VisionAnalyzeImplementationResolutionStatus;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly implementationIdentityDigest?: Sha256Digest;
  readonly provenanceDigest?: Sha256Digest;
  /** Optional opaque agent owner identity; absent values use the implementation identity. */
  readonly agentIdentityDigest?: Sha256Digest;
  readonly diagnostic?: VisionAnalyzeImplementationDiagnostic;
}

export interface VisionAnalyzeCapabilityDiscoveryInput {
  readonly evaluatedAt: string;
  readonly implementation: VisionAnalyzeImplementationResolution;
}

export interface VisionAnalyzeCapabilityDiscoveryDiagnostic {
  readonly capabilityId: typeof VISION_ANALYZE_CAPABILITY_ID;
  readonly status: VisionAnalyzeImplementationResolutionStatus;
  readonly diagnostic?: VisionAnalyzeImplementationDiagnostic;
}

/** Exact schemas and identities Runtime binds to the selected agent port. */
export interface VisionAnalyzeCapabilityToolSchema {
  readonly capabilityId: typeof VISION_ANALYZE_CAPABILITY_ID;
  readonly revision: typeof VISION_ANALYZE_CAPABILITY_REVISION;
  readonly contract: typeof VISION_ANALYZE_CONTRACT;
  readonly toolName: typeof VISION_ANALYZE_TOOL_NAME;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly inputSchemaDigest: CapabilityJsonSchemaDigest;
  readonly outputSchemaDigest: CapabilityJsonSchemaDigest;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
}

export interface VisionAnalyzeCapabilityDiscoveryResult {
  readonly evaluatedAt: string;
  /** Exactly one candidate for the `vision.analyze` semantic identity. */
  readonly candidates: readonly CapabilityDescriptorCandidate[];
  readonly diagnostics: readonly VisionAnalyzeCapabilityDiscoveryDiagnostic[];
  readonly toolSchemas: readonly VisionAnalyzeCapabilityToolSchema[];
  readonly contribution: CapabilityCatalogContribution;
  readonly catalog: CapabilityCatalogSnapshot;
}

interface ParsedResolution {
  readonly available: boolean;
  readonly status: VisionAnalyzeImplementationResolutionStatus;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly implementationIdentityDigest: Sha256Digest;
  readonly provenanceDigest: Sha256Digest;
  readonly agentIdentityDigest: Sha256Digest;
  readonly diagnostic?: VisionAnalyzeImplementationDiagnostic;
}

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ROOT_KEYS = ["evaluatedAt", "implementation"] as const;
const IMPLEMENTATION_KEYS = [
  "status",
  "observedAt",
  "validUntil",
  "implementationIdentityDigest",
  "provenanceDigest",
  "agentIdentityDigest",
  "diagnostic",
] as const;
const DIAGNOSTIC_KEYS = ["code"] as const;
const SUPPORTED_CALLERS = Object.freeze(["kiln-runtime"] as const);
const PERMISSIONS = Object.freeze(["workspace-read", "machine-execution", "network-access", "credential-use"] as const);
const UNAVAILABLE_OBSERVED_AT = "1970-01-01T00:00:00.000Z" as const;
const UNAVAILABLE_VALID_UNTIL = "1970-01-01T00:00:00.001Z" as const;
const SOURCE_IDENTITY_DIGEST = derivedDigest("source/vision-analyze");
const DEFAULT_AGENT_IDENTITY_DIGEST = derivedDigest("owner/vision-analyze");
const FALLBACK_IMPLEMENTATION_DIGEST = derivedDigest("implementation/vision-analyze/unavailable");
const FALLBACK_PROVENANCE_DIGEST = derivedDigest("provenance/vision-analyze/unavailable");

/**
 * Discover the single Core-branded agent-backed vision candidate from inert,
 * already-settled implementation evidence.
 *
 * This operation does not resolve a provider, inspect a route, invoke an
 * executor, or accept a callback. Unavailable and invalid declarations remain
 * visible as one ineligible candidate so the catalog never fails open.
 */
export function discoverVisionAnalyzeCapabilities(
  input: VisionAnalyzeCapabilityDiscoveryInput,
): VisionAnalyzeCapabilityDiscoveryResult {
  const parsedInput = parseDiscoveryInput(input);
  const resolution = parseResolution(parsedInput.implementation);
  const candidate = deepFreeze(buildCandidate(resolution));
  const candidates = Object.freeze([candidate]);
  const diagnostic = deepFreeze({
    capabilityId: VISION_ANALYZE_CAPABILITY_ID,
    status: resolution.status,
    ...(resolution.diagnostic === undefined ? {} : { diagnostic: resolution.diagnostic }),
  });
  const diagnostics = Object.freeze([diagnostic]);
  const toolSchema = deepFreeze({
    capabilityId: VISION_ANALYZE_CAPABILITY_ID,
    revision: VISION_ANALYZE_CAPABILITY_REVISION,
    contract: VISION_ANALYZE_CONTRACT,
    toolName: VISION_ANALYZE_TOOL_NAME,
    implementationIdentityDigest: resolution.implementationIdentityDigest,
    inputSchemaDigest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
    outputSchemaDigest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
    inputSchema: VISION_ANALYZE_INPUT_SCHEMA,
    outputSchema: VISION_ANALYSIS_OUTPUT_SCHEMA,
  });
  const toolSchemas = Object.freeze([toolSchema]);
  const contribution = createCapabilityCatalogContribution({
    sourceId: VISION_ANALYZE_DISCOVERY_SOURCE_ID,
    candidates,
    rejections: [],
  });
  const catalog = buildAggregateCapabilityCatalog([contribution], parsedInput.evaluatedAt);
  return Object.freeze({
    evaluatedAt: parsedInput.evaluatedAt,
    candidates,
    diagnostics,
    toolSchemas,
    contribution,
    catalog,
  });
}

/** Returns the one inert agent-backed vision candidate without re-running callers. */
export function discoverVisionAnalyzeCapabilityCandidates(
  input: VisionAnalyzeCapabilityDiscoveryInput,
): readonly CapabilityDescriptorCandidate[] {
  return discoverVisionAnalyzeCapabilities(input).candidates;
}

/** Returns the Core-built catalog for the agent-backed vision capability. */
export function discoverVisionAnalyzeCapabilityCatalog(
  input: VisionAnalyzeCapabilityDiscoveryInput,
): CapabilityCatalogSnapshot {
  return discoverVisionAnalyzeCapabilities(input).catalog;
}

function schemaDigest(
  schema: Readonly<Record<string, unknown>>,
  direction: "input" | "output",
): CapabilityJsonSchemaDigest {
  const normalized = normalizeAndDigestCapabilityJsonSchema(schema, direction, { requireObjectType: true });
  if (!normalized.ok || !normalized.present) {
    throw new Error(`Canonical vision ${direction} schema is not admissible.`);
  }
  return normalized.digest;
}

function parseDiscoveryInput(input: unknown): {
  readonly evaluatedAt: string;
  readonly implementation: unknown;
} {
  const root = inertRecord(input);
  if (root === undefined || !hasExactKeys(root, ROOT_KEYS)) {
    throw new TypeError("Vision analyze capability discovery input must contain only evaluatedAt and implementation.");
  }
  if (!isCanonicalTimestamp(root.evaluatedAt)) {
    throw new TypeError("Vision analyze capability discovery evaluatedAt must be a canonical ISO timestamp.");
  }
  return { evaluatedAt: root.evaluatedAt, implementation: root.implementation };
}

function parseResolution(value: unknown): ParsedResolution {
  const fallback = fallbackResolution();
  const record = inertRecord(value);
  if (record === undefined || !hasAllowedKeys(record, IMPLEMENTATION_KEYS) || !Object.hasOwn(record, "status")) {
    return invalidResolution(fallback);
  }

  const status = record.status;
  if (!isResolutionStatus(status)) return invalidResolution(fallback);

  const diagnostic = parseDiagnostic(record.diagnostic);
  if (record.diagnostic !== undefined && diagnostic === undefined) return invalidResolution(fallback);

  const observedAt = record.observedAt;
  const validUntil = record.validUntil;
  const implementationIdentityDigest = parseDigest(record.implementationIdentityDigest);
  const provenanceDigest = parseDigest(record.provenanceDigest);
  const agentIdentityDigest = parseDigest(record.agentIdentityDigest);
  const safeTimes = isCanonicalTimestamp(observedAt) && isCanonicalTimestamp(validUntil)
    ? { observedAt, validUntil }
    : undefined;

  if (status !== "available") {
    return Object.freeze({
      available: false,
      status,
      observedAt: UNAVAILABLE_OBSERVED_AT,
      validUntil: UNAVAILABLE_VALID_UNTIL,
      implementationIdentityDigest: implementationIdentityDigest ?? fallback.implementationIdentityDigest,
      provenanceDigest: provenanceDigest ?? fallback.provenanceDigest,
      agentIdentityDigest: agentIdentityDigest
        ?? implementationIdentityDigest
        ?? fallback.agentIdentityDigest,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    });
  }

  if (
    implementationIdentityDigest === undefined
    || provenanceDigest === undefined
    || safeTimes === undefined
    || safeTimes.observedAt >= safeTimes.validUntil
    || diagnostic !== undefined
  ) {
    return invalidResolution(fallback, diagnostic);
  }

  return Object.freeze({
    available: true,
    status,
    observedAt: safeTimes.observedAt,
    validUntil: safeTimes.validUntil,
    implementationIdentityDigest,
    provenanceDigest,
    agentIdentityDigest: agentIdentityDigest ?? implementationIdentityDigest,
  });
}

function invalidResolution(
  fallback: ParsedResolution,
  diagnostic?: VisionAnalyzeImplementationDiagnostic,
): ParsedResolution {
  return Object.freeze({
    ...fallback,
    available: false,
    status: "invalid",
    diagnostic: diagnostic ?? { code: "invalid_declaration" as const },
  });
}

function fallbackResolution(): ParsedResolution {
  return Object.freeze({
    available: false,
    status: "unavailable",
    observedAt: UNAVAILABLE_OBSERVED_AT,
    validUntil: UNAVAILABLE_VALID_UNTIL,
    implementationIdentityDigest: FALLBACK_IMPLEMENTATION_DIGEST,
    provenanceDigest: FALLBACK_PROVENANCE_DIGEST,
    agentIdentityDigest: DEFAULT_AGENT_IDENTITY_DIGEST,
  });
}

function buildCandidate(resolution: ParsedResolution): CapabilityDescriptorCandidate {
  return {
    capabilityId: VISION_ANALYZE_CAPABILITY_ID,
    revision: VISION_ANALYZE_CAPABILITY_REVISION,
    kind: "agent-backed",
    owner: { kind: "agent", identityDigest: resolution.agentIdentityDigest },
    inputSchemaDigest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
    outputSchemaDigest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
    artifacts: [],
    effect: VISION_ANALYZE_EFFECT,
    permissions: PERMISSIONS,
    approval: "none",
    network: "restricted",
    // The capability adapter retains no request or result copy. Managed-agent
    // lifecycle/audit evidence remains owned by that existing subsystem and is
    // not capability-owned data retention.
    data: { input: "internal", output: "internal", retention: "none" },
    supportedCallers: SUPPORTED_CALLERS,
    freshness: {
      observedAt: resolution.available ? resolution.observedAt : UNAVAILABLE_OBSERVED_AT,
      validUntil: resolution.available ? resolution.validUntil : UNAVAILABLE_VALID_UNTIL,
      status: resolution.available ? "available" : "unavailable",
    },
    provenance: {
      sourceType: "operator",
      sourceIdentityDigest: SOURCE_IDENTITY_DIGEST,
      sourceDigest: resolution.provenanceDigest,
    },
    limits: VISION_ANALYZE_LIMITS,
    implementationReferences: [{
      identityDigest: resolution.implementationIdentityDigest,
      kind: "agent",
      inputSchemaDigest: VISION_ANALYZE_INPUT_SCHEMA_DIGEST,
      outputSchemaDigest: VISION_ANALYZE_OUTPUT_SCHEMA_DIGEST,
    }],
  };
}

function parseDiagnostic(value: unknown): VisionAnalyzeImplementationDiagnostic | undefined {
  if (value === undefined) return undefined;
  const record = inertRecord(value);
  if (record === undefined || !hasExactKeys(record, DIAGNOSTIC_KEYS)) return undefined;
  return isDiagnosticCode(record.code) ? { code: record.code } : undefined;
}

function inertRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) || isProxy(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return undefined;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return undefined;
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

function hasAllowedKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isResolutionStatus(value: unknown): value is VisionAnalyzeImplementationResolutionStatus {
  return typeof value === "string"
    && VISION_ANALYZE_IMPLEMENTATION_STATUSES.includes(value as VisionAnalyzeImplementationResolutionStatus);
}

function isDiagnosticCode(value: unknown): value is VisionAnalyzeDiagnosticCode {
  return typeof value === "string" && VISION_ANALYZE_DIAGNOSTIC_CODES.includes(value as VisionAnalyzeDiagnosticCode);
}

function parseDigest(value: unknown): Sha256Digest | undefined {
  return typeof value === "string" && DIGEST_PATTERN.test(value) ? value as Sha256Digest : undefined;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function derivedDigest(value: string): Sha256Digest {
  return sha256ContentIdentity(`${VISION_ANALYZE_CAPABILITY_DISCOVERY_REVISION}/${value}`) as Sha256Digest;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    if (Array.isArray(value)) {
      for (const child of value) deepFreeze(child);
    } else {
      for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
