import type { ActionEffectEnvelope } from "../engine/domain/action-effect.js";
import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import {
  buildCapabilityCatalog,
  type CapabilityCatalogSnapshot,
  type CapabilityDescriptorCandidate,
  type CapabilityKind,
  type CapabilityLimits,
  type CapabilityPermission,
  type CapabilityProvenanceSource,
  type Sha256Digest,
} from "./capability-catalog.js";
import { DEV_TOOL_OUTPUT_SCHEMA, TOOL_SCHEMAS, type DevToolName } from "../tools/domain/tool.js";
import { getBuiltinEffectEnvelope } from "../tools/domain/tool-effect-envelopes.js";
import {
  FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
} from "../verification/formal/observation.js";
import {
  GENTLE_REVIEW_CAPABILITIES_SCHEMA,
  GENTLE_REVIEW_CONTRACT,
  GENTLE_REVIEW_OBSERVATION_SCHEMA,
  GENTLE_REVIEW_STATUS_SCHEMA,
} from "../verification/inferential/gentle-review-observation.js";
import {
  QUALITY_ANALYSIS_OBSERVATION_SCHEMA,
  QUALITY_PROFILE_ORDER,
  type QualityProfileName,
} from "../verification/static/quality-observation.js";
import {
  STATIC_ANALYSIS_OBSERVATION_SCHEMA,
  STATIC_ANALYSIS_PROFILE,
} from "../verification/static/observation.js";

/**
 * Provider-neutral identities frozen for Roadmap 11 Slice 2.
 *
 * `verify.formal` and `verify.static` are the existing canonical identities
 * owned by their registered tools. `verify.artifact-quality` and
 * `verify.inferential-review` are the deliberately neutral identities for the
 * Kiln Quality and Gentle review semantics, respectively. The registered tool
 * names below remain implementation identities. They are deliberately not
 * exposed as capability identities so another admitted implementation can
 * satisfy the same semantic request later.
 */
export const VERIFICATION_CAPABILITY_IDS = Object.freeze({
  formal_verify: "verify.formal",
  static_analyze: "verify.static",
  quality_analyze: "verify.artifact-quality",
  gentle_review: "verify.inferential-review",
} as const);

export const VERIFICATION_PRODUCER_ORDER = [
  "formal_verify",
  "static_analyze",
  "quality_analyze",
  "gentle_review",
] as const;

export type VerificationProducerName = (typeof VERIFICATION_PRODUCER_ORDER)[number];
export type VerificationCapabilityId = (typeof VERIFICATION_CAPABILITY_IDS)[VerificationProducerName];

/** Codes accepted from the already-resolved configuration boundary. */
export const VERIFICATION_PRODUCER_DIAGNOSTIC_CODES = [
  "not_configured",
  "executable_unavailable",
  "managed_artifact_unavailable",
  "version_probe_failed",
  "version_unparseable",
  "version_mismatch",
  "digest_probe_failed",
  "digest_mismatch",
  "profile_invalid",
  "contract_mismatch",
  "invalid_declaration",
] as const;

export type VerificationProducerDiagnosticCode =
  (typeof VERIFICATION_PRODUCER_DIAGNOSTIC_CODES)[number];

export type VerificationProducerResolutionStatus =
  | "available"
  | "unavailable"
  | "configured_unavailable"
  | "validation_failed"
  | "invalid";

/**
 * A safe diagnostic is intentionally smaller than CLI/config diagnostics. It
 * carries a stable code and optional version facts, never the source message,
 * executable path, command, endpoint, environment, or credential.
 */
export interface VerificationProducerDiagnostic {
  readonly code: VerificationProducerDiagnosticCode;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
}

/**
 * Inert evidence emitted by the configuration resolver. This is not a tool
 * option object: paths, commands, runners, callbacks, and credentials have no
 * representation here and therefore cannot cross the discovery boundary.
 *
 * `profile` is a string for the fixed formal/static/Gentle contracts and a
 * canonical ordered list for the selected Kiln Quality profiles.
 */
