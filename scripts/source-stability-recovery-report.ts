/** Pure, fail-closed contract helpers for Source Stability recovery evidence. */

import { createHash } from "node:crypto";
import * as nodePath from "node:path";
import {
  KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV,
  KILN_LIVE_OPENAI_DIRECT_TESTS_ENV,
  MANAGED_AGENT_LIVE_CONFIGURATION_FLAGS,
} from "./managed-agent-live-preflight.js";

export const SOURCE_STABILITY_RECOVERY_MANIFEST_SCHEMA = "kiln.source-stability-recovery-manifest/v1" as const;
export const SOURCE_STABILITY_RECOVERY_REPORT_SCHEMA = "kiln.source-stability-recovery-report/v1" as const;
export const SOURCE_STABILITY_RECOVERY_SCENARIO = "source-stability-recovery" as const;
export const KILN_LIVE_MANAGED_AGENT_TESTS = "KILN_LIVE_MANAGED_AGENT_TESTS" as const;

export const CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS = [
  "revision-pinning",
  "crash-before-fence",
  "post-fence-unknown",
  "duplicate-ingress",
  "transport-disconnect",
  "child-acquisition-cleanup",
  "cancellation-settlement",
  "restart-recovery",
  "stale-evidence",
  "conflicting-evidence",
  "corrupt-evidence",
  "settlement-capacity-retention",
] as const;

export type SourceStabilityRecoveryCaseId = (typeof CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS)[number];
export type SourceStabilityProviderId = "codex" | "codex-oauth" | "claude" | "opencode" | "opencode-go" | "openai" | "kiln";
export type SourceStabilityHarnessId =
  | "codex-cli"
  | "claude-cli"
  | "opencode-cli"
  | "kiln-direct-runtime"
  | "kiln-managed-account-runtime"
  | "kiln-runtime-fixture";
export type SourceStabilityLiveCoverage = "exact" | "partial" | "none";
export type SourceStabilityCaseStatus = "executed" | "failed" | "skipped" | "omitted";
export type SourceStabilityVitestStatus = "passed" | "failed" | "skipped" | "todo" | "pending";
export type SourceStabilityCleanupStatus = "verified" | "unverified" | "not-run";
export type SourceStabilityLiveProofId = string;
export type SourceStabilityLiveProofStatus = SourceStabilityCaseStatus;

export type SourceStabilityRecoveryDiagnosticCode =
  | "input-shape"
  | "manifest-fields"
  | "schema-mismatch"
  | "version-mismatch"
  | "scenario-mismatch"
  | "cases-shape"
  | "case-fields"
  | "case-id"
  | "case-duplicate"
  | "case-missing"
  | "case-owner"
  | "case-state"
  | "case-cleanup"
  | "deterministic-evidence"
  | "live-fields"
  | "live-coverage"
  | "live-locators"
  | "live-authority-flags"
  | "live-configuration-flags"
  | "duplicate-locator"
  | "unsafe-path"
  | "outside-root"
  | "unsafe-metadata"
  | "unsafe-title"
  | "authority-flag"
  | "repository-root"
  | "test-results-shape"
  | "test-result-fields"
  | "assertion-fields"
  | "assertion-status"
  | "observation-fields"
  | "observation-duplicate";

export interface SourceStabilityRecoveryDiagnostic {
  readonly code: SourceStabilityRecoveryDiagnosticCode;
  readonly message: string;
}

export interface SourceStabilityParseValidResult<T> {
  readonly status: "valid";
  readonly value: T;
  readonly diagnostics: readonly [];
}

export interface SourceStabilityParseInvalidResult {
  readonly status: "invalid";
  readonly diagnostics: readonly SourceStabilityRecoveryDiagnostic[];
}

export type SourceStabilityParseResult<T> =
  | SourceStabilityParseValidResult<T>
  | SourceStabilityParseInvalidResult;

export interface SourceStabilityEvidenceLocator {
  path: string;
  title: string;
}

/** Catalog-owned locator: provider and harness are fields on the proof, not duplicated here. */
export interface SourceStabilityLiveEvidenceLocator extends SourceStabilityEvidenceLocator {}

interface SourceStabilityResolvedLiveEvidenceLocator extends SourceStabilityEvidenceLocator {
  readonly providerId: SourceStabilityProviderId;
  readonly harnessId: SourceStabilityHarnessId;
  readonly model?: string;
}

export interface SourceStabilityLiveEvidence {
  readonly coverage: SourceStabilityLiveCoverage;
  readonly proofIds: readonly SourceStabilityLiveProofId[];
  /** Type-only visibility for the runner's pending migration; parser never persists this field. */
  readonly locators: readonly SourceStabilityLiveEvidenceLocator[];
}

export interface SourceStabilityLiveProofBase {
  readonly kind: "implemented" | "planned";
  readonly id: SourceStabilityLiveProofId;
  readonly owner: string;
  readonly expectedState: string;
  readonly cleanup: string;
}

export interface SourceStabilityImplementedLiveProof extends SourceStabilityLiveProofBase {
  readonly kind: "implemented";
  readonly locator: SourceStabilityLiveEvidenceLocator;
  readonly providerId: SourceStabilityProviderId;
  readonly harnessId: SourceStabilityHarnessId;
  readonly authorityFlags: readonly string[];
  readonly configurationFlags: readonly string[];
}

export interface SourceStabilityPlannedLiveProof extends SourceStabilityLiveProofBase {
  readonly kind: "planned";
}

export type SourceStabilityLiveProof = SourceStabilityImplementedLiveProof | SourceStabilityPlannedLiveProof;

export interface SourceStabilityRecoveryManifestCase {
  readonly id: SourceStabilityRecoveryCaseId;
  readonly owner: string;
  readonly expectedState: string;
  readonly cleanup: string;
  readonly deterministicEvidence: readonly SourceStabilityEvidenceLocator[];
  readonly liveEvidence: SourceStabilityLiveEvidence;
}

export interface SourceStabilityRecoveryManifest {
  readonly schema: typeof SOURCE_STABILITY_RECOVERY_MANIFEST_SCHEMA;
  readonly version: 1;
  readonly scenario: typeof SOURCE_STABILITY_RECOVERY_SCENARIO;
  readonly liveProofs: readonly SourceStabilityLiveProof[];
  readonly cases: readonly SourceStabilityRecoveryManifestCase[];
}

export interface ParsedVitestSourceStabilityAssertion {
  readonly path: string;
  readonly title: string;
  readonly fullName: string;
  readonly status: SourceStabilityVitestStatus;
}

export interface SourceStabilityExecutorProvenance {
  readonly providerId: SourceStabilityProviderId;
  readonly harnessId: SourceStabilityHarnessId;
  readonly harnessVersion: string;
  readonly model?: string;
  readonly enabledAuthorityFlags: readonly string[];
}

export interface SourceStabilityRecoveryCandidateMetadata {
  readonly commit: string;
  readonly dirty: boolean;
}

export interface SourceStabilityRecoveryEnvironmentMetadata {
  readonly platform: string;
  readonly arch: string;
  readonly bun: string;
  readonly node: string;
}

export type SourceStabilityLiveRunStatus = "not-started" | "completed" | "failed";
export type SourceStabilityLiveRunReasonCode =
  | "preflight-denied"
  | "executor-provenance-unavailable"
  | "spawn-failed"
  | "test-process-terminated"
  | "test-process-timeout"
  | "test-process-interrupted"
  | "test-output-limit"
  | "invalid-live-observation"
  | "missing-json"
  | "malformed-json"
  | "test-process-nonzero";

export interface SourceStabilityLiveRun {
  readonly status: SourceStabilityLiveRunStatus;
  readonly reasonCode?: SourceStabilityLiveRunReasonCode;
  readonly exitCode?: number;
}

export interface SourceStabilityRecoveryReportInput {
  readonly manifest: SourceStabilityRecoveryManifest;
  /** Trusted by the caller; used only to strip Vitest's absolute file prefix. */
  readonly repositoryRoot: string;
  readonly candidate: SourceStabilityRecoveryCandidateMetadata;
  readonly environment: SourceStabilityRecoveryEnvironmentMetadata;
  readonly executors: readonly SourceStabilityExecutorProvenance[];
  readonly selectedAuthorityFlags: readonly string[];
  readonly preflight: "allowed" | "denied";
  readonly liveRun: SourceStabilityLiveRun;
  readonly liveVitest?: unknown;
  readonly deterministicVitest?: unknown;
}

