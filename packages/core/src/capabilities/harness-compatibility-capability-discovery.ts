import { sha256ContentIdentity } from "../content-addressing/content-identity.js";
import { isProxy } from "node:util/types";
import {
  buildAggregateCapabilityCatalog,
  createCapabilityCatalogContribution,
  type CapabilityCatalogSnapshot,
  type CapabilityCatalogContribution,
  type CapabilityDescriptorCandidate,
  type Sha256Digest,
} from "./capability-catalog.js";

/** The exact compatibility-record contract admitted by this adapter. */
export const HARNESS_COMPATIBILITY_RECORD_SCHEMA = "kiln.capability-compatibility/v1" as const;

/** The Core adapter revision that participates in every rejection identity. */
export const HARNESS_COMPATIBILITY_CAPABILITY_DISCOVERY_REVISION =
  "harness-compatibility-capability-discovery/v1" as const;

export const HARNESS_COMPATIBILITY_HARNESSES = ["codex", "claude", "opencode-v2"] as const;
export type HarnessCompatibilityHarness = (typeof HARNESS_COMPATIBILITY_HARNESSES)[number];

export interface HarnessCompatibilityCapabilityDeclaration {
  readonly id: string;
  readonly classification: "portable-function/mcp" | "hosted-provider" | "harness-private" | "lossy/unrepresentable";
  readonly stability: "stable" | "private" | "experimental";
  readonly eligible: boolean;
  readonly representation: "lossless" | "lossy" | "unrepresentable";
  readonly semanticLoss: readonly string[];
  readonly sourceArtifacts: readonly string[];
  readonly endpoints?: readonly string[];
}

export interface HarnessCompatibilityRecord {
  readonly schema: typeof HARNESS_COMPATIBILITY_RECORD_SCHEMA;
  readonly harness: HarnessCompatibilityHarness;
  readonly sdk: {
    readonly package: string;
    readonly version: string;
    readonly npmIntegrity: string;
  };
  readonly runtime: {
    readonly name: string;
    readonly observedVersion: string;
    readonly observedAt: string;
    readonly relationshipToSdk: string;
  };
  readonly source: {
    readonly repository: string;
    readonly tag: string;
    readonly commit: string;
  };
  readonly sourceArtifacts: readonly {
    readonly id: string;
    readonly origin: "official-repository" | "published-npm-package";
    readonly path: string;
    readonly sha256: string;
    readonly supports: string;
  }[];
  readonly capabilities: readonly HarnessCompatibilityCapabilityDeclaration[];
  readonly fixture: {
    readonly path: string;
    readonly sha256: string;
    readonly kind: "synthetic";
  };
  readonly liveEvidence: readonly {
    readonly scope: string;
    readonly command: string;
    readonly bound: string;
    readonly status: "observed" | "failed" | "not-run";
    readonly result: string;
  }[];
}

/**
 * Settled caller evidence around one exact record. The record and fixture
 * digests are supplied by the caller because Core is deliberately not a file
 * reader or a byte loader.
 */
export interface HarnessCompatibilityCapabilityDiscoverySnapshot extends HarnessCompatibilityRecord {
  readonly recordDigest: string;
  readonly fixtureDigest: string;
  readonly completeness: "complete" | "partial" | "degraded";
  readonly invalidated: boolean;
  readonly freshness: {
    readonly observedAt: string;
    readonly validUntil: string;
    readonly status: "current" | "stale" | "unknown";
  };
}

export interface HarnessCompatibilityCapabilityDiscoveryInput {
  readonly evaluatedAt: string;
  /** Kept unknown at the API edge so JSON-loaded caller data is parsed once. */
  readonly snapshot: unknown;
}

export type HarnessCompatibilityCapabilityDiscoveryDiagnosticCode =
  | "native_route_deferred"
  | "source_declared_ineligible"
  | "experimental_contract"
  | "record_malformed"
  | "record_identity_mismatch"
  | "record_digest_invalid"
  | "sdk_evidence_invalid"
  | "runtime_evidence_invalid"
  | "source_evidence_invalid"
  | "source_artifact_mismatch"
  | "fixture_digest_mismatch"
  | "incomplete_evidence"
  | "invalidated_evidence"
  | "stale_evidence"
  | "freshness_invalid"
  | "contradictory_evidence"
  | "capability_malformed"
  | "secret_bearing_evidence";

export interface HarnessCompatibilityCapabilityDiscoveryDiagnostic {
  readonly code: HarnessCompatibilityCapabilityDiscoveryDiagnosticCode;
  readonly harness?: HarnessCompatibilityHarness;
  readonly capabilityId?: string;
  readonly message: string;
  readonly severity: "warning" | "error";
}

export interface HarnessCompatibilityCapabilityDiscoveryResult {
  readonly evaluatedAt: string;
  readonly harness?: HarnessCompatibilityHarness;
  readonly recordDigest?: Sha256Digest;
  /** Always empty: native search and execution routes are deferred. */
  readonly candidates: readonly CapabilityDescriptorCandidate[];
  readonly diagnostics: readonly HarnessCompatibilityCapabilityDiscoveryDiagnostic[];
  readonly contribution: CapabilityCatalogContribution;
  readonly catalog: CapabilityCatalogSnapshot;
}