export interface VerificationProducerResolution {
  readonly status: VerificationProducerResolutionStatus;
  readonly observedAt?: string;
  readonly validUntil?: string;
  readonly version?: string;
  readonly profile?: string | readonly string[];
  readonly implementationDigest?: Sha256Digest;
  readonly provenanceDigest?: Sha256Digest;
  readonly diagnostic?: VerificationProducerDiagnostic;
}

export interface VerificationCapabilityDiscoveryInput {
  readonly evaluatedAt: string;
  readonly producers: Partial<Record<VerificationProducerName, VerificationProducerResolution>>;
}

export interface VerificationCapabilityDiscoveryDiagnostic {
  readonly producer: VerificationProducerName;
  readonly capabilityId: VerificationCapabilityId;
  readonly status: VerificationProducerResolutionStatus;
  readonly version?: string;
  readonly diagnostic?: VerificationProducerDiagnostic;
}

export interface VerificationCapabilityDiscoveryResult {
  readonly evaluatedAt: string;
  readonly candidates: readonly CapabilityDescriptorCandidate[];
  readonly diagnostics: readonly VerificationCapabilityDiscoveryDiagnostic[];
  readonly catalog: CapabilityCatalogSnapshot;
}

const REVISION = "v1" as const;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ROOT_KEYS = ["evaluatedAt", "producers"] as const;
const PRODUCER_KEYS = [
  "status",
  "observedAt",
  "validUntil",
  "version",
  "profile",
  "implementationDigest",
  "provenanceDigest",
  "diagnostic",
] as const;
const DIAGNOSTIC_KEYS = ["code", "expectedVersion", "observedVersion"] as const;
/**
 * Slice 2 discovers candidates; only the Runtime is an admitted execution
 * caller at this boundary. CLI/GUI/TUI/SDK/widget surfaces may inspect the
 * catalog, but native harness callers are not advertised until their later
 * projection/execution slices prove the route.
 */
const SUPPORTED_CALLERS = ["kiln-runtime"] as const;
const UNAVAILABLE_OBSERVED_AT = "1970-01-01T00:00:00.000Z" as const;
const UNAVAILABLE_VALID_UNTIL = "9999-12-31T23:59:59.999Z" as const;
const MAX_FORMAL_INPUT_BYTES = 16 * 1024 * 1024;
const MAX_STATIC_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_QUALITY_INPUT_BYTES = 5 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2_000_000;
const MAX_QUALITY_OUTPUT_BYTES = 16 * 1024 * 1024;

interface VerificationProducerSpec {
  readonly name: VerificationProducerName;
  readonly toolName: DevToolName;
  readonly capabilityId: VerificationCapabilityId;
  readonly kind: CapabilityKind;
  readonly ownerKind: "kiln" | "provider";
  readonly sourceType: Extract<CapabilityProvenanceSource, "kiln" | "provider">;
  readonly implementationKind: "runtime-tool" | "provider-tool";
  readonly observationSchema: string;
  readonly observationKind: string;
  readonly defaultProfile: string | readonly string[];
  readonly inputSchema: Record<string, unknown>;
  readonly effect: ActionEffectEnvelope;
  readonly permissions: readonly CapabilityPermission[];
  readonly limits: CapabilityLimits;
}

interface ParsedResolution {
  readonly available: boolean;
  readonly status: VerificationProducerResolutionStatus;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly version?: string;
  readonly profile: string | readonly string[];
  readonly implementationDigest: Sha256Digest;
  readonly provenanceDigest: Sha256Digest;
  readonly diagnostic?: VerificationProducerDiagnostic;
}

