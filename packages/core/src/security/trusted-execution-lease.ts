import {
  type ActionEffectEnvelope,
  isValidNarrowing,
  normalizeActionEffectEnvelope,
  type ResolvedInvocationEffect,
} from "../engine/domain/action-effect.js";
import {
  compareTrustedExecutionProfileAuthority,
  TRUSTED_EXECUTION_PROFILES,
  type TrustedExecutionProfile,
} from "./trusted-execution-integrity.js";

/** Hard product ceiling for one attended invocation-tree lease. */
export const TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS = 60 * 60 * 1000;

const TRUSTED_EXECUTION_HARNESSES = ["codex", "claude-code", "opencode"] as const;

/** Canonical native harness vocabulary for trusted-execution evidence. */
export type TrustedExecutionHarness = (typeof TRUSTED_EXECUTION_HARNESSES)[number];

export interface TrustedExecutionLeaseStatusActive {
  readonly kind: "active";
}

export interface TrustedExecutionLeaseStatusCompleted {
  readonly kind: "completed";
  readonly at: string;
}

export interface TrustedExecutionLeaseStatusSessionClosed {
  readonly kind: "session-closed";
  readonly at: string;
}

export interface TrustedExecutionLeaseStatusRevoked {
  readonly kind: "revoked";
  readonly at: string;
}

export type TrustedExecutionLeaseStatus =
  | TrustedExecutionLeaseStatusActive
  | TrustedExecutionLeaseStatusCompleted
  | TrustedExecutionLeaseStatusSessionClosed
  | TrustedExecutionLeaseStatusRevoked;

/**
 * Passive evidence describing one attended, session-scoped approval.
 *
 * Possession of this value never grants authority. Configured admission, the
 * action-effect authorizer, route capability, and caller bounds remain
 * conjunctive. A later application authority must own attended issuance and
 * keep active lease state process-local.
 */
export interface TrustedExecutionLease {
  readonly kind: "trusted-execution-lease";
  readonly scope: "session";
  readonly localPrincipalId: string;
  readonly operatorSessionId: string;
  readonly invocationTreeId: string;
  readonly projectRuntimeId: string;
  readonly compositionRevision: string;
  readonly harness: TrustedExecutionHarness;
  readonly routeId: string;
  readonly profileCeiling: TrustedExecutionProfile;
  readonly allowedToolNames: readonly string[];
  readonly effectCeiling: ActionEffectEnvelope;
  readonly policyDigest: string;
  readonly enforcementRevision: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly status: TrustedExecutionLeaseStatus;
  /** Display attribution only; never consulted as identity or authority. */
  readonly authorizedBy?: string;
}

export interface TrustedExecutionLeaseUseContext {
  readonly now: string;
  readonly localPrincipalId: string;
  readonly operatorSessionId: string;
  readonly invocationTreeId: string;
  readonly projectRuntimeId: string;
  readonly compositionRevision: string;
  readonly harness: TrustedExecutionHarness;
  readonly routeId: string;
  readonly policyDigest: string;
  readonly enforcementRevision: string;
  readonly requestedProfile: TrustedExecutionProfile;
  readonly toolName: string;
  readonly effect: ResolvedInvocationEffect;
  readonly invocationCompleted?: boolean;
  readonly sessionClosed?: boolean;
}

export type TrustedExecutionLeaseMismatchReason =
  | "absent"
  | "malformed-evidence"
  | "malformed-context"
  | "not-yet-valid"
  | "expired"
  | "completed"
  | "session-closed"
  | "revoked"
  | "identity-mismatch"
  | "policy-revision-mismatch"
  | "enforcement-revision-mismatch"
  | "profile-ceiling-exceeded"
  | "tool-not-approved"
  | "effect-ceiling-exceeded";

/**
 * A positive match means only that this passive evidence covers the described
 * use. It is not an authorization decision.
 */