const RECORD_KEYS = [
  "schema",
  "harness",
  "sdk",
  "runtime",
  "source",
  "sourceArtifacts",
  "capabilities",
  "fixture",
  "liveEvidence",
] as const;
const SNAPSHOT_KEYS = [
  ...RECORD_KEYS,
  "recordDigest",
  "fixtureDigest",
  "completeness",
  "invalidated",
  "freshness",
] as const;
const SDK_KEYS = ["package", "version", "npmIntegrity"] as const;
const RUNTIME_KEYS = ["name", "observedVersion", "observedAt", "relationshipToSdk"] as const;
const SOURCE_KEYS = ["repository", "tag", "commit"] as const;
const SOURCE_ARTIFACT_KEYS = ["id", "origin", "path", "sha256", "supports"] as const;
const CAPABILITY_KEYS = [
  "id",
  "classification",
  "stability",
  "eligible",
  "representation",
  "semanticLoss",
  "sourceArtifacts",
  "endpoints",
] as const;
const FIXTURE_KEYS = ["path", "sha256", "kind"] as const;
const LIVE_EVIDENCE_KEYS = ["scope", "command", "bound", "status", "result"] as const;
const FRESHNESS_KEYS = ["observedAt", "validUntil", "status"] as const;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const BARE_DIGEST_PATTERN = /^[a-f0-9]{64}$/u;
const NPM_INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]{86}={0,2}$/u;
const SEMVER_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}(?:\.[a-z0-9][a-z0-9_-]{0,62})+$/u;
const ARTIFACT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,126}$/u;
const RELATIVE_PATH_PATTERN = /^[^\\/][^\\]*$/u;
const MAX_NODES = 32_768;
const MAX_DEPTH = 32;
const MAX_STRING_UNITS = 1_000_000;
const MAX_ARTIFACTS = 256;
const MAX_CAPABILITIES = 4_096;
const MAX_LIVE_EVIDENCE = 256;
const MAX_SEMANTIC_LOSS = 64;
const MAX_ENDPOINTS = 32;
const MAX_TTL_MS = 24 * 60 * 60 * 1_000;

const EXPECTED_HARNESS_EVIDENCE: Readonly<Record<HarnessCompatibilityHarness, {
  readonly sdkPackage: string;
  readonly sdkVersion: string;
  readonly runtimeName: string;
  readonly repository: string;
  readonly tag: string;
}>> = Object.freeze({
  codex: {
    sdkPackage: "@openai/codex-sdk",
    sdkVersion: "0.147.0",
    runtimeName: "codex",
    repository: "https://github.com/openai/codex",
    tag: "rust-v0.147.0",
  },
  claude: {
    sdkPackage: "@anthropic-ai/claude-agent-sdk",
    sdkVersion: "0.3.237",
    runtimeName: "claude",
    repository: "https://github.com/anthropics/claude-agent-sdk-typescript",
    tag: "v0.3.237",
  },
  "opencode-v2": {
    sdkPackage: "@opencode-ai/sdk",
    sdkVersion: "1.18.18",
    runtimeName: "opencode",
    repository: "https://github.com/anomalyco/opencode",
    tag: "v1.18.18",
  },
});

const INVALID = Symbol("invalid-inert-value");
const MISSING = Symbol("missing-inert-value");

type CapturedValue = unknown | typeof INVALID | typeof MISSING;

interface CloneBudget {
  nodes: number;
  stringUnits: number;
}

interface CapturedSnapshot {
  readonly fields: Readonly<Record<string, CapturedValue>>;
  readonly unknownKeys: readonly string[];
  readonly valid: boolean;
}

interface ParsedFreshness {
  readonly valid: boolean;
  readonly stale: boolean;
}

interface ParsedArtifact {
  readonly id: string;
}

interface ParsedDeclaration {
  readonly capabilityId?: string;
  readonly revision?: string;
  readonly valid: boolean;
  readonly eligible: boolean;
  readonly experimental: boolean;
  readonly declarationDigest?: Sha256Digest;
  readonly diagnostics: readonly HarnessCompatibilityCapabilityDiscoveryDiagnostic[];
}

interface GlobalState {
  readonly harness?: HarnessCompatibilityHarness;
  readonly recordDigest?: Sha256Digest;
  readonly fixtureDigest?: string;
  readonly fixtureDigestValid: boolean;
  readonly recordEvidenceValid: boolean;
  readonly sourceArtifacts: ReadonlyMap<string, ParsedArtifact>;
  readonly issues: readonly HarnessCompatibilityCapabilityDiscoveryDiagnostic[];
}

/**
 * Discover exact compatibility declarations as inert, decision-only catalog
 * entries. This function does not read files, inspect installed packages,
 * invoke a harness, execute a command, or perform network access.
 */