export type SourceStabilityReportReasonCode =
  | "test-passed"
  | "test-failed"
  | "test-skipped"
  | "preflight-denied"
  | "no-exact-live-case"
  | "no-partial-observation"
  | "partial-observation"
  | "ambiguous-observation"
  | "no-deterministic-observation"
  | "live-run-failed";

export type SourceStabilityLiveProofReasonCode =
  | SourceStabilityReportReasonCode
  | "authority-not-enabled"
  | "executor-provenance-unavailable"
  | "no-live-observation"
  | "proof-not-implemented";

export type SourceStabilityLiveProofOutcome = "passed" | "failed" | "inconclusive";

export interface SourceStabilityReportObservation {
  readonly status: SourceStabilityCaseStatus;
  readonly reasonCode: SourceStabilityReportReasonCode;
  readonly cleanup: SourceStabilityCleanupStatus;
}

export interface SourceStabilityRecoveryReportCase {
  readonly id: SourceStabilityRecoveryCaseId;
  readonly deterministic: SourceStabilityReportObservation & {
    readonly evidence: readonly SourceStabilityEvidenceLocator[];
  };
  readonly live: SourceStabilityReportObservation & {
    readonly coverage: SourceStabilityLiveCoverage;
    readonly proofIds: readonly SourceStabilityLiveProofId[];
    readonly selectedLocator?: SourceStabilityResolvedLiveEvidenceLocator;
    readonly executor?: SourceStabilityExecutorProvenance;
    readonly partialObservation?: SourceStabilityReportObservation;
  };
  readonly cleanup: SourceStabilityCleanupStatus;
}

export interface SourceStabilityRecoveryReportLiveProof {
  readonly kind: "implemented" | "planned";
  readonly id: SourceStabilityLiveProofId;
  readonly owner: string;
  readonly expectedState: string;
  readonly cleanupContract: string;
  readonly locator?: SourceStabilityLiveEvidenceLocator;
  readonly providerId?: SourceStabilityProviderId;
  readonly harnessId?: SourceStabilityHarnessId;
  readonly authorityFlags?: readonly string[];
  readonly configurationFlags?: readonly string[];
  readonly status: SourceStabilityLiveProofStatus;
  readonly reasonCode: SourceStabilityLiveProofReasonCode;
  readonly cleanup: SourceStabilityCleanupStatus;
  readonly selectedLocator?: SourceStabilityResolvedLiveEvidenceLocator;
  readonly executor?: SourceStabilityExecutorProvenance;
}

export interface SourceStabilityRecoveryReport {
  readonly schema: typeof SOURCE_STABILITY_RECOVERY_REPORT_SCHEMA;
  readonly version: 1;
  readonly scenario: typeof SOURCE_STABILITY_RECOVERY_SCENARIO;
  readonly releaseReadiness: "not-evidence";
  readonly notice: "This report is not release-readiness evidence.";
  readonly candidate: SourceStabilityRecoveryCandidateMetadata;
  readonly environment: SourceStabilityRecoveryEnvironmentMetadata;
  readonly executors: readonly SourceStabilityExecutorProvenance[];
  readonly enabledAuthorityFlags: readonly string[];
  readonly preflight: "allowed" | "denied";
  readonly liveRun: SourceStabilityLiveRun;
  readonly liveProofOutcome: SourceStabilityLiveProofOutcome;
  readonly liveProofs: readonly SourceStabilityRecoveryReportLiveProof[];
  readonly terminalOutcome: "passed" | "failed" | "inconclusive";
  readonly cleanupOutcome: SourceStabilityCleanupStatus;
  readonly residualRisks: readonly SourceStabilityResidualRisk[];
  readonly cases: readonly SourceStabilityRecoveryReportCase[];
}

export type SourceStabilityResidualRisk =
  | "candidate-dirty"
  | "executor-provenance-unavailable"
  | "deterministic-evidence-not-run"
  | "live-evidence-not-exact"
  | `live-run-failed:${SourceStabilityLiveRunReasonCode}`
  | `proof-failed:${SourceStabilityLiveProofId}`
  | `proof-skipped:${SourceStabilityLiveProofId}`
  | `proof-omitted:${SourceStabilityLiveProofId}`
  | `proof-not-implemented:${SourceStabilityLiveProofId}`
  | `case-failed:${SourceStabilityRecoveryCaseId}`
  | `case-skipped:${SourceStabilityRecoveryCaseId}`
  | `case-omitted:${SourceStabilityRecoveryCaseId}`;

const CASE_ID_SET: ReadonlySet<string> = new Set(CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS);
const PROVIDER_IDS: ReadonlySet<string> = new Set(["codex", "codex-oauth", "claude", "opencode", "opencode-go", "openai", "kiln"]);
const HARNESS_IDS: ReadonlySet<string> = new Set([
  "codex-cli",
  "claude-cli",
  "opencode-cli",
  "kiln-direct-runtime",
  "kiln-managed-account-runtime",
  "kiln-runtime-fixture",
]);
interface AuthorityPolicy {
  readonly required: readonly string[];
  readonly allowed: readonly string[];
}

const PROVIDER_HARNESS_AUTHORITY_POLICIES: Readonly<Record<string, AuthorityPolicy>> = {
  "codex\u0000codex-cli": { required: [KILN_LIVE_CODEX_TESTS_ENV], allowed: [KILN_LIVE_CODEX_TESTS_ENV] },
  "claude\u0000claude-cli": { required: [KILN_LIVE_CLAUDE_TESTS_ENV], allowed: [KILN_LIVE_CLAUDE_TESTS_ENV] },
  "opencode\u0000opencode-cli": {
    required: [KILN_LIVE_OPENCODE_TESTS_ENV],
    allowed: [KILN_LIVE_OPENCODE_TESTS_ENV, KILN_LIVE_OPENCODE_WRITE_PROOF_TESTS_ENV],
  },
  "opencode-go\u0000kiln-direct-runtime": {
    required: [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV],
    allowed: [KILN_LIVE_OPENCODE_GO_DIRECT_WRITE_TESTS_ENV],
  },
  "openai\u0000kiln-direct-runtime": {
    required: [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV],
    allowed: [KILN_LIVE_OPENAI_DIRECT_TESTS_ENV],
  },
  "codex-oauth\u0000kiln-direct-runtime": {
    required: [],
    allowed: [KILN_LIVE_CODEX_OAUTH_DIRECT_TESTS_ENV, KILN_LIVE_CODEX_OAUTH_DIRECT_WRITE_TESTS_ENV],
  },
  "codex-oauth\u0000kiln-managed-account-runtime": {
    required: [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV],
    allowed: [KILN_LIVE_CODEX_OAUTH_MANAGED_ACCOUNT_TESTS_ENV],
  },
  "kiln\u0000kiln-runtime-fixture": {
    required: [],
    allowed: [],
  },
};
const CONFIGURATION_FLAGS: ReadonlySet<string> = new Set(MANAGED_AGENT_LIVE_CONFIGURATION_FLAGS);
const AUTHORITY_FLAGS: ReadonlySet<string> = new Set([
  KILN_LIVE_MANAGED_AGENT_TESTS,
  ...Object.values(PROVIDER_HARNESS_AUTHORITY_POLICIES).flatMap((policy) => policy.allowed),
]);
const MANIFEST_FIELDS = ["schema", "version", "scenario", "liveProofs", "cases"] as const;
const CASE_FIELDS = ["id", "owner", "expectedState", "cleanup", "deterministicEvidence", "liveEvidence"] as const;
const LOCATOR_FIELDS = ["path", "title"] as const;
const LIVE_LOCATOR_FIELDS = ["path", "title"] as const;
const LIVE_PROOF_FIELDS = ["kind", "id", "owner", "expectedState", "cleanup", "locator", "providerId", "harnessId", "authorityFlags", "configurationFlags"] as const;
const LIVE_PLANNED_PROOF_FIELDS = ["kind", "id", "owner", "expectedState", "cleanup"] as const;
const LIVE_FIELDS = ["coverage", "proofIds"] as const;
const REPOSITORY_RELATIVE_PATH = /^[^/]+(?:\/[^/]+)*$/u;
const SAFE_FLAG = /^KILN_[A-Z0-9_]{2,96}$/u;
const SEMVER = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const SENSITIVE_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}\b/iu,
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/iu,
  /\bgithub_pat_[A-Za-z0-9_]{8,}\b/iu,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u,
  /\bbearer\s+[A-Za-z0-9._~+/-]{8,}/iu,
  /\b(?:AKIA|ASIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|APKA)[A-Z0-9]{16}\b/u,
  /\bAIza[A-Za-z0-9_-]{20,}\b/u,
  /\bglpat-[A-Za-z0-9_-]{8,}\b/iu,
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/iu,
  /\b(?:account|subscription)[_ -]?(?:id|identifier|ref|reference)\s*[:=_-]\s*[A-Za-z0-9._-]{3,}/iu,
  /\b(?:acct|sub)[-_][A-Za-z0-9._-]{3,}\b/iu,
];