export type TrustedExecutionLeaseUseEvaluation =
  | { readonly matches: true; readonly status: "active" }
  | {
      readonly matches: false;
      readonly status: TrustedExecutionLeaseStatus["kind"] | "absent" | "malformed";
      readonly reason: TrustedExecutionLeaseMismatchReason;
    };

const TRUSTED_EXECUTION_HARNESS_SET = new Set<TrustedExecutionHarness>(TRUSTED_EXECUTION_HARNESSES);

const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_RUNTIME_ID = /^krp_[a-f0-9]{64}$/u;

/**
 * Normalize untrusted passive evidence. This validates shape and bounds only;
 * it does not prove that an operator approved or an authority issued the value.
 */
export function validateTrustedExecutionLeaseEvidence(input: unknown): TrustedExecutionLease {
  const record = requireRecord(input, "trusted execution lease evidence");
  assertExactKeys(
    record,
    [
      "kind",
      "scope",
      "localPrincipalId",
      "operatorSessionId",
      "invocationTreeId",
      "projectRuntimeId",
      "compositionRevision",
      "harness",
      "routeId",
      "profileCeiling",
      "allowedToolNames",
      "effectCeiling",
      "policyDigest",
      "enforcementRevision",
      "issuedAt",
      "expiresAt",
      "status",
      "authorizedBy",
    ],
    "trusted execution lease evidence",
  );

  if (record.kind !== "trusted-execution-lease") {
    throw new TypeError("Trusted execution lease evidence kind is unsupported.");
  }
  if (record.scope !== "session") {
    throw new TypeError("Trusted execution lease evidence must be session-scoped.");
  }

  const harness = normalizeHarness(record.harness);
  const profileCeiling = normalizeProfile(record.profileCeiling, "profileCeiling");
  const issuedAt = normalizeTimestamp(record.issuedAt, "issuedAt");
  const expiresAt = normalizeTimestamp(record.expiresAt, "expiresAt");
  const issuedAtMs = Date.parse(issuedAt);
  const expiresAtMs = Date.parse(expiresAt);
  if (expiresAtMs <= issuedAtMs) {
    throw new TypeError("Trusted execution lease expiresAt must be after issuedAt.");
  }
  if (expiresAtMs - issuedAtMs > TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS) {
    throw new TypeError("Trusted execution lease lifetime exceeds one hour.");
  }

  const effectCeiling = normalizeActionEffectEnvelope(record.effectCeiling);
  if (!effectCeiling) {
    throw new TypeError("Trusted execution lease effectCeiling is malformed.");
  }
  const status = normalizeStatus(record.status, issuedAtMs);
  const authorizedBy =
    record.authorizedBy === undefined ? undefined : requireTrimmedString(record.authorizedBy, "authorizedBy", 256);

  return Object.freeze({
    kind: "trusted-execution-lease",
    scope: "session",
    localPrincipalId: requirePortableIdentifier(record.localPrincipalId, "localPrincipalId"),
    operatorSessionId: requirePortableIdentifier(record.operatorSessionId, "operatorSessionId"),
    invocationTreeId: requirePortableIdentifier(record.invocationTreeId, "invocationTreeId"),
    projectRuntimeId: requirePattern(record.projectRuntimeId, "projectRuntimeId", PROJECT_RUNTIME_ID),
    compositionRevision: requirePattern(record.compositionRevision, "compositionRevision", SHA256_ID),
    harness,
    routeId: requirePortableIdentifier(record.routeId, "routeId"),
    profileCeiling,
    allowedToolNames: normalizeToolNames(record.allowedToolNames),
    effectCeiling,
    policyDigest: requirePattern(record.policyDigest, "policyDigest", SHA256_ID),
    enforcementRevision: requirePortableIdentifier(record.enforcementRevision, "enforcementRevision"),
    issuedAt,
    expiresAt,
    status,
    ...(authorizedBy === undefined ? {} : { authorizedBy }),
  });
}

/**
 * Check whether passive lease evidence covers one exact proposed use.
 * Existing policy and effect authorization must still independently admit it.
 */