export function discoverHarnessCompatibilityCapabilities(
  input: HarnessCompatibilityCapabilityDiscoveryInput,
): HarnessCompatibilityCapabilityDiscoveryResult {
  const parsedInput = parseInput(input);
  const diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[] = [];
  const state = parseGlobalState(parsedInput.snapshot, parsedInput.evaluatedAt, diagnostics);
  const declarations = parseDeclarations(parsedInput.snapshot, state, diagnostics);
  const stubs = declarations.map((declaration) => {
    const stub: Record<string, string> = {};
    if (declaration.capabilityId !== undefined) stub.capabilityId = declaration.capabilityId;
    if (declaration.revision !== undefined) stub.revision = declaration.revision;
    return Object.freeze(stub);
  });

  if (stubs.length === 0) stubs.push(Object.freeze({}));

  for (const declaration of declarations) diagnostics.push(...declaration.diagnostics);
  const contribution = createCapabilityCatalogContribution({
    sourceId: "harness-compatibility",
    candidates: [],
    rejections: stubs.map((stub) => ({
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
    ...(state.harness === undefined ? {} : { harness: state.harness }),
    ...(state.recordDigest === undefined ? {} : { recordDigest: state.recordDigest }),
    candidates: Object.freeze([]),
    diagnostics: Object.freeze(sortedDiagnostics),
    contribution,
    catalog,
  });
}

/** Returns only the empty native compatibility candidate collection. */
export function discoverHarnessCompatibilityCapabilityCandidates(
  input: HarnessCompatibilityCapabilityDiscoveryInput,
): readonly CapabilityDescriptorCandidate[] {
  return discoverHarnessCompatibilityCapabilities(input).candidates;
}

/** Returns the Core-built decision-only catalog for an exact compatibility record. */
export function discoverHarnessCompatibilityCapabilityCatalog(
  input: HarnessCompatibilityCapabilityDiscoveryInput,
): CapabilityCatalogSnapshot {
  return discoverHarnessCompatibilityCapabilities(input).catalog;
}

function parseInput(input: unknown): { readonly evaluatedAt: string; readonly snapshot: CapturedSnapshot } {
  const record = plainRecord(input);
  if (record === undefined || !hasExactKeys(record, ["evaluatedAt", "snapshot"])) {
    throw new TypeError("Harness compatibility discovery input must contain only evaluatedAt and snapshot.");
  }
  const evaluatedAt = dataProperty(record, "evaluatedAt");
  if (!isCanonicalTimestamp(evaluatedAt)) {
    throw new TypeError("Harness compatibility discovery evaluatedAt must be a canonical ISO timestamp.");
  }
  const snapshotValue = dataProperty(record, "snapshot");
  return { evaluatedAt, snapshot: captureSnapshot(snapshotValue) };
}

function captureSnapshot(value: unknown): CapturedSnapshot {
  const record = plainRecord(value);
  if (record === undefined) return { fields: Object.freeze({}), unknownKeys: Object.freeze([]), valid: false };
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(record);
  } catch {
    return { fields: Object.freeze({}), unknownKeys: Object.freeze([]), valid: false };
  }

  const keys = Object.keys(descriptors);
  const allowed = new Set<string>(SNAPSHOT_KEYS);
  const unknownKeys = keys.filter((key) => !allowed.has(key));
  const fields: Record<string, CapturedValue> = Object.create(null) as Record<string, CapturedValue>;
  const budget: CloneBudget = { nodes: MAX_NODES, stringUnits: MAX_STRING_UNITS };
  let valid = unknownKeys.length === 0;

  for (const key of SNAPSHOT_KEYS) {
    const descriptor = descriptors[key];
    if (descriptor === undefined) {
      fields[key] = MISSING;
      valid = false;
      continue;
    }
    if (!descriptor.enumerable || !("value" in descriptor)) {
      fields[key] = INVALID;
      valid = false;
      continue;
    }
    if (key === "sourceArtifacts" || key === "capabilities" || key === "liveEvidence") {
      const collection = captureArrayEntries(descriptor.value, budget);
      fields[key] = collection;
      if (collection === INVALID) valid = false;
      continue;
    }
    const captured = cloneInert(descriptor.value, budget, 0, new WeakSet<object>());
    fields[key] = captured;
    if (captured === INVALID) valid = false;
  }

  return { fields: Object.freeze(fields), unknownKeys: Object.freeze(unknownKeys), valid };
}

function captureArrayEntries(value: unknown, budget: CloneBudget): CapturedValue {
  if (isProxy(value) || !Array.isArray(value)) return INVALID;
  let descriptors: Record<string, PropertyDescriptor>;
  try {
    descriptors = Object.getOwnPropertyDescriptors(value);
  } catch {
    return INVALID;
  }
  const lengthDescriptor = descriptors.length;
  if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
    || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0
    || lengthDescriptor.value > MAX_CAPABILITIES) return INVALID;
  const length = lengthDescriptor.value;
  const keys = Object.keys(descriptors);
  if (keys.length !== length + 1 || keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key))) return INVALID;

  const result: CapturedValue[] = [];
  for (let index = 0; index < length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) {
      result.push(INVALID);
      continue;
    }
    result.push(cloneInert(descriptor.value, budget, 0, new WeakSet<object>()));
  }
  return Object.freeze(result);
}