function authorityPolicyFor(
  providerId: SourceStabilityProviderId,
  harnessId: SourceStabilityHarnessId,
): AuthorityPolicy | undefined {
  return PROVIDER_HARNESS_AUTHORITY_POLICIES[`${providerId}\u0000${harnessId}`];
}

function policyHasAuthority(policy: AuthorityPolicy, flags: ReadonlySet<string>): boolean {
  return policy.required.every((flag) => flags.has(flag)) && (policy.allowed.length === 0 || policy.allowed.some((flag) => flags.has(flag)));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addDiagnostic(
  diagnostics: SourceStabilityRecoveryDiagnostic[],
  code: SourceStabilityRecoveryDiagnosticCode,
  message: string,
): void {
  diagnostics.push({ code, message });
}

function invalid<T>(diagnostics: readonly SourceStabilityRecoveryDiagnostic[]): SourceStabilityParseResult<T> {
  return { status: "invalid", diagnostics };
}

function valid<T>(value: T): SourceStabilityParseResult<T> {
  return { status: "valid", value, diagnostics: [] };
}

function hasSensitiveMaterial(value: string): boolean {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(value));
}

function exactFields(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  diagnostics: SourceStabilityRecoveryDiagnostic[],
  code: SourceStabilityRecoveryDiagnosticCode,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const field of required) if (!Object.hasOwn(value, field)) addDiagnostic(diagnostics, code, `${path} is missing a required field.`);
  for (const field of Object.keys(value)) if (!allowed.has(field)) addDiagnostic(diagnostics, code, `${path} contains an unsupported field.`);
}

function isSafeRelativePath(value: unknown, allowBackslashes = false): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 240 || hasSensitiveMaterial(value)) return false;
  const normalized = allowBackslashes ? value.replaceAll("\\", "/") : value;
  if (normalized !== normalized.normalize("NFC") || nodePath.posix.isAbsolute(normalized) || /^[A-Za-z]:/u.test(normalized)) return false;
  if (normalized.includes("//") || normalized.split("/").some((segment) => segment === "." || segment === ".." || segment.length === 0)) return false;
  return REPOSITORY_RELATIVE_PATH.test(normalized);
}

function safeText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength && !/[\r\n]/u.test(value) && !hasSensitiveMaterial(value);
}

function safeTitle(value: unknown): value is string {
  return safeText(value, 500) && value === value.normalize("NFC");
}

function safeOwner(value: unknown): value is string {
  return typeof value === "string" && /^[a-z][a-z0-9-]{1,79}$/u.test(value) && !hasSensitiveMaterial(value);
}

function parseProvider(value: unknown): SourceStabilityProviderId | undefined {
  return typeof value === "string" && PROVIDER_IDS.has(value) ? (value as SourceStabilityProviderId) : undefined;
}

function parseHarness(value: unknown): SourceStabilityHarnessId | undefined {
  return typeof value === "string" && HARNESS_IDS.has(value) ? (value as SourceStabilityHarnessId) : undefined;
}

function parseLocator(
  value: unknown,
  path: string,
  diagnostics: SourceStabilityRecoveryDiagnostic[],
): SourceStabilityEvidenceLocator | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "deterministic-evidence", `${path} must be an object.`);
    return undefined;
  }
  exactFields(value, LOCATOR_FIELDS, [], path, diagnostics, "deterministic-evidence");
  if (!isSafeRelativePath(value.path) || !safeTitle(value.title)) {
    addDiagnostic(diagnostics, "unsafe-path", `${path} has unsafe locator data.`);
    return undefined;
  }
  return { path: value.path, title: value.title };
}

function parseLiveLocator(
  value: unknown,
  path: string,
  diagnostics: SourceStabilityRecoveryDiagnostic[],
): SourceStabilityLiveEvidenceLocator | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "live-locators", `${path} must be an object.`);
    return undefined;
  }
  exactFields(value, LIVE_LOCATOR_FIELDS, [], path, diagnostics, "live-locators");
  if (!isSafeRelativePath(value.path) || !safeTitle(value.title)) {
    addDiagnostic(diagnostics, "live-locators", `${path} has unsafe locator data.`);
    return undefined;
  }
  return { path: value.path, title: value.title };
}

function liveLocatorKey(locator: SourceStabilityLiveEvidenceLocator): string {
  return `${locator.path}\u0000${locator.title}`;
}

function parseLiveProof(
  value: unknown,
  path: string,
  diagnostics: SourceStabilityRecoveryDiagnostic[],
): SourceStabilityLiveProof | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "live-fields", `${path} must be an object.`);
    return undefined;
  }
  const kind = value.kind;
  if (kind !== "implemented" && kind !== "planned") {
    addDiagnostic(diagnostics, "live-fields", `${path}.kind is unsupported.`);
    return undefined;
  }
  exactFields(value, kind === "implemented" ? LIVE_PROOF_FIELDS : LIVE_PLANNED_PROOF_FIELDS, [], path, diagnostics, "live-fields");
  if (!safeIdentifier(value.id) || !safeOwner(value.owner) || !safeText(value.expectedState, 600) || !safeText(value.cleanup, 600)) {
    addDiagnostic(diagnostics, "unsafe-metadata", `${path} has unsafe proof metadata.`);
    return undefined;
  }
  if (kind === "planned") {
    return { kind, id: value.id, owner: value.owner, expectedState: value.expectedState, cleanup: value.cleanup };
  }
  const locator = parseLiveLocator(value.locator, `${path}.locator`, diagnostics);
  const providerId = parseProvider(value.providerId);
  const harnessId = parseHarness(value.harnessId);
  if (locator === undefined || providerId === undefined || harnessId === undefined) {
    addDiagnostic(diagnostics, "live-locators", `${path} has inconsistent proof provenance.`);
    return undefined;
  }
  const authorityFlags = Array.isArray(value.authorityFlags) ? parseFlags(value.authorityFlags, `${path}.authorityFlags`, diagnostics) : [];
  const configurationFlags = Array.isArray(value.configurationFlags) ? parseFlags(value.configurationFlags, `${path}.configurationFlags`, diagnostics) : [];
  const policy = authorityPolicyFor(providerId, harnessId);
  const authoritySet = new Set(authorityFlags);
  if (policy === undefined || !authoritySet.has(KILN_LIVE_MANAGED_AGENT_TESTS) || !policyHasAuthority(policy, authoritySet)) {
    addDiagnostic(diagnostics, "live-authority-flags", `${path}.authorityFlags omit required authority.`);
  }
  if (authorityFlags.some((flag) => CONFIGURATION_FLAGS.has(flag))) {
    addDiagnostic(diagnostics, "authority-flag", `${path} assigns a configuration flag as authority.`);
  }
  if (configurationFlags.some((flag) => !CONFIGURATION_FLAGS.has(flag) || authoritySet.has(flag))) {
    addDiagnostic(diagnostics, "live-configuration-flags", `${path}.configurationFlags are unsafe or overlap authority.`);
  }
  if (policy !== undefined && authorityFlags.some((flag) => flag !== KILN_LIVE_MANAGED_AGENT_TESTS && !policy.allowed.includes(flag))) {
    addDiagnostic(diagnostics, "live-authority-flags", `${path}.authorityFlags are not allowed for the declared provider and harness pairing.`);
  }
  return {
    kind,
    id: value.id,
    owner: value.owner,
    expectedState: value.expectedState,
    cleanup: value.cleanup,
    locator,
    providerId,
    harnessId,
    authorityFlags,
    configurationFlags,
  };
}