const VERIFICATION_PRODUCER_SPECS: readonly VerificationProducerSpec[] = Object.freeze([
  createSpec({
    name: "formal_verify",
    toolName: "formal_verify",
    capabilityId: VERIFICATION_CAPABILITY_IDS.formal_verify,
    kind: "portable-tool",
    ownerKind: "kiln",
    sourceType: "kiln",
    implementationKind: "runtime-tool",
    observationSchema: FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
    observationKind: "formal_verification",
    defaultProfile: FORMAL_VERIFICATION_OBSERVATION_SCHEMA,
    permissions: ["workspace-write", "machine-execution"],
    limits: {
      maxInputBytes: MAX_FORMAL_INPUT_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxDurationMs: 120_000,
      maxArtifacts: 1,
    },
  }),
  createSpec({
    name: "static_analyze",
    toolName: "static_analyze",
    capabilityId: VERIFICATION_CAPABILITY_IDS.static_analyze,
    kind: "portable-tool",
    ownerKind: "kiln",
    sourceType: "kiln",
    implementationKind: "runtime-tool",
    observationSchema: STATIC_ANALYSIS_OBSERVATION_SCHEMA,
    observationKind: "static_analysis",
    defaultProfile: STATIC_ANALYSIS_PROFILE,
    permissions: ["workspace-write", "machine-execution"],
    limits: {
      maxInputBytes: MAX_STATIC_INPUT_BYTES,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxDurationMs: 60_000,
      maxArtifacts: 1,
    },
  }),
  createSpec({
    name: "quality_analyze",
    toolName: "quality_analyze",
    capabilityId: VERIFICATION_CAPABILITY_IDS.quality_analyze,
    kind: "portable-tool",
    ownerKind: "kiln",
    sourceType: "kiln",
    implementationKind: "runtime-tool",
    observationSchema: QUALITY_ANALYSIS_OBSERVATION_SCHEMA,
    observationKind: "static_quality_analysis",
    defaultProfile: QUALITY_PROFILE_ORDER,
    permissions: ["workspace-read"],
    limits: {
      maxInputBytes: MAX_QUALITY_INPUT_BYTES,
      maxOutputBytes: MAX_QUALITY_OUTPUT_BYTES,
      maxDurationMs: 60_000,
      maxArtifacts: 1,
    },
  }),
  createSpec({
    name: "gentle_review",
    toolName: "gentle_review",
    capabilityId: VERIFICATION_CAPABILITY_IDS.gentle_review,
    kind: "hosted-tool",
    ownerKind: "provider",
    sourceType: "provider",
    implementationKind: "provider-tool",
    observationSchema: GENTLE_REVIEW_OBSERVATION_SCHEMA,
    observationKind: "inferential_review",
    defaultProfile: GENTLE_REVIEW_CONTRACT,
    permissions: ["workspace-write", "machine-execution"],
    limits: {
      maxInputBytes: 1_024,
      maxOutputBytes: MAX_OUTPUT_BYTES,
      maxDurationMs: 60_000,
      maxArtifacts: 1,
    },
  }),
]);

/**
 * Discover all four verification capabilities and build the Core-branded
 * catalog in one pure operation. No producer callback, executable, or tool
 * registry is accepted or invoked.
 */
export function discoverVerificationCapabilities(
  input: VerificationCapabilityDiscoveryInput,
): VerificationCapabilityDiscoveryResult {
  const parsedInput = parseDiscoveryInput(input);
  const candidates: CapabilityDescriptorCandidate[] = [];
  const diagnostics: VerificationCapabilityDiscoveryDiagnostic[] = [];

  for (const spec of VERIFICATION_PRODUCER_SPECS) {
    const rawResolution = parsedInput.producers[spec.name];
    const parsedResolution = parseResolution(rawResolution, spec);
    const candidate = buildCandidate(spec, parsedResolution);
    candidates.push(deepFreeze(candidate));
    diagnostics.push(deepFreeze({
      producer: spec.name,
      capabilityId: spec.capabilityId,
      status: parsedResolution.status,
      ...(parsedResolution.version === undefined ? {} : { version: parsedResolution.version }),
      ...(parsedResolution.diagnostic === undefined ? {} : { diagnostic: parsedResolution.diagnostic }),
    }));
  }

  const frozenCandidates = Object.freeze(candidates);
  const frozenDiagnostics = Object.freeze(diagnostics);
  const catalog = buildCapabilityCatalog(frozenCandidates, parsedInput.evaluatedAt);
  return Object.freeze({
    evaluatedAt: parsedInput.evaluatedAt,
    candidates: frozenCandidates,
    diagnostics: frozenDiagnostics,
    catalog,
  });
}