function parseGlobalState(
  snapshot: CapturedSnapshot,
  evaluatedAt: string,
  diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[],
): GlobalState {
  if (!snapshot.valid || snapshot.unknownKeys.length > 0) {
    addDiagnostic(diagnostics, "record_malformed", undefined, undefined, "The compatibility record is not the exact inert v1 shape.");
  }
  for (const key of snapshot.unknownKeys) {
    if (isSecretKey(key)) addDiagnostic(diagnostics, "secret_bearing_evidence", undefined, undefined, "The compatibility record contains secret-bearing evidence.");
  }

  const fields = snapshot.fields;
  const schema = dataProperty(fields, "schema");
  if (schema !== HARNESS_COMPATIBILITY_RECORD_SCHEMA) {
    addDiagnostic(diagnostics, "record_identity_mismatch", undefined, undefined, "The compatibility record schema identity is not admitted.");
  }

  const harness = parseHarness(dataProperty(fields, "harness"));
  if (harness === undefined) {
    addDiagnostic(diagnostics, "record_identity_mismatch", undefined, undefined, "The compatibility record harness identity is not admitted.");
  }

  const recordDigest = normalizeDigest(dataProperty(fields, "recordDigest"));
  if (recordDigest === undefined) {
    addDiagnostic(diagnostics, "record_digest_invalid", harness, undefined, "The caller-supplied record digest is malformed.");
  }

  let recordEvidenceValid = snapshot.valid && schema === HARNESS_COMPATIBILITY_RECORD_SCHEMA
    && harness !== undefined && recordDigest !== undefined;
  if (harness !== undefined) {
    recordEvidenceValid = parseSdk(fields.sdk, harness, diagnostics) && recordEvidenceValid;
    recordEvidenceValid = parseRuntime(fields.runtime, harness, diagnostics) && recordEvidenceValid;
    recordEvidenceValid = parseSource(fields.source, harness, diagnostics) && recordEvidenceValid;
  } else {
    recordEvidenceValid = false;
  }

  const sourceArtifacts = parseSourceArtifacts(fields.sourceArtifacts, diagnostics);
  if (sourceArtifacts.size === 0) recordEvidenceValid = false;

  const fixtureDigest = normalizeBareDigest(dataProperty(fields, "fixtureDigest"));
  const fixtureDigestValid = parseFixture(fields.fixture, fields.fixtureDigest, diagnostics);
  recordEvidenceValid = fixtureDigestValid && recordEvidenceValid;
  recordEvidenceValid = parseLiveEvidence(fields.liveEvidence, diagnostics) && recordEvidenceValid;

  const completeness = dataProperty(fields, "completeness");
  if (completeness !== "complete") {
    addDiagnostic(diagnostics, "incomplete_evidence", harness, undefined, "The compatibility observation is not complete.");
    recordEvidenceValid = false;
  }
  const invalidated = dataProperty(fields, "invalidated");
  if (invalidated !== false) {
    addDiagnostic(diagnostics, "invalidated_evidence", harness, undefined, "The compatibility observation is not explicitly non-invalidated.");
    recordEvidenceValid = false;
  }
  const freshness = parseFreshness(fields.freshness, evaluatedAt, harness, diagnostics);
  if (!freshness.valid) recordEvidenceValid = false;
  if (freshness.stale) recordEvidenceValid = false;

  return {
    ...(harness === undefined ? {} : { harness }),
    ...(recordDigest === undefined ? {} : { recordDigest }),
    ...(fixtureDigest === undefined ? {} : { fixtureDigest }),
    fixtureDigestValid,
    recordEvidenceValid,
    sourceArtifacts,
    issues: Object.freeze(diagnostics.slice()),
  };
}

function parseSdk(value: CapturedValue, harness: HarnessCompatibilityHarness, diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[]): boolean {
  const record = exactRecord(value, SDK_KEYS);
  const expected = EXPECTED_HARNESS_EVIDENCE[harness];
  if (record === undefined
    || record.package !== expected.sdkPackage
    || record.version !== expected.sdkVersion
    || typeof record.npmIntegrity !== "string"
    || !NPM_INTEGRITY_PATTERN.test(record.npmIntegrity)) {
    addDiagnostic(diagnostics, "sdk_evidence_invalid", harness, undefined, "The SDK package, version, or npm integrity evidence is invalid.");
    return false;
  }
  return true;
}

function parseRuntime(value: CapturedValue, harness: HarnessCompatibilityHarness, diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[]): boolean {
  const record = exactRecord(value, RUNTIME_KEYS);
  const expected = EXPECTED_HARNESS_EVIDENCE[harness];
  if (record === undefined
    || record.name !== expected.runtimeName
    || typeof record.observedVersion !== "string"
    || !SEMVER_PATTERN.test(record.observedVersion)
    || typeof record.observedAt !== "string"
    || !isCalendarDate(record.observedAt)
    || typeof record.relationshipToSdk !== "string"
    || !boundedString(record.relationshipToSdk)) {
    addDiagnostic(diagnostics, "runtime_evidence_invalid", harness, undefined, "The observed runtime version/date evidence is invalid.");
    return false;
  }
  return true;
}