function parseLiveEvidence(
  value: unknown,
  path: string,
  diagnostics: SourceStabilityRecoveryDiagnostic[],
): SourceStabilityLiveEvidence | undefined {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "live-fields", `${path} must be an object.`);
    return undefined;
  }
  exactFields(value, LIVE_FIELDS, [], path, diagnostics, "live-fields");
  const coverage = value.coverage;
  if (coverage !== "exact" && coverage !== "partial" && coverage !== "none") {
    addDiagnostic(diagnostics, "live-coverage", `${path}.coverage is unsupported.`);
    return undefined;
  }
  if (!Array.isArray(value.proofIds)) {
    addDiagnostic(diagnostics, "live-fields", `${path}.proofIds must be an array.`);
    return undefined;
  }
  const proofIds: string[] = [];
  for (const proofId of value.proofIds) {
    if (!safeIdentifier(proofId) || proofIds.includes(proofId)) addDiagnostic(diagnostics, "duplicate-locator", `${path}.proofIds contains an unsafe or duplicate id.`);
    else proofIds.push(proofId);
  }
  if (coverage === "none" && proofIds.length > 0) addDiagnostic(diagnostics, "live-locators", `${path}.proofIds must be empty for none coverage.`);
  if (coverage !== "none" && proofIds.length === 0) addDiagnostic(diagnostics, "live-locators", `${path}.proofIds must be non-empty for live coverage.`);
  // `locators` remains a type-only migration aid for an out-of-scope caller; it is
  // intentionally absent from the parsed value and therefore from report state.
  return { coverage, proofIds } as unknown as SourceStabilityLiveEvidence;
}

function parseFlags(value: readonly unknown[], path: string, diagnostics: SourceStabilityRecoveryDiagnostic[]): string[] {
  const flags: string[] = [];
  for (const flag of value) {
    if (typeof flag !== "string" || !SAFE_FLAG.test(flag) || hasSensitiveMaterial(flag)) {
      addDiagnostic(diagnostics, "authority-flag", `${path} contains an unsafe flag.`);
    } else if (flags.includes(flag)) {
      addDiagnostic(diagnostics, "duplicate-locator", `${path} contains a duplicate.`);
    } else {
      flags.push(flag);
    }
  }
  return flags;
}

/** Parse the versioned matrix without owning its locator mappings. */
export function parseSourceStabilityRecoveryManifest(
  value: unknown,
): SourceStabilityParseResult<SourceStabilityRecoveryManifest> {
  const diagnostics: SourceStabilityRecoveryDiagnostic[] = [];
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "input-shape", "source-stability recovery manifest must be an object.");
    return invalid(diagnostics);
  }
  exactFields(value, MANIFEST_FIELDS, [], "manifest", diagnostics, "manifest-fields");
  if (value.schema !== SOURCE_STABILITY_RECOVERY_MANIFEST_SCHEMA) addDiagnostic(diagnostics, "schema-mismatch", "manifest.schema is unsupported.");
  if (value.version !== 1) addDiagnostic(diagnostics, "version-mismatch", "manifest.version must be 1.");
  if (value.scenario !== SOURCE_STABILITY_RECOVERY_SCENARIO) addDiagnostic(diagnostics, "scenario-mismatch", "manifest.scenario is unsupported.");
  if (!Array.isArray(value.liveProofs)) {
    addDiagnostic(diagnostics, "live-fields", "manifest.liveProofs must be an array.");
  }
  const liveProofs: SourceStabilityLiveProof[] = [];
  const proofIds = new Set<string>();
  const proofLocators = new Set<string>();
  if (Array.isArray(value.liveProofs)) {
    value.liveProofs.forEach((rawProof, index) => {
      const proof = parseLiveProof(rawProof, `manifest.liveProofs[${index}]`, diagnostics);
      if (proof === undefined) return;
      if (proofIds.has(proof.id)) addDiagnostic(diagnostics, "case-duplicate", `manifest.liveProofs[${index}].id is duplicated.`);
      proofIds.add(proof.id);
      if (proof.kind === "implemented") {
        const locatorKey = liveLocatorKey(proof.locator);
        if (proofLocators.has(locatorKey)) addDiagnostic(diagnostics, "duplicate-locator", `manifest.liveProofs[${index}].locator is duplicated.`);
        proofLocators.add(locatorKey);
      }
      liveProofs.push(proof);
    });
  }
  if (!Array.isArray(value.cases)) {
    addDiagnostic(diagnostics, "cases-shape", "manifest.cases must be an array.");
    return invalid(diagnostics);
  }
  if (value.cases.length !== CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS.length) addDiagnostic(diagnostics, "cases-shape", "manifest.cases must contain the canonical case count.");
  const cases: SourceStabilityRecoveryManifestCase[] = [];
  const seenIds = new Set<string>();
  value.cases.forEach((rawCase, index) => {
    const casePath = `manifest.cases[${index}]`;
    if (!isRecord(rawCase)) {
      addDiagnostic(diagnostics, "case-fields", `${casePath} must be an object.`);
      return;
    }
    exactFields(rawCase, CASE_FIELDS, [], casePath, diagnostics, "case-fields");
    const id = rawCase.id;
    if (typeof id !== "string" || !CASE_ID_SET.has(id)) {
      addDiagnostic(diagnostics, "case-id", `${casePath}.id is not canonical.`);
      return;
    }
    if (seenIds.has(id)) addDiagnostic(diagnostics, "case-duplicate", `${casePath}.id is duplicated.`);
    seenIds.add(id);
    if (id !== CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS[index]) addDiagnostic(diagnostics, "case-id", `${casePath}.id is out of canonical order.`);
    if (!safeOwner(rawCase.owner)) addDiagnostic(diagnostics, "case-owner", `${casePath}.owner is unsafe.`);
    if (!safeText(rawCase.expectedState, 600)) addDiagnostic(diagnostics, "case-state", `${casePath}.expectedState is unsafe.`);
    if (!safeText(rawCase.cleanup, 600)) addDiagnostic(diagnostics, "case-cleanup", `${casePath}.cleanup is unsafe.`);
    if (!Array.isArray(rawCase.deterministicEvidence)) {
      addDiagnostic(diagnostics, "deterministic-evidence", `${casePath}.deterministicEvidence must be an array.`);
    }
    const deterministicEvidence: SourceStabilityEvidenceLocator[] = [];
    if (Array.isArray(rawCase.deterministicEvidence)) {
      rawCase.deterministicEvidence.forEach((entry, evidenceIndex) => {
        const locator = parseLocator(entry, `${casePath}.deterministicEvidence[${evidenceIndex}]`, diagnostics);
        if (locator) deterministicEvidence.push(locator);
      });
    }
    if (deterministicEvidence.length === 0) addDiagnostic(diagnostics, "deterministic-evidence", `${casePath}.deterministicEvidence must be non-empty.`);
    const evidenceKeys = new Set<string>();
    for (const locator of deterministicEvidence) {
      const key = `${locator.path}\u0000${locator.title}`;
      if (evidenceKeys.has(key)) addDiagnostic(diagnostics, "duplicate-locator", `${casePath}.deterministicEvidence contains a duplicate.`);
      evidenceKeys.add(key);
    }
    const liveEvidence = parseLiveEvidence(rawCase.liveEvidence, `${casePath}.liveEvidence`, diagnostics);
    if (liveEvidence === undefined || typeof rawCase.owner !== "string" || typeof rawCase.expectedState !== "string" || typeof rawCase.cleanup !== "string") return;
    for (const proofId of liveEvidence.proofIds) if (!proofIds.has(proofId)) addDiagnostic(diagnostics, "live-locators", `${casePath}.liveEvidence references an unknown live proof.`);
    cases.push({
      id: id as SourceStabilityRecoveryCaseId,
      owner: rawCase.owner,
      expectedState: rawCase.expectedState,
      cleanup: rawCase.cleanup,
      deterministicEvidence,
      liveEvidence,
    });
  });
  for (const id of CANONICAL_SOURCE_STABILITY_RECOVERY_CASE_IDS) if (!seenIds.has(id)) addDiagnostic(diagnostics, "case-missing", `manifest.cases is missing '${id}'.`);
  if (diagnostics.length > 0) return invalid(diagnostics);
  return valid({ schema: SOURCE_STABILITY_RECOVERY_MANIFEST_SCHEMA, version: 1, scenario: SOURCE_STABILITY_RECOVERY_SCENARIO, liveProofs, cases });
}

function parseVitestStatus(value: unknown): SourceStabilityVitestStatus | undefined {
  return value === "passed" || value === "failed" || value === "skipped" || value === "todo" || value === "pending" ? value : undefined;
}

function normalizeRepositoryRoot(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0 || hasSensitiveMaterial(value)) return undefined;
  const style = /^[A-Za-z]:[\\/]/u.test(value) ? nodePath.win32 : nodePath.posix;
  if (!style.isAbsolute(value)) return undefined;
  return style.normalize(value);
}