/** Returns only the inert candidate values, without re-executing discovery. */
export function discoverVerificationCapabilityCandidates(
  input: VerificationCapabilityDiscoveryInput,
): readonly CapabilityDescriptorCandidate[] {
  return discoverVerificationCapabilities(input).candidates;
}

/** Returns the Core-branded catalog produced by the verification adapter. */
export function discoverVerificationCapabilityCatalog(
  input: VerificationCapabilityDiscoveryInput,
): CapabilityCatalogSnapshot {
  return discoverVerificationCapabilities(input).catalog;
}

function createSpec(
  input: Omit<VerificationProducerSpec, "inputSchema" | "effect">,
): VerificationProducerSpec {
  const schema = TOOL_SCHEMAS[input.toolName];
  const effect = getBuiltinEffectEnvelope(input.toolName);
  if (effect === undefined) throw new Error(`No canonical effect envelope for ${input.toolName}`);
  return {
    ...input,
    inputSchema: schema.inputSchema,
    effect,
  };
}

function parseDiscoveryInput(input: VerificationCapabilityDiscoveryInput): {
  readonly evaluatedAt: string;
  readonly producers: Partial<Record<VerificationProducerName, unknown>>;
} {
  const root = inertRecord(input);
  if (root === undefined || !hasExactKeys(root, ROOT_KEYS)) {
    throw new TypeError("Verification capability discovery input must contain only evaluatedAt and producers.");
  }
  const evaluatedAt = root.evaluatedAt;
  if (!isCanonicalTimestamp(evaluatedAt)) {
    throw new TypeError("Verification capability discovery evaluatedAt must be a canonical ISO timestamp.");
  }
  const producers = inertRecord(root.producers);
  if (producers === undefined) {
    throw new TypeError("Verification capability discovery producers must be inert plain data.");
  }
  const producerNames = new Set<string>(VERIFICATION_PRODUCER_ORDER);
  if (Object.keys(producers).some((key) => !producerNames.has(key))) {
    throw new TypeError("Verification capability discovery producers contain an unknown field.");
  }
  return {
    evaluatedAt,
    producers: producers as Partial<Record<VerificationProducerName, unknown>>,
  };
}

function parseResolution(value: unknown, spec: VerificationProducerSpec): ParsedResolution {
  const fallback = fallbackResolution(spec);
  const record = inertRecord(value);
  if (record === undefined || !hasAllowedKeys(record, PRODUCER_KEYS) || !Object.hasOwn(record, "status")) {
    return invalidResolution(fallback);
  }

  const status = record.status;
  if (!isResolutionStatus(status)) return invalidResolution(fallback);

  const diagnostic = parseDiagnostic(record.diagnostic);
  if (record.diagnostic !== undefined && diagnostic === undefined) return invalidResolution(fallback);

  const observedAt = record.observedAt;
  const validUntil = record.validUntil;
  const version = record.version;
  const implementationDigest = record.implementationDigest;
  const provenanceDigest = record.provenanceDigest;
  const profile = parseProfile(record.profile, spec);

  const safeVersion = version === undefined
    ? undefined
    : isVersion(version)
      ? version
      : undefined;
  const safeImplementationDigest = isDigest(implementationDigest) ? implementationDigest : undefined;
  const safeProvenanceDigest = isDigest(provenanceDigest) ? provenanceDigest : undefined;
  const safeTimes = isCanonicalTimestamp(observedAt) && isCanonicalTimestamp(validUntil)
    ? { observedAt, validUntil }
    : undefined;

  if (status !== "available") {
    return Object.freeze({
      available: false,
      status,
      observedAt: UNAVAILABLE_OBSERVED_AT,
      validUntil: UNAVAILABLE_VALID_UNTIL,
      ...(safeVersion === undefined ? {} : { version: safeVersion }),
      profile: profile ?? spec.defaultProfile,
      implementationDigest: safeImplementationDigest ?? fallback.implementationDigest,
      provenanceDigest: safeProvenanceDigest ?? fallback.provenanceDigest,
      ...(diagnostic === undefined ? {} : { diagnostic }),
    });
  }

  if (
    safeVersion === undefined ||
    safeImplementationDigest === undefined ||
    safeProvenanceDigest === undefined ||
    safeTimes === undefined ||
    safeTimes.observedAt >= safeTimes.validUntil ||
    diagnostic !== undefined ||
    profile === undefined
  ) {
    return invalidResolution(fallback, diagnostic);
  }

  return Object.freeze({
    available: true,
    status,
    observedAt: safeTimes.observedAt,
    validUntil: safeTimes.validUntil,
    version: safeVersion,
    profile,
    implementationDigest: safeImplementationDigest,
    provenanceDigest: safeProvenanceDigest,
  });
}