function parseSource(value: CapturedValue, harness: HarnessCompatibilityHarness, diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[]): boolean {
  const record = exactRecord(value, SOURCE_KEYS);
  const expected = EXPECTED_HARNESS_EVIDENCE[harness];
  if (record === undefined
    || record.repository !== expected.repository
    || record.tag !== expected.tag
    || typeof record.commit !== "string"
    || !COMMIT_PATTERN.test(record.commit)) {
    addDiagnostic(diagnostics, "source_evidence_invalid", harness, undefined, "The exact source repository, tag, or commit evidence is invalid.");
    return false;
  }
  return true;
}

function parseSourceArtifacts(value: CapturedValue, diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[]): ReadonlyMap<string, ParsedArtifact> {
  if (value === INVALID || value === MISSING || !Array.isArray(value) || value.length === 0 || value.length > MAX_ARTIFACTS) {
    addDiagnostic(diagnostics, "source_artifact_mismatch", undefined, undefined, "The source-artifact evidence collection is malformed.");
    return new Map();
  }
  const artifacts = new Map<string, ParsedArtifact>();
  let valid = true;
  for (const entry of value) {
    const record = exactRecord(entry, SOURCE_ARTIFACT_KEYS);
    if (record === undefined
      || typeof record.id !== "string" || !boundedIdentifier(record.id, ARTIFACT_ID_PATTERN)
      || (record.origin !== "official-repository" && record.origin !== "published-npm-package")
      || typeof record.path !== "string" || !safeRelativePath(record.path)
      || typeof record.sha256 !== "string" || !BARE_DIGEST_PATTERN.test(record.sha256)
      || typeof record.supports !== "string" || !boundedString(record.supports)
      || containsSecret(entry)) {
      valid = false;
      continue;
    }
    if (artifacts.has(record.id)) {
      valid = false;
      continue;
    }
    artifacts.set(record.id, { id: record.id });
  }
  if (!valid) addDiagnostic(diagnostics, "source_artifact_mismatch", undefined, undefined, "A source artifact is malformed, duplicated, or secret-bearing.");
  if (artifacts.size === 0) addDiagnostic(diagnostics, "source_artifact_mismatch", undefined, undefined, "No safe source artifact identity is available.");
  return artifacts;
}

function parseFixture(value: CapturedValue, digestValue: CapturedValue, diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[]): boolean {
  const record = exactRecord(value, FIXTURE_KEYS);
  const expectedDigest = normalizeBareDigest(digestValue);
  if (record === undefined
    || typeof record.path !== "string" || !safeRelativePath(record.path)
    || record.kind !== "synthetic"
    || typeof record.sha256 !== "string" || !BARE_DIGEST_PATTERN.test(record.sha256)
    || expectedDigest === undefined
    || record.sha256 !== expectedDigest) {
    addDiagnostic(diagnostics, "fixture_digest_mismatch", undefined, undefined, "The caller-supplied fixture digest does not match the exact fixture evidence.");
    return false;
  }
  return true;
}

function parseLiveEvidence(value: CapturedValue, diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[]): boolean {
  if (value === INVALID || value === MISSING || !Array.isArray(value) || value.length === 0 || value.length > MAX_LIVE_EVIDENCE) {
    addDiagnostic(diagnostics, "record_malformed", undefined, undefined, "The live-evidence collection is malformed or unbounded.");
    return false;
  }
  let valid = true;
  for (const entry of value) {
    const record = exactRecord(entry, LIVE_EVIDENCE_KEYS);
    if (record === undefined
      || typeof record.scope !== "string" || !boundedString(record.scope)
      || typeof record.command !== "string" || !boundedString(record.command)
      || typeof record.bound !== "string" || !boundedString(record.bound)
      || (record.status !== "observed" && record.status !== "failed" && record.status !== "not-run")
      || typeof record.result !== "string" || !boundedString(record.result)
      || containsSecret(entry)) valid = false;
  }
  if (!valid) addDiagnostic(diagnostics, "record_malformed", undefined, undefined, "A live-evidence declaration is malformed or secret-bearing.");
  return valid;
}

function parseFreshness(
  value: CapturedValue,
  evaluatedAt: string,
  harness: HarnessCompatibilityHarness | undefined,
  diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[],
): ParsedFreshness {
  const record = exactRecord(value, FRESHNESS_KEYS);
  if (record === undefined
    || !isCanonicalTimestamp(record.observedAt)
    || !isCanonicalTimestamp(record.validUntil)
    || (record.status !== "current" && record.status !== "stale" && record.status !== "unknown")) {
    addDiagnostic(diagnostics, "freshness_invalid", harness, undefined, "The compatibility TTL observation is malformed.");
    return { valid: false, stale: false };
  }
  const observed = Date.parse(record.observedAt);
  const validUntil = Date.parse(record.validUntil);
  const evaluated = Date.parse(evaluatedAt);
  if (observed >= validUntil || observed > evaluated || validUntil - observed > MAX_TTL_MS) {
    addDiagnostic(diagnostics, "contradictory_evidence", harness, undefined, "The compatibility TTL observation is contradictory or unbounded.");
    return { valid: false, stale: false };
  }
  const stale = record.status !== "current" || validUntil <= evaluated;
  if (stale) addDiagnostic(diagnostics, "stale_evidence", harness, undefined, "The compatibility evidence is stale at the evaluation instant.");
  return { valid: true, stale };
}