export function evaluateTrustedExecutionLeaseUse(
  leaseInput: TrustedExecutionLease | undefined,
  context: TrustedExecutionLeaseUseContext,
): TrustedExecutionLeaseUseEvaluation {
  if (leaseInput === undefined) {
    return { matches: false, status: "absent", reason: "absent" };
  }

  let lease: TrustedExecutionLease;
  try {
    lease = validateTrustedExecutionLeaseEvidence(leaseInput);
  } catch {
    return { matches: false, status: "malformed", reason: "malformed-evidence" };
  }

  const normalizedContext = normalizeUseContext(context);
  if (!normalizedContext) {
    return { matches: false, status: lease.status.kind, reason: "malformed-context" };
  }

  switch (lease.status.kind) {
    case "completed":
      return { matches: false, status: lease.status.kind, reason: "completed" };
    case "session-closed":
      return { matches: false, status: lease.status.kind, reason: "session-closed" };
    case "revoked":
      return { matches: false, status: lease.status.kind, reason: "revoked" };
    case "active":
      break;
  }
  if (normalizedContext.invocationCompleted) {
    return { matches: false, status: "active", reason: "completed" };
  }
  if (normalizedContext.sessionClosed) {
    return { matches: false, status: "active", reason: "session-closed" };
  }

  const nowMs = Date.parse(normalizedContext.now);
  if (nowMs < Date.parse(lease.issuedAt)) {
    return { matches: false, status: "active", reason: "not-yet-valid" };
  }
  if (nowMs >= Date.parse(lease.expiresAt)) {
    return { matches: false, status: "active", reason: "expired" };
  }
  if (!sameIdentity(lease, normalizedContext)) {
    return { matches: false, status: "active", reason: "identity-mismatch" };
  }
  if (normalizedContext.policyDigest !== lease.policyDigest) {
    return { matches: false, status: "active", reason: "policy-revision-mismatch" };
  }
  if (normalizedContext.enforcementRevision !== lease.enforcementRevision) {
    return { matches: false, status: "active", reason: "enforcement-revision-mismatch" };
  }
  if (compareTrustedExecutionProfileAuthority(normalizedContext.requestedProfile, lease.profileCeiling) > 0) {
    return { matches: false, status: "active", reason: "profile-ceiling-exceeded" };
  }
  if (!lease.allowedToolNames.includes(normalizedContext.toolName)) {
    return { matches: false, status: "active", reason: "tool-not-approved" };
  }
  if (!isValidNarrowing(normalizedContext.effect, lease.effectCeiling)) {
    return { matches: false, status: "active", reason: "effect-ceiling-exceeded" };
  }
  return { matches: true, status: "active" };
}

function normalizeStatus(input: unknown, issuedAtMs: number): TrustedExecutionLeaseStatus {
  const record = requireRecord(input, "status");
  const kind = record.kind;
  if (kind === "active") {
    assertExactKeys(record, ["kind"], "status");
    return Object.freeze({ kind });
  }
  if (kind !== "completed" && kind !== "session-closed" && kind !== "revoked") {
    throw new TypeError("Trusted execution lease status is unsupported.");
  }
  assertExactKeys(record, ["kind", "at"], "status");
  const at = normalizeTimestamp(record.at, "status.at");
  if (Date.parse(at) < issuedAtMs) {
    throw new TypeError("Trusted execution lease terminal status cannot predate issuance.");
  }
  return Object.freeze({ kind, at });
}