function invalidResolution(
  fallback: ParsedResolution,
  diagnostic?: VerificationProducerDiagnostic,
): ParsedResolution {
  return Object.freeze({
    ...fallback,
    available: false,
    status: "invalid",
    ...(diagnostic === undefined
      ? { diagnostic: { code: "invalid_declaration" as const } }
      : { diagnostic }),
  });
}

function fallbackResolution(spec: VerificationProducerSpec): ParsedResolution {
  return {
    available: false,
    status: "unavailable",
    observedAt: UNAVAILABLE_OBSERVED_AT,
    validUntil: UNAVAILABLE_VALID_UNTIL,
    profile: spec.defaultProfile,
    implementationDigest: derivedDigest(`implementation/${spec.name}`),
    provenanceDigest: derivedDigest(`provenance/${spec.name}`),
  };
}

function buildCandidate(
  spec: VerificationProducerSpec,
  resolution: ParsedResolution,
): CapabilityDescriptorCandidate {
  const inputSchemaDigest = schemaDigest(spec.inputSchema);
  const outputSchemaDigest = schemaDigest(outputSchemaDescriptor(spec, resolution.profile));
  const ownerIdentityDigest = derivedDigest(`owner/${spec.ownerKind}/${spec.name}`);
  const effect = {
    ...spec.effect,
    boundaries: [...spec.effect.boundaries],
    consequences: [...spec.effect.consequences],
  };

  return {
    capabilityId: spec.capabilityId,
    revision: REVISION,
    kind: spec.kind,
    owner: { kind: spec.ownerKind, identityDigest: ownerIdentityDigest },
    inputSchemaDigest,
    outputSchemaDigest,
    artifacts: [{ mediaType: "application/json", schemaDigest: outputSchemaDigest }],
    effect,
    permissions: [...spec.permissions],
    approval: "none",
    network: "none",
    data: { input: "internal", output: "internal", retention: "none" },
    supportedCallers: [...SUPPORTED_CALLERS],
    freshness: {
      observedAt: resolution.available ? resolution.observedAt : UNAVAILABLE_OBSERVED_AT,
      validUntil: resolution.available ? resolution.validUntil : UNAVAILABLE_VALID_UNTIL,
      status: resolution.available ? "available" : "unavailable",
    },
    provenance: {
      sourceType: spec.sourceType,
      sourceIdentityDigest: ownerIdentityDigest,
      sourceDigest: resolution.provenanceDigest,
    },
    limits: { ...spec.limits },
    implementationReferences: [{
      identityDigest: resolution.implementationDigest,
      kind: spec.implementationKind,
      inputSchemaDigest,
      outputSchemaDigest,
    }],
  };
}