function parseDeclarations(
  snapshot: CapturedSnapshot,
  state: GlobalState,
  diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[],
): readonly ParsedDeclaration[] {
  const value = snapshot.fields.capabilities;
  if (value === INVALID || value === MISSING || !Array.isArray(value) || value.length === 0 || value.length > MAX_CAPABILITIES) {
    addDiagnostic(diagnostics, "record_malformed", state.harness, undefined, "The capability declaration collection is malformed or unbounded.");
    return Object.freeze([]);
  }
  const declarations: ParsedDeclaration[] = [];
  for (const entry of value) {
    const parsed = parseDeclaration(entry, state);
    declarations.push(parsed);
  }
  return Object.freeze(declarations);
}

function parseDeclaration(value: unknown, state: GlobalState): ParsedDeclaration {
  const safeId = extractSafeCapabilityId(value);
  const record = allowedRecord(value, CAPABILITY_KEYS, CAPABILITY_KEYS.slice(0, 7));
  const diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[] = [];
  const revision = deriveRevision(state, safeId, record);
  const capabilityId = safeId;
  if (record === undefined) {
    addDiagnostic(diagnostics, "capability_malformed", state.harness, capabilityId, "A capability declaration is not the exact inert v1 shape.");
    if (containsSecret(value)) addDiagnostic(diagnostics, "secret_bearing_evidence", state.harness, capabilityId, "A capability declaration contains secret-bearing evidence.");
    return { ...(capabilityId === undefined ? {} : { capabilityId }), ...(revision === undefined ? {} : { revision }), valid: false, eligible: false, experimental: false, diagnostics: Object.freeze(diagnostics) };
  }

  const classificationValid = record.classification === "portable-function/mcp"
    || record.classification === "hosted-provider"
    || record.classification === "harness-private"
    || record.classification === "lossy/unrepresentable";
  const stabilityValid = record.stability === "stable" || record.stability === "private" || record.stability === "experimental";
  const representationValid = record.representation === "lossless" || record.representation === "lossy" || record.representation === "unrepresentable";
  const semanticLoss = boundedStringArray(record.semanticLoss, MAX_SEMANTIC_LOSS);
  const sourceArtifactRefs = boundedStringArray(record.sourceArtifacts, MAX_ARTIFACTS);
  const endpoints = record.endpoints === undefined ? [] : boundedStringArray(record.endpoints, MAX_ENDPOINTS);
  const shapeValid = capabilityId !== undefined
    && classificationValid
    && stabilityValid
    && typeof record.eligible === "boolean"
    && representationValid
    && semanticLoss !== undefined
    && sourceArtifactRefs !== undefined
    && endpoints !== undefined
    && !containsSecret(value);

  if (semanticLoss === undefined || sourceArtifactRefs === undefined || endpoints === undefined
    || capabilityId === undefined || !classificationValid || !stabilityValid
    || typeof record.eligible !== "boolean" || !representationValid) {
    addDiagnostic(diagnostics, "capability_malformed", state.harness, capabilityId, "A capability declaration contains invalid bounded fields.");
  }
  if (containsSecret(value)) addDiagnostic(diagnostics, "secret_bearing_evidence", state.harness, capabilityId, "A capability declaration contains secret-bearing evidence.");

  const artifactMismatch = sourceArtifactRefs === undefined
    || sourceArtifactRefs.some((artifactId) => !state.sourceArtifacts.has(artifactId));
  if (artifactMismatch) addDiagnostic(diagnostics, "source_artifact_mismatch", state.harness, capabilityId, "A capability declaration references an unknown source artifact.");

  const eligible = shapeValid && !artifactMismatch && record.eligible === true;
  const experimental = shapeValid && record.stability === "experimental";
  if (shapeValid && record.stability === "experimental") {
    addDiagnostic(diagnostics, "experimental_contract", state.harness, capabilityId, "Experimental native contracts remain ineligible.");
  }
  if (shapeValid && record.eligible === false) {
    addDiagnostic(diagnostics, "source_declared_ineligible", state.harness, capabilityId, "The compatibility source declares this capability ineligible.");
  }
  if (shapeValid && record.eligible === true && record.stability === "experimental") {
    addDiagnostic(diagnostics, "contradictory_evidence", state.harness, capabilityId, "An experimental declaration cannot be source-eligible.");
  }
  if (shapeValid && record.eligible === true && record.representation === "unrepresentable") {
    addDiagnostic(diagnostics, "contradictory_evidence", state.harness, capabilityId, "An unrepresentable declaration cannot be source-eligible.");
  }
  if (shapeValid && record.eligible === true && record.representation === "lossless" && semanticLoss !== undefined && semanticLoss.length > 0) {
    addDiagnostic(diagnostics, "contradictory_evidence", state.harness, capabilityId, "A lossless declaration cannot carry semantic-loss evidence.");
  }

  const hasContradiction = (record.stability === "experimental" && record.eligible === true)
    || (record.representation === "unrepresentable" && record.eligible === true)
    || (record.representation === "lossless" && semanticLoss !== undefined && semanticLoss.length > 0);
  if (state.recordEvidenceValid && state.fixtureDigestValid && shapeValid && !artifactMismatch
    && record.eligible === true && !hasContradiction) {
    addDiagnostic(diagnostics, "native_route_deferred", state.harness, capabilityId, "Native search and execution routes are deferred.");
  }

  const declarationDigest = shapeValid && semanticLoss !== undefined && sourceArtifactRefs !== undefined && endpoints !== undefined
    ? sha256ContentIdentity(stableStringify({
      id: record.id,
      classification: record.classification,
      stability: record.stability,
      eligible: record.eligible,
      representation: record.representation,
      semanticLoss: [...semanticLoss].sort(compareCodeUnits),
      sourceArtifacts: [...sourceArtifactRefs].sort(compareCodeUnits),
      endpoints: [...endpoints].sort(compareCodeUnits),
    })) as Sha256Digest
    : undefined;
  const derivedRevision = declarationDigest === undefined || state.recordDigest === undefined || capabilityId === undefined
    ? revision
    : sha256ContentIdentity(stableStringify({
      adapter: HARNESS_COMPATIBILITY_CAPABILITY_DISCOVERY_REVISION,
      recordDigest: state.recordDigest,
      fixtureDigest: snapshotFixtureDigest(state),
      harness: state.harness,
      capabilityId,
      declarationDigest,
    })) as Sha256Digest;
  return {
    ...(capabilityId === undefined ? {} : { capabilityId }),
    ...(derivedRevision === undefined ? {} : { revision: derivedRevision }),
    valid: shapeValid && !artifactMismatch,
    eligible,
    experimental,
    ...(declarationDigest === undefined ? {} : { declarationDigest }),
    diagnostics: Object.freeze(diagnostics),
  };
}