function normalizeUseContext(input: TrustedExecutionLeaseUseContext): TrustedExecutionLeaseUseContext | undefined {
  try {
    const effect = normalizeActionEffectEnvelope(input.effect);
    if (!effect) return undefined;
    const invocationCompleted = normalizeOptionalBoolean(input.invocationCompleted, "invocationCompleted");
    const sessionClosed = normalizeOptionalBoolean(input.sessionClosed, "sessionClosed");
    return {
      now: normalizeTimestamp(input.now, "now"),
      localPrincipalId: requirePortableIdentifier(input.localPrincipalId, "localPrincipalId"),
      operatorSessionId: requirePortableIdentifier(input.operatorSessionId, "operatorSessionId"),
      invocationTreeId: requirePortableIdentifier(input.invocationTreeId, "invocationTreeId"),
      projectRuntimeId: requirePattern(input.projectRuntimeId, "projectRuntimeId", PROJECT_RUNTIME_ID),
      compositionRevision: requirePattern(input.compositionRevision, "compositionRevision", SHA256_ID),
      harness: normalizeHarness(input.harness),
      routeId: requirePortableIdentifier(input.routeId, "routeId"),
      policyDigest: requirePattern(input.policyDigest, "policyDigest", SHA256_ID),
      enforcementRevision: requirePortableIdentifier(input.enforcementRevision, "enforcementRevision"),
      requestedProfile: normalizeProfile(input.requestedProfile, "requestedProfile"),
      toolName: requireTrimmedString(input.toolName, "toolName", 256),
      effect,
      ...(invocationCompleted === undefined ? {} : { invocationCompleted }),
      ...(sessionClosed === undefined ? {} : { sessionClosed }),
    };
  } catch {
    return undefined;
  }
}

function normalizeOptionalBoolean(input: unknown, label: string): boolean | undefined {
  if (input === undefined || typeof input === "boolean") return input;
  throw new TypeError(`${label} must be a boolean when present.`);
}

function sameIdentity(lease: TrustedExecutionLease, context: TrustedExecutionLeaseUseContext): boolean {
  return (
    lease.localPrincipalId === context.localPrincipalId &&
    lease.operatorSessionId === context.operatorSessionId &&
    lease.invocationTreeId === context.invocationTreeId &&
    lease.projectRuntimeId === context.projectRuntimeId &&
    lease.compositionRevision === context.compositionRevision &&
    lease.harness === context.harness &&
    lease.routeId === context.routeId
  );
}

function normalizeHarness(input: unknown): TrustedExecutionHarness {
  if (typeof input !== "string" || !TRUSTED_EXECUTION_HARNESS_SET.has(input as TrustedExecutionHarness)) {
    throw new TypeError("Trusted execution lease harness is unsupported.");
  }
  return input as TrustedExecutionHarness;
}

function normalizeProfile(input: unknown, label: string): TrustedExecutionProfile {
  if (typeof input !== "string" || !TRUSTED_EXECUTION_PROFILES.includes(input as TrustedExecutionProfile)) {
    throw new TypeError(`${label} is not a supported trusted execution profile.`);
  }
  return input as TrustedExecutionProfile;
}

function normalizeToolNames(input: unknown): readonly string[] {
  if (!Array.isArray(input)) {
    throw new TypeError("allowedToolNames must be an explicit array.");
  }
  const names = input.map((value, index) => requireTrimmedString(value, `allowedToolNames[${index}]`, 256));
  if (new Set(names).size !== names.length) {
    throw new TypeError("allowedToolNames must not contain duplicates.");
  }
  return Object.freeze([...names].sort(compareCodeUnits));
}

function normalizeTimestamp(input: unknown, label: string): string {
  if (typeof input !== "string") {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  return input;
}

function requirePortableIdentifier(input: unknown, label: string): string {
  const value = requireTrimmedString(input, label, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)) {
    throw new TypeError(`${label} must be a portable identifier.`);
  }
  return value;
}

function requirePattern(input: unknown, label: string, pattern: RegExp): string {
  if (typeof input !== "string" || !pattern.test(input)) {
    throw new TypeError(`${label} is malformed.`);
  }
  return input;
}

function requireTrimmedString(input: unknown, label: string, maxLength: number): string {
  if (typeof input !== "string" || input.length === 0 || input.length > maxLength || input !== input.trim()) {
    throw new TypeError(`${label} must be a non-empty trimmed string.`);
  }
  return input;
}

function requireRecord(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  return input as Record<string, unknown>;
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const extra = Object.keys(record).find((key) => !allowedSet.has(key));
  if (extra !== undefined) {
    throw new TypeError(`${label} contains unsupported field ${extra}.`);
  }
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