function outputSchemaDescriptor(
  spec: VerificationProducerSpec,
  profile: string | readonly string[],
): Record<string, unknown> {
  return {
    toolResult: DEV_TOOL_OUTPUT_SCHEMA,
    verificationObservation: {
      schema: spec.observationSchema,
      kind: spec.observationKind,
      profile,
      ...(spec.name === "gentle_review"
        ? {
            contract: GENTLE_REVIEW_CONTRACT,
            protocol: { major: 2, minor: 2 },
            capabilitiesSchema: GENTLE_REVIEW_CAPABILITIES_SCHEMA,
            statusSchema: GENTLE_REVIEW_STATUS_SCHEMA,
          }
        : {}),
      establishes: [],
    },
  };
}

function schemaDigest(value: unknown): Sha256Digest {
  return sha256ContentIdentity(stableCanonicalStringify(value)) as Sha256Digest;
}

function derivedDigest(identity: string): Sha256Digest {
  return sha256ContentIdentity(`kiln.verification.discovery/v1/${identity}`) as Sha256Digest;
}

function parseDiagnostic(value: unknown): VerificationProducerDiagnostic | undefined {
  if (value === undefined) return undefined;
  const record = inertRecord(value);
  if (record === undefined || !hasAllowedKeys(record, DIAGNOSTIC_KEYS) || !Object.hasOwn(record, "code")) return undefined;
  if (!isDiagnosticCode(record.code)) return undefined;
  const expectedVersion = record.expectedVersion;
  const observedVersion = record.observedVersion;
  if (expectedVersion !== undefined && !isVersion(expectedVersion)) return undefined;
  if (observedVersion !== undefined && !isVersion(observedVersion)) return undefined;
  return Object.freeze({
    code: record.code,
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    ...(observedVersion === undefined ? {} : { observedVersion }),
  });
}

function parseProfile(
  value: unknown,
  spec: VerificationProducerSpec,
): string | readonly string[] | undefined {
  if (value === undefined) {
    return spec.name === "quality_analyze" ? undefined : spec.defaultProfile;
  }
  if (spec.name === "quality_analyze") {
    const profileNames = inertStringArray(value);
    if (profileNames === undefined || profileNames.length === 0) return undefined;
    const positions = profileNames.map((profile) => QUALITY_PROFILE_ORDER.indexOf(profile as QualityProfileName));
    if (
      positions.some((position) => position < 0) ||
      positions.some((position, index) => index > 0 && position <= positions[index - 1]!)
    ) return undefined;
    return Object.freeze(profileNames);
  }
  if (typeof value !== "string") return undefined;
  if (spec.name === "formal_verify" && value !== FORMAL_VERIFICATION_OBSERVATION_SCHEMA) return undefined;
  if (spec.name === "static_analyze" && value !== STATIC_ANALYSIS_PROFILE) return undefined;
  if (spec.name === "gentle_review" && value !== GENTLE_REVIEW_CONTRACT) return undefined;
  return value;
}

function inertStringArray(value: unknown): readonly string[] | undefined {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    if (
      !lengthDescriptor || !("value" in lengthDescriptor) ||
      !Number.isSafeInteger(lengthDescriptor.value) ||
      typeof lengthDescriptor.value !== "number" ||
      lengthDescriptor.value < 1 ||
      keys.some((key) => typeof key !== "string" || (key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key)))
    ) return undefined;
    const length = lengthDescriptor.value;
    const result: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string") {
        return undefined;
      }
      result.push(descriptor.value);
    }
    return keys.length === length + 1 ? result : undefined;
  } catch {
    return undefined;
  }
}

function inertRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) return undefined;
    const result: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) return undefined;
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

function isResolutionStatus(value: unknown): value is VerificationProducerResolutionStatus {
  return value === "available" || value === "unavailable" || value === "configured_unavailable"
    || value === "validation_failed" || value === "invalid";
}

function isDiagnosticCode(value: unknown): value is VerificationProducerDiagnosticCode {
  return typeof value === "string" && VERIFICATION_PRODUCER_DIAGNOSTIC_CODES.includes(value as VerificationProducerDiagnosticCode);
}

function isDigest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && DIGEST_PATTERN.test(value);
}

function isVersion(value: unknown): value is string {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function stableCanonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableCanonicalStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableCanonicalStringify(entry)}`).join(",")}}`;
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