function snapshotFixtureDigest(state: GlobalState): string | undefined {
  return state.fixtureDigestValid ? state.fixtureDigest : undefined;
}

function deriveRevision(state: GlobalState, capabilityId: string | undefined, record: Record<string, unknown> | undefined): Sha256Digest | undefined {
  if (state.recordDigest === undefined || capabilityId === undefined) return undefined;
  return sha256ContentIdentity(stableStringify({
    adapter: HARNESS_COMPATIBILITY_CAPABILITY_DISCOVERY_REVISION,
    recordDigest: state.recordDigest,
    harness: state.harness,
    capabilityId,
    declaration: record === undefined ? "malformed" : "unparsed",
  })) as Sha256Digest;
}

function exactRecord(value: CapturedValue | unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === INVALID || value === MISSING || !plainObject(value)) return undefined;
  return hasExactKeys(value, keys) ? value : undefined;
}

function allowedRecord(
  value: CapturedValue | unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[],
): Record<string, unknown> | undefined {
  if (value === INVALID || value === MISSING || !plainObject(value)) return undefined;
  const actual = Object.keys(value);
  return actual.every((key) => allowedKeys.includes(key))
    && requiredKeys.every((key) => Object.hasOwn(value, key))
    ? value
    : undefined;
}

function parseHarness(value: CapturedValue): HarnessCompatibilityHarness | undefined {
  return typeof value === "string" && (HARNESS_COMPATIBILITY_HARNESSES as readonly string[]).includes(value)
    ? value as HarnessCompatibilityHarness
    : undefined;
}

function extractSafeCapabilityId(value: unknown): string | undefined {
  if (!plainObject(value)) return undefined;
  const descriptor = ownDataDescriptor(value, "id");
  if (descriptor === undefined || typeof descriptor.value !== "string" || !CAPABILITY_ID_PATTERN.test(descriptor.value)) return undefined;
  return descriptor.value;
}

function cloneInert(value: unknown, budget: CloneBudget, depth: number, seen: WeakSet<object>): CapturedValue {
  if (--budget.nodes < 0 || depth > MAX_DEPTH) return INVALID;
  if (typeof value === "string") {
    budget.stringUnits -= value.length;
    return budget.stringUnits < 0 ? INVALID : value;
  }
  if (value === null || typeof value === "boolean" || value === undefined) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : INVALID;
  if (typeof value !== "object") return INVALID;
  if (isProxy(value)) return INVALID;
  if (seen.has(value)) return INVALID;
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      let descriptors: Record<string, PropertyDescriptor>;
      try {
        descriptors = Object.getOwnPropertyDescriptors(value);
      } catch {
        return INVALID;
      }
      const lengthDescriptor = descriptors.length;
      if (lengthDescriptor === undefined || !("value" in lengthDescriptor)
        || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0 || lengthDescriptor.value > MAX_CAPABILITIES) return INVALID;
      const length = lengthDescriptor.value;
      const keys = Object.keys(descriptors);
      if (keys.length !== length + 1 || keys.some((key) => key !== "length" && !/^(?:0|[1-9]\d*)$/u.test(key))) return INVALID;
      const result: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return INVALID;
        const child = cloneInert(descriptor.value, budget, depth + 1, seen);
        if (child === INVALID) return INVALID;
        result.push(child);
      }
      return Object.freeze(result);
    }
    if (!plainObject(value)) return INVALID;
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(value);
    } catch {
      return INVALID;
    }
    const keys = Object.keys(descriptors);
    if (keys.length > 128) return INVALID;
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor === undefined || !descriptor.enumerable || !("value" in descriptor)) return INVALID;
      const child = cloneInert(descriptor.value, budget, depth + 1, seen);
      if (child === INVALID) return INVALID;
      result[key] = child;
    }
    return Object.freeze(result);
  } finally {
    seen.delete(value);
  }
}