function normalizeVitestPath(value: unknown, repositoryRoot: string): { readonly path?: string; readonly code?: "unsafe-path" | "outside-root" } {
  if (typeof value !== "string") return { code: "unsafe-path" };
  const isWindows = nodePath.win32.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(repositoryRoot);
  const style = isWindows ? nodePath.win32 : nodePath.posix;
  const root = style.normalize(repositoryRoot);
  if (style.isAbsolute(value)) {
    const absolute = style.normalize(value);
    const relative = style.relative(root, absolute);
    if (relative.length === 0 || style.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${style.sep}`)) return { code: "outside-root" };
    const portable = relative.replaceAll("\\", "/");
    return isSafeRelativePath(portable) ? { path: portable } : { code: "unsafe-path" };
  }
  const portable = value.replaceAll("\\", "/");
  return isSafeRelativePath(portable) ? { path: portable } : { code: "unsafe-path" };
}

/** Parse only the relevant Vitest JSON fields, normalizing paths under root. */
export function parseVitestSourceStabilityResults(
  value: unknown,
  repositoryRoot: string,
): SourceStabilityParseResult<readonly ParsedVitestSourceStabilityAssertion[]> {
  const diagnostics: SourceStabilityRecoveryDiagnostic[] = [];
  const normalizedRoot = normalizeRepositoryRoot(repositoryRoot);
  if (normalizedRoot === undefined) {
    addDiagnostic(diagnostics, "repository-root", "repositoryRoot must be an absolute trusted path.");
    return invalid(diagnostics);
  }
  if (!isRecord(value) || !Array.isArray(value.testResults)) {
    addDiagnostic(diagnostics, "test-results-shape", "Vitest results.testResults must be an array.");
    return invalid(diagnostics);
  }
  const assertions: ParsedVitestSourceStabilityAssertion[] = [];
  value.testResults.forEach((rawResult, resultIndex) => {
    const resultPath = `Vitest results.testResults[${resultIndex}]`;
    if (!isRecord(rawResult) || !Array.isArray(rawResult.assertionResults)) {
      addDiagnostic(diagnostics, "test-result-fields", `${resultPath} is malformed.`);
      return;
    }
    const normalized = normalizeVitestPath(rawResult.name, normalizedRoot);
    if (normalized.code !== undefined) {
      addDiagnostic(diagnostics, normalized.code, `${resultPath}.name is unsafe or outside repositoryRoot.`);
      return;
    }
    rawResult.assertionResults.forEach((rawAssertion, assertionIndex) => {
      const assertionPath = `${resultPath}.assertionResults[${assertionIndex}]`;
      if (!isRecord(rawAssertion) || !safeTitle(rawAssertion.title) || !safeTitle(rawAssertion.fullName)) {
        addDiagnostic(diagnostics, "assertion-fields", `${assertionPath} is malformed.`);
        return;
      }
      const status = parseVitestStatus(rawAssertion.status);
      if (status === undefined) {
        addDiagnostic(diagnostics, "assertion-status", `${assertionPath}.status is unsupported.`);
        return;
      }
      assertions.push({ path: normalized.path!, title: rawAssertion.title, fullName: rawAssertion.fullName, status });
    });
  });
  return diagnostics.length > 0 ? invalid(diagnostics) : valid(assertions);
}

function safeIdentifier(value: unknown, allowSlash = false): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > 160 || hasSensitiveMaterial(value)) return false;
  const pattern = allowSlash ? /^[A-Za-z0-9][A-Za-z0-9._:/+@-]{0,159}$/u : /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
  return pattern.test(value) && !value.startsWith("/") && !/^[A-Za-z]:[\\/]/u.test(value) && !value.includes("\\") && !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value);
}

function validateExecutor(value: unknown): SourceStabilityExecutorProvenance {
  if (!isRecord(value)) throw new Error("executor provenance is unsafe or missing an exact harness version.");
  const providerId = parseProvider(value.providerId);
  const harnessId = parseHarness(value.harnessId);
  if (providerId === undefined || harnessId === undefined || typeof value.harnessVersion !== "string" || !SEMVER.test(value.harnessVersion)) {
    throw new Error("executor provenance is unsafe or missing an exact harness version.");
  }
  const policy = authorityPolicyFor(providerId, harnessId);
  if (policy === undefined) throw new Error("executor provider and harness pairing is unsupported.");
  if (value.model !== undefined && !safeIdentifier(value.model, true)) throw new Error("executor model metadata is unsafe.");
  if (!Array.isArray(value.enabledAuthorityFlags)) throw new Error("executor authority metadata is unsafe.");
  const flags: string[] = [];
  const allowedFlags = new Set([KILN_LIVE_MANAGED_AGENT_TESTS, ...policy.allowed]);
  for (const flag of value.enabledAuthorityFlags) {
    if (typeof flag !== "string" || !SAFE_FLAG.test(flag) || hasSensitiveMaterial(flag) || CONFIGURATION_FLAGS.has(flag) || !allowedFlags.has(flag) || flags.includes(flag)) throw new Error("executor authority metadata is unsafe.");
    flags.push(flag);
  }
  return {
    providerId,
    harnessId,
    harnessVersion: value.harnessVersion,
    ...(value.model !== undefined ? { model: value.model } : {}),
    enabledAuthorityFlags: flags,
  };
}

const LIVE_RUN_REASON_CODES: ReadonlySet<string> = new Set([
  "preflight-denied",
  "executor-provenance-unavailable",
  "spawn-failed",
  "test-process-terminated",
  "test-process-timeout",
  "test-process-interrupted",
  "test-output-limit",
  "invalid-live-observation",
  "missing-json",
  "malformed-json",
  "test-process-nonzero",
]);
const LIVE_RUN_FIELDS = new Set(["status", "reasonCode", "exitCode"]);
const MAX_LIVE_RUN_EXIT_CODE = 255;

function validateLiveRun(value: unknown): SourceStabilityLiveRun {
  if (!isRecord(value) || typeof value.status !== "string" || !["not-started", "completed", "failed"].includes(value.status)) {
    throw new Error("liveRun status is unsafe or unsupported.");
  }
  if (Object.keys(value).some((field) => !LIVE_RUN_FIELDS.has(field))) throw new Error("liveRun contains unsupported raw fields.");
  const status = value.status as SourceStabilityLiveRunStatus;
  const reasonCode = value.reasonCode;
  if (reasonCode !== undefined && (typeof reasonCode !== "string" || !LIVE_RUN_REASON_CODES.has(reasonCode))) {
    throw new Error("liveRun reasonCode is unsafe or unsupported.");
  }
  const exitCodeValue = value.exitCode;
  if (exitCodeValue !== undefined && (typeof exitCodeValue !== "number" || !Number.isInteger(exitCodeValue) || exitCodeValue < 0 || exitCodeValue > MAX_LIVE_RUN_EXIT_CODE)) {
    throw new Error("liveRun exitCode must be a bounded integer.");
  }
  const exitCode = exitCodeValue as number | undefined;
  if (status === "not-started" && (reasonCode !== "preflight-denied" && reasonCode !== "executor-provenance-unavailable" || exitCode !== undefined)) {
    throw new Error("not-started liveRun must be preflight-denied or executor-provenance-unavailable without an exit code.");
  }
  if (status === "completed" && (reasonCode !== undefined || exitCode !== 0)) {
    throw new Error("completed liveRun must have exitCode 0 and no failure reason.");
  }
  if (status === "failed" && (reasonCode === undefined || reasonCode === "preflight-denied")) {
    throw new Error("failed liveRun requires a non-preflight failure reason.");
  }
  if (status === "failed" && (reasonCode === "spawn-failed" || reasonCode === "test-process-terminated" || reasonCode === "test-process-timeout" || reasonCode === "test-process-interrupted" || reasonCode === "test-output-limit" || reasonCode === "invalid-live-observation") && exitCode !== undefined) {
    throw new Error(`${reasonCode} liveRun cannot have an exitCode.`);
  }
  if (status === "failed" && (reasonCode === "missing-json" || reasonCode === "malformed-json") && exitCode === undefined) {
    throw new Error(`${reasonCode} liveRun requires a known process exitCode.`);
  }
  if (status === "failed" && reasonCode === "test-process-nonzero" && (exitCode === undefined || exitCode === 0)) {
    throw new Error("test-process-nonzero liveRun requires a known nonzero exitCode.");
  }
  return {
    status,
    ...(reasonCode !== undefined ? { reasonCode: reasonCode as SourceStabilityLiveRunReasonCode } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
  };
}

function resolveLiveRun(input: SourceStabilityRecoveryReportInput): SourceStabilityLiveRun {
  if (input.liveRun === undefined) throw new Error("liveRun is required and must be explicit.");
  const liveRun = validateLiveRun(input.liveRun);
  const hasLiveJson = input.liveVitest !== undefined;
  if (input.preflight === "denied") {
    if (liveRun.status !== "not-started" || liveRun.reasonCode !== "preflight-denied" || hasLiveJson) {
      throw new Error("preflight-denied liveRun must be not-started and have no live JSON.");
    }
  } else {
    if (liveRun.status === "not-started" && (liveRun.reasonCode !== "executor-provenance-unavailable" || hasLiveJson)) {
      throw new Error("allowed preflight not-started liveRun must be executor-provenance-unavailable without live JSON.");
    }
    if (liveRun.status === "completed" && !hasLiveJson) throw new Error("completed liveRun requires live JSON.");
    if (liveRun.status === "failed" && liveRun.reasonCode !== "test-process-nonzero" && hasLiveJson) {
      throw new Error("spawn/missing/malformed liveRun failures cannot include live JSON.");
    }
  }
  return liveRun;
}

function executorIdentity(executor: SourceStabilityExecutorProvenance): string {
  return `${executor.providerId}\u0000${executor.harnessId}\u0000${executor.model ?? ""}`;
}

function validateSelectedAuthorityFlags(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error("selectedAuthorityFlags must be an explicit array.");
  const flags: string[] = [];
  for (const flag of value) {
    if (typeof flag !== "string" || !SAFE_FLAG.test(flag) || hasSensitiveMaterial(flag) || CONFIGURATION_FLAGS.has(flag) || !AUTHORITY_FLAGS.has(flag) || flags.includes(flag)) {
      throw new Error("selected authority metadata is unsafe or duplicated.");
    }
    flags.push(flag);
  }
  return flags;
}

function validateReportInput(input: SourceStabilityRecoveryReportInput): { readonly root: string; readonly executors: readonly SourceStabilityExecutorProvenance[]; readonly liveRun: SourceStabilityLiveRun; readonly selectedAuthorityFlags: readonly string[] } {
  if (!isRecord(input.candidate) || typeof input.candidate.dirty !== "boolean" || typeof input.candidate.commit !== "string" || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(input.candidate.commit)) throw new Error("candidate commit must be a lowercase 40- or 64-hex commit OID.");
  const root = normalizeRepositoryRoot(input.repositoryRoot);
  if (root === undefined) throw new Error("repositoryRoot must be an absolute trusted path.");
  if (!isRecord(input.environment) || !safeIdentifier(input.environment.platform) || !safeIdentifier(input.environment.arch) || !SEMVER.test(input.environment.bun) || !SEMVER.test(input.environment.node)) throw new Error("environment metadata is unsafe.");
  if (input.preflight !== "allowed" && input.preflight !== "denied") throw new Error("preflight metadata is unsafe.");
  const selectedAuthorityFlags = validateSelectedAuthorityFlags(input.selectedAuthorityFlags);
  if (!Array.isArray(input.executors)) throw new Error("executors must be an explicit array.");
  const executors = input.executors.map(validateExecutor);
  const identities = new Set<string>();
  for (const executor of executors) {
    const identity = executorIdentity(executor);
    if (identities.has(identity)) throw new Error("duplicate executor identity.");
    identities.add(identity);
  }
  const selectedSet = new Set(selectedAuthorityFlags);
  const executorSet = new Set(executors.flatMap((executor) => executor.enabledAuthorityFlags));
  if (input.preflight === "denied") {
    if (selectedAuthorityFlags.length !== 0 || executors.length !== 0) throw new Error("denied preflight cannot persist selected authority or executor provenance.");
  } else if (input.liveRun.status === "not-started" && input.liveRun.reasonCode === "executor-provenance-unavailable") {
    if (executors.length !== 0 || selectedAuthorityFlags.length === 0) throw new Error("executor-provenance-unavailable requires selected authority and no executors.");
  } else if (selectedAuthorityFlags.length === 0 || selectedSet.size !== executorSet.size || [...selectedSet].some((flag) => !executorSet.has(flag)) || [...executorSet].some((flag) => !selectedSet.has(flag))) {
    throw new Error("selected authority must exactly account for executor authority.");
  }
  return { root, executors, selectedAuthorityFlags, liveRun: resolveLiveRun(input) };
}

function throwInvalid(label: string, diagnostics: readonly SourceStabilityRecoveryDiagnostic[]): never {
  throw new Error(`${label} is invalid: ${diagnostics.map((diagnostic) => diagnostic.code).join(",")}`);
}

function assertionMatches(assertion: ParsedVitestSourceStabilityAssertion, locator: SourceStabilityEvidenceLocator): boolean {
  return assertion.path === locator.path && assertion.title === locator.title;
}

/**
 * Validate the live process boundary before deriving statuses.  An assertion
 * from a disabled authority is harmless only when Vitest reports it as
 * skipped/todo/pending; a passed or failed assertion would otherwise be
 * evidence smuggled across the authority boundary.
 */
function validateLiveAssertionCatalog(
  assertions: readonly ParsedVitestSourceStabilityAssertion[],
  proofs: readonly SourceStabilityLiveProof[],
  selectedAuthorityFlags: readonly string[],
): void {
  const implemented = proofs.filter((proof): proof is SourceStabilityImplementedLiveProof => proof.kind === "implemented");
  const selected = new Set(selectedAuthorityFlags);
  for (const assertion of assertions) {
    const matches = implemented.filter((proof) => assertionMatches(assertion, proof.locator));
    if (matches.length !== 1) {
      throw new Error("live assertion does not uniquely match one cataloged proof locator.");
    }
    const proof = matches[0]!;
    const authoritySelected = proof.authorityFlags.every((flag) => selected.has(flag));
    if (!authoritySelected && (assertion.status === "passed" || assertion.status === "failed")) {
      throw new Error("live assertion contradicts disabled proof authority.");
    }
  }
}

function statusObservation(status: SourceStabilityVitestStatus): SourceStabilityReportObservation {
  if (status === "passed") return { status: "executed", reasonCode: "test-passed", cleanup: "verified" };
  if (status === "failed") return { status: "failed", reasonCode: "test-failed", cleanup: "unverified" };
  return { status: "skipped", reasonCode: "test-skipped", cleanup: "not-run" };
}

function noObservation(reasonCode: SourceStabilityReportReasonCode): SourceStabilityReportObservation {
  return { status: "omitted", reasonCode, cleanup: "not-run" };
}

function matchingExecutor(
  providerId: SourceStabilityProviderId,
  harnessId: SourceStabilityHarnessId,
  locator: SourceStabilityLiveEvidenceLocator,
  manifestAuthorityFlags: readonly string[],
  executors: readonly SourceStabilityExecutorProvenance[],
): SourceStabilityExecutorProvenance {
  const matches = executors.filter((executor) =>
    executor.providerId === providerId && executor.harnessId === harnessId,
  );
  if (matches.length !== 1) throw new Error("live observation lacks unique executor provenance.");
  const executor = validateExecutor(matches[0]);
  const policy = authorityPolicyFor(providerId, harnessId);
  if (policy === undefined) throw new Error("live observation uses an unsupported provider and harness pairing.");
  const manifestFlags = new Set(manifestAuthorityFlags);
  const executorFlags = new Set(executor.enabledAuthorityFlags);
  const applicableManifestFlags = policy.allowed.filter((flag) => manifestFlags.has(flag));
  if (!manifestFlags.has(KILN_LIVE_MANAGED_AGENT_TESTS) || !policyHasAuthority(policy, manifestFlags) || !executorFlags.has(KILN_LIVE_MANAGED_AGENT_TESTS) || !policyHasAuthority(policy, executorFlags) || !applicableManifestFlags.every((flag) => executorFlags.has(flag))) {
    throw new Error("live observation lacks required authority.");
  }
  return executor;
}

function proofResultMetadata(proof: SourceStabilityLiveProof): Pick<SourceStabilityRecoveryReportLiveProof, "kind" | "id" | "owner" | "expectedState" | "cleanupContract" | "locator" | "providerId" | "harnessId" | "authorityFlags" | "configurationFlags"> {
  if (proof.kind === "planned") return { kind: proof.kind, id: proof.id, owner: proof.owner, expectedState: proof.expectedState, cleanupContract: proof.cleanup };
  return {
    kind: proof.kind,
    id: proof.id,
    owner: proof.owner,
    expectedState: proof.expectedState,
    cleanupContract: proof.cleanup,
    locator: proof.locator,
    providerId: proof.providerId,
    harnessId: proof.harnessId,
    authorityFlags: proof.authorityFlags,
    configurationFlags: proof.configurationFlags,
  };
}

function proofObservation(
  proof: SourceStabilityLiveProof,
  status: SourceStabilityLiveProofStatus,
  reasonCode: SourceStabilityLiveProofReasonCode,
  selectedLocator?: SourceStabilityResolvedLiveEvidenceLocator,
  executor?: SourceStabilityExecutorProvenance,
): SourceStabilityRecoveryReportLiveProof {
  return {
    ...proofResultMetadata(proof),
    status,
    reasonCode,
    cleanup: status === "executed" ? "verified" : status === "failed" ? "unverified" : "not-run",
    ...(selectedLocator !== undefined ? { selectedLocator } : {}),
    ...(executor !== undefined ? { executor } : {}),
  };
}

function deriveLiveProofResult(
  proof: SourceStabilityLiveProof,
  assertions: readonly ParsedVitestSourceStabilityAssertion[],
  executors: readonly SourceStabilityExecutorProvenance[],
  selectedAuthorityFlags: readonly string[],
  preflight: "allowed" | "denied",
  liveRun: SourceStabilityLiveRun,
  hasLiveJson: boolean,
): SourceStabilityRecoveryReportLiveProof {
  if (preflight === "denied") return proofObservation(proof, "omitted", "preflight-denied");
  if (proof.kind === "planned") return proofObservation(proof, "omitted", "proof-not-implemented");
  const selected = new Set(selectedAuthorityFlags);
  if (proof.authorityFlags.some((flag) => !selected.has(flag))) return proofObservation(proof, "omitted", "authority-not-enabled");
  if (liveRun.status === "not-started") return proofObservation(proof, "omitted", "executor-provenance-unavailable");
  if (liveRun.status === "failed" && (liveRun.reasonCode !== "test-process-nonzero" || !hasLiveJson)) return proofObservation(proof, "omitted", "live-run-failed");
  const matches = assertions.filter((assertion) => assertionMatches(assertion, proof.locator));
  if (matches.length === 0) return proofObservation(proof, "omitted", "no-live-observation");
  if (matches.length > 1) return proofObservation(proof, "omitted", "ambiguous-observation");
  const observation = statusObservation(matches[0]!.status);
  const executor = matchingExecutor(proof.providerId, proof.harnessId, proof.locator, proof.authorityFlags, executors);
  const selectedLocator: SourceStabilityResolvedLiveEvidenceLocator = { ...proof.locator, providerId: proof.providerId, harnessId: proof.harnessId, ...(executor.model !== undefined ? { model: executor.model } : {}) };
  return proofObservation(proof, observation.status, observation.reasonCode, selectedLocator, executor);
}

/** Lower-level derivation seam for live proof status semantics. */
export function deriveSourceStabilityLiveProofResults(
  proofs: readonly SourceStabilityLiveProof[],
  assertions: readonly ParsedVitestSourceStabilityAssertion[],
  executors: readonly SourceStabilityExecutorProvenance[],
  selectedAuthorityFlags: readonly string[],
  preflight: "allowed" | "denied",
  liveRun: SourceStabilityLiveRun = { status: "completed", exitCode: 0 },
  hasLiveJson = true,
): readonly SourceStabilityRecoveryReportLiveProof[] {
  return proofs.map((proof) => deriveLiveProofResult(proof, assertions, executors, selectedAuthorityFlags, preflight, liveRun, hasLiveJson));
}

function aggregateProofObservations(
  proofIds: readonly string[],
  proofResults: readonly SourceStabilityRecoveryReportLiveProof[],
): SourceStabilityReportObservation {
  const results = proofIds.map((proofId) => proofResults.find((proof) => proof.id === proofId)).filter((proof): proof is SourceStabilityRecoveryReportLiveProof => proof !== undefined);
  if (results.some((proof) => proof.status === "failed")) return { status: "failed", reasonCode: "test-failed", cleanup: "unverified" };
  if (results.some((proof) => proof.reasonCode === "preflight-denied")) return noObservation("preflight-denied");
  if (results.length !== proofIds.length || results.some((proof) => proof.status === "omitted")) return noObservation("no-partial-observation");
  if (results.some((proof) => proof.status === "skipped")) return { status: "skipped", reasonCode: "test-skipped", cleanup: "not-run" };
  return { status: "executed", reasonCode: "test-passed", cleanup: "verified" };
}

/** Derive a canonical recovery case from its manifest-owned live proof references. */
export function deriveSourceStabilityLiveObservation(
  entry: SourceStabilityRecoveryManifestCase,
  proofResults: readonly SourceStabilityRecoveryReportLiveProof[],
): SourceStabilityRecoveryReportCase["live"] {
  const base = {
    coverage: entry.liveEvidence.coverage,
    proofIds: entry.liveEvidence.proofIds,
  } as const;
  if (entry.liveEvidence.coverage === "none") {
    return { ...base, ...noObservation(proofResults.some((proof) => proof.reasonCode === "preflight-denied") ? "preflight-denied" : "no-exact-live-case") };
  }
  const aggregate = aggregateProofObservations(entry.liveEvidence.proofIds, proofResults);
  if (entry.liveEvidence.coverage === "partial") {
    const selected = proofResults.find((proof) => entry.liveEvidence.proofIds.includes(proof.id) && proof.selectedLocator !== undefined);
    return {
      ...base,
      ...noObservation(aggregate.status === "omitted" ? aggregate.reasonCode : "partial-observation"),
      ...(aggregate.status !== "omitted" ? { partialObservation: aggregate } : {}),
      ...(selected?.selectedLocator !== undefined ? { selectedLocator: selected.selectedLocator } : {}),
      ...(selected?.executor !== undefined ? { executor: selected.executor } : {}),
    };
  }
  const selected = proofResults.find((proof) => entry.liveEvidence.proofIds.includes(proof.id) && proof.selectedLocator !== undefined);
  return {
    ...base,
    ...aggregate,
    ...(selected?.selectedLocator !== undefined ? { selectedLocator: selected.selectedLocator } : {}),
    ...(selected?.executor !== undefined ? { executor: selected.executor } : {}),
  };
}

function applyLiveRunFailure(
  observation: SourceStabilityRecoveryReportCase["live"],
  liveRun: SourceStabilityLiveRun,
): SourceStabilityRecoveryReportCase["live"] {
  if (liveRun.status !== "failed") return observation;
  if (observation.reasonCode !== "no-exact-live-case" && observation.reasonCode !== "no-partial-observation") return observation;
  return { ...observation, reasonCode: "live-run-failed" };
}

function deriveDeterministicObservation(
  locators: readonly SourceStabilityEvidenceLocator[],
  assertions: readonly ParsedVitestSourceStabilityAssertion[],
): SourceStabilityReportObservation {
  const matches = locators.map((locator) => assertions.filter((assertion) => assertionMatches(assertion, locator)));
  const uniquelyKnownStatuses = matches.filter((group) => group.length === 1).map((group) => group[0]!.status);
  if (uniquelyKnownStatuses.includes("failed")) return statusObservation("failed");
  if (matches.some((group) => group.length === 0) || matches.some((group) => group.length > 1)) return noObservation("no-deterministic-observation");
  const statuses = matches.map((group) => group[0]!.status);
  if (statuses.some((status) => status === "failed")) return statusObservation("failed");
  if (statuses.every((status) => status === "passed")) return statusObservation("passed");
  return statusObservation("skipped");
}

function canonicalValue(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function manifestDigest(manifest: SourceStabilityRecoveryManifest): string {
  return `sha256:${createHash("sha256").update(canonicalValue(manifest)).digest("hex")}`;
}

// Updated when the canonical JSON fixture changes; it contains no locator ownership.
const SOURCE_STABILITY_RECOVERY_MANIFEST_DIGEST = "sha256:d7b0adf75f5b5e804b961a42fd0cae0e438563a58829f0c32ca5e6e3a713996b";

function aggregateCleanup(deterministic: SourceStabilityReportObservation, live: SourceStabilityRecoveryReportCase["live"]): SourceStabilityCleanupStatus {
  const liveObservation = live.partialObservation ?? live;
  if (deterministic.cleanup === "unverified" || liveObservation.cleanup === "unverified") return "unverified";
  if (deterministic.cleanup === "not-run" || liveObservation.cleanup === "not-run") return "not-run";
  return "verified";
}

function deriveTerminalOutcome(cases: readonly SourceStabilityRecoveryReportCase[]): "passed" | "failed" | "inconclusive" {
  const observations = cases.flatMap((entry) => [entry.deterministic.status, entry.live.status, entry.live.partialObservation?.status].filter((status): status is SourceStabilityCaseStatus => status !== undefined));
  if (observations.some((status) => status === "failed")) return "failed";
  return observations.length > 0 && observations.every((status) => status === "executed") ? "passed" : "inconclusive";
}

function deriveRunCleanup(liveRun: SourceStabilityLiveRun): SourceStabilityCleanupStatus {
  if (liveRun.status === "not-started") return "not-run";
  if (liveRun.status === "failed" && (liveRun.reasonCode === "test-process-timeout" || liveRun.reasonCode === "test-process-interrupted" || liveRun.reasonCode === "test-process-terminated" || liveRun.reasonCode === "test-output-limit" || liveRun.reasonCode === "missing-json" || liveRun.reasonCode === "malformed-json" || liveRun.reasonCode === "invalid-live-observation")) return "unverified";
  if (liveRun.status === "failed" && liveRun.reasonCode === "spawn-failed") return "not-run";
  return "not-run";
}

function deriveCleanupOutcome(cases: readonly SourceStabilityRecoveryReportCase[], liveRun: SourceStabilityLiveRun): SourceStabilityCleanupStatus {
  const runCleanup = deriveRunCleanup(liveRun);
  if (runCleanup === "unverified" || cases.some((entry) => entry.cleanup === "unverified")) return "unverified";
  if (runCleanup === "not-run" || cases.some((entry) => entry.cleanup === "not-run")) return "not-run";
  return "verified";
}

function deriveLiveProofOutcome(
  proofs: readonly SourceStabilityRecoveryReportLiveProof[],
  selectedAuthorityFlags: readonly string[],
  liveRun: SourceStabilityLiveRun,
): SourceStabilityLiveProofOutcome {
  if (liveRun.status === "not-started" || liveRun.reasonCode === "preflight-denied" || liveRun.reasonCode === "executor-provenance-unavailable") return "inconclusive";
  if (liveRun.status === "failed") return "failed";
  const selected = new Set(selectedAuthorityFlags);
  const authorized = proofs.filter((proof) => proof.kind === "implemented" && proof.authorityFlags?.every((flag) => selected.has(flag)));
  if (authorized.length === 0) return "inconclusive";
  if (authorized.some((proof) => proof.status === "failed")) return "failed";
  if (authorized.every((proof) => proof.status === "executed")) return "passed";
  return "inconclusive";
}

function deriveResidualRisks(
  candidate: SourceStabilityRecoveryCandidateMetadata,
  liveRun: SourceStabilityLiveRun,
  cases: readonly SourceStabilityRecoveryReportCase[],
  proofs: readonly SourceStabilityRecoveryReportLiveProof[],
): readonly SourceStabilityResidualRisk[] {
  const risks = new Set<SourceStabilityResidualRisk>();
  if (candidate.dirty) risks.add("candidate-dirty");
  if (liveRun.reasonCode === "executor-provenance-unavailable") risks.add("executor-provenance-unavailable");
  if (liveRun.status === "failed" && liveRun.reasonCode !== undefined) risks.add(`live-run-failed:${liveRun.reasonCode}`);
  if (cases.some((entry) => entry.deterministic.status !== "executed")) risks.add("deterministic-evidence-not-run");
  if (cases.some((entry) => entry.live.coverage !== "exact" || entry.live.status !== "executed")) risks.add("live-evidence-not-exact");
  for (const entry of cases) {
    for (const observation of [entry.deterministic.status, entry.live.status, entry.live.partialObservation?.status]) {
      if (observation === undefined) continue;
      if (observation === "failed") risks.add(`case-failed:${entry.id}`);
      if (observation === "skipped") risks.add(`case-skipped:${entry.id}`);
      if (observation === "omitted") risks.add(`case-omitted:${entry.id}`);
    }
  }
  for (const proof of proofs) {
    if (proof.kind === "planned") risks.add(`proof-not-implemented:${proof.id}`);
    else if (proof.status === "failed") risks.add(`proof-failed:${proof.id}`);
    else if (proof.status === "skipped") risks.add(`proof-skipped:${proof.id}`);
    else if (proof.status === "omitted") risks.add(`proof-omitted:${proof.id}`);
  }
  return [...risks].sort();
}

/** Build only from the canonical parsed manifest and explicit sanitized inputs. */
export function buildSourceStabilityRecoveryReport(input: SourceStabilityRecoveryReportInput): SourceStabilityRecoveryReport {
  const metadata = validateReportInput(input);
  const parsedManifest = parseSourceStabilityRecoveryManifest(input.manifest);
  if (parsedManifest.status === "invalid") throwInvalid("source-stability recovery manifest", parsedManifest.diagnostics);
  if (manifestDigest(parsedManifest.value) !== SOURCE_STABILITY_RECOVERY_MANIFEST_DIGEST) throw new Error("source-stability recovery manifest is not the canonical v1 mapping.");
  if (parsedManifest.value.cases.some((entry) => entry.liveEvidence.coverage === "exact")) throw new Error("v1 exact live coverage is not admitted.");
  const deterministic = input.deterministicVitest === undefined
    ? []
    : (() => {
        const parsed = parseVitestSourceStabilityResults(input.deterministicVitest, metadata.root);
        return parsed.status === "valid" ? parsed.value : throwInvalid("deterministic Vitest results", parsed.diagnostics);
      })();
  const live = metadata.liveRun.status === "not-started" || input.liveVitest === undefined
    ? []
    : (() => {
        const parsed = parseVitestSourceStabilityResults(input.liveVitest, metadata.root);
        return parsed.status === "valid" ? parsed.value : throwInvalid("live Vitest results", parsed.diagnostics);
      })();
  validateLiveAssertionCatalog(live, parsedManifest.value.liveProofs, metadata.selectedAuthorityFlags);
  const liveProofs = deriveSourceStabilityLiveProofResults(
    parsedManifest.value.liveProofs,
    live,
    metadata.executors,
    metadata.selectedAuthorityFlags,
    input.preflight,
    metadata.liveRun,
    input.liveVitest !== undefined,
  );
  const cases = parsedManifest.value.cases.map((entry) => {
    const deterministicObservation = deriveDeterministicObservation(entry.deterministicEvidence, deterministic);
    const liveObservation = applyLiveRunFailure(deriveSourceStabilityLiveObservation(entry, liveProofs), metadata.liveRun);
    return {
      id: entry.id,
      deterministic: { ...deterministicObservation, evidence: entry.deterministicEvidence },
      live: liveObservation,
      cleanup: aggregateCleanup(deterministicObservation, liveObservation),
    };
  });
  const enabledAuthorityFlags = [...metadata.selectedAuthorityFlags].sort();
  const liveProofOutcome = deriveLiveProofOutcome(liveProofs, metadata.selectedAuthorityFlags, metadata.liveRun);
  return {
    schema: SOURCE_STABILITY_RECOVERY_REPORT_SCHEMA,
    version: 1,
    scenario: SOURCE_STABILITY_RECOVERY_SCENARIO,
    releaseReadiness: "not-evidence",
    notice: "This report is not release-readiness evidence.",
    candidate: { commit: input.candidate.commit, dirty: input.candidate.dirty },
    environment: {
      platform: input.environment.platform,
      arch: input.environment.arch,
      bun: input.environment.bun,
      node: input.environment.node,
    },
    executors: metadata.executors,
    enabledAuthorityFlags,
    preflight: input.preflight,
    liveRun: metadata.liveRun,
    liveProofOutcome,
    liveProofs,
    terminalOutcome: metadata.liveRun.status === "failed" ? "failed" : deriveTerminalOutcome(cases),
    cleanupOutcome: deriveCleanupOutcome(cases, metadata.liveRun),
    residualRisks: deriveResidualRisks(input.candidate, metadata.liveRun, cases, liveProofs),
    cases,
  };
}