function plainRecord(value: unknown): Record<string, unknown> | undefined {
  return plainObject(value) ? value : undefined;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataDescriptor(value: object, key: string): PropertyDescriptor | undefined {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && descriptor.enumerable && "value" in descriptor ? descriptor : undefined;
  } catch {
    return undefined;
  }
}

function dataProperty(value: CapturedValue | Record<string, unknown>, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  return ownDataDescriptor(value, key)?.value;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(record, key));
}

function boundedIdentifier(value: string, pattern: RegExp): boolean {
  return value.length <= 127 && pattern.test(value);
}

function boundedString(value: string): boolean {
  return value.length > 0 && value.length <= 16_384 && !containsSecret(value);
}

function boundedStringArray(value: unknown, maximum: number): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum) return undefined;
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !boundedString(entry)) return undefined;
    result.push(entry);
  }
  return Object.freeze(result);
}

function normalizeDigest(value: unknown): Sha256Digest | undefined {
  if (typeof value !== "string") return undefined;
  if (DIGEST_PATTERN.test(value)) return value as Sha256Digest;
  if (BARE_DIGEST_PATTERN.test(value)) return `sha256:${value}` as Sha256Digest;
  return undefined;
}

function normalizeBareDigest(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (BARE_DIGEST_PATTERN.test(value)) return value;
  if (DIGEST_PATTERN.test(value)) return value.slice("sha256:".length);
  return undefined;
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !TIMESTAMP_PATTERN.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function safeRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 512 || !RELATIVE_PATH_PATTERN.test(value)) return false;
  return !value.split("/").some((part) => part === ".." || part.length === 0);
}

function containsSecret(value: unknown): boolean {
  const pending: Array<{ readonly value: unknown; readonly key?: string }> = [{ value }];
  const seen = new WeakSet<object>();
  let visited = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined || ++visited > MAX_NODES) return true;
    const current = item.value;
    if (item.key !== undefined && isSecretKey(item.key)) return true;
    if (typeof current === "string") {
      if (current.length > 16_384 || secretValuePattern(current)) return true;
      continue;
    }
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      for (const entry of current) pending.push({ value: entry });
      continue;
    }
    for (const key of Object.keys(current)) {
      const descriptor = ownDataDescriptor(current, key);
      if (descriptor !== undefined) pending.push({ value: descriptor.value, key });
    }
  }
  return false;
}

function isSecretKey(value: string): boolean {
  return /(?:authorization|cookie|credential|password|passwd|private[_-]?key|secret|token|api[_-]?key|access[_-]?key)/iu.test(value);
}

function secretValuePattern(value: string): boolean {
  return /(?:^|[._:/+\-])Bearer\s+\S+/iu.test(value)
    || /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u.test(value)
    || /(?:^|[._:/+\-])[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/iu.test(value)
    || /(?:^|[._:/+\-])(?:sk|pk|ghp|github_pat|xox[baprs])_[A-Za-z0-9_-]{8,}(?=$|[.:/+\-])/u.test(value)
    || /(?:^|[._:/+\-])AKIA[0-9A-Z]{16}(?=$|[.:/+\-])/u.test(value)
    || /(?:password|passwd|secret|token|api[_-]?key)\s*[=:]\s*\S+/iu.test(value)
    || /[A-Za-z]:\\Users\\/u.test(value);
}

function addDiagnostic(
  diagnostics: HarnessCompatibilityCapabilityDiscoveryDiagnostic[],
  code: HarnessCompatibilityCapabilityDiscoveryDiagnosticCode,
  harness: HarnessCompatibilityHarness | undefined,
  capabilityId: string | undefined,
  message: string,
  severity: "warning" | "error" = "error",
): void {
  diagnostics.push({
    code,
    ...(harness === undefined ? {} : { harness }),
    ...(capabilityId === undefined ? {} : { capabilityId }),
    message,
    severity,
  });
}

function compareDiagnostics(
  left: HarnessCompatibilityCapabilityDiscoveryDiagnostic,
  right: HarnessCompatibilityCapabilityDiscoveryDiagnostic,
): number {
  return compareCodeUnits(left.harness ?? "", right.harness ?? "")
    || compareCodeUnits(left.capabilityId ?? "", right.capabilityId ?? "")
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.message, right.message);
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
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

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
