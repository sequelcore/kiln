import {
  type ActionEffectEnvelope,
  evaluateTrustedExecutionLeaseUse,
  type ResolvedInvocationEffect,
  TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS,
  type TrustedExecutionHarness,
  type TrustedExecutionLease,
  type TrustedExecutionLeaseUseContext,
  type TrustedExecutionLeaseUseEvaluation,
  type TrustedExecutionProfile,
  validateTrustedExecutionLeaseEvidence,
} from "@kilnai/core";

export { TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS } from "@kilnai/core";

/**
 * The binding owned by one process-local attended authority.
 *
 * `localPrincipalId` is deliberately supplied by top-level composition. It is
 * an opaque process-local capability identity; this authority never derives it
 * from an operator/user/session id and never treats display attribution as it.
 */
export interface AttendedTrustedExecutionLeaseAuthorityBinding {
  readonly localPrincipalId: string;
  readonly operatorSessionId: string;
  readonly invocationTreeId: string;
  readonly projectRuntimeId: `krp_${string}`;
  readonly compositionRevision: `sha256:${string}`;
}

/** Exact authority candidate shown to the approval boundary. */
export type AttendedTrustedExecutionLeaseApprovalBinding = Omit<TrustedExecutionLease, "status" | "authorizedBy">;

/** The approval boundary may return only an operator decision and display attribution. */
export type AttendedTrustedExecutionLeaseApprovalDecision =
  | { readonly status: "approved"; readonly authorizedBy?: string }
  | { readonly status: "denied" };

/** Explicit, typed operator approval boundary; it owns no lease state. */
export interface AttendedTrustedExecutionLeaseApprovalPort {
  approve(
    binding: AttendedTrustedExecutionLeaseApprovalBinding,
  ): AttendedTrustedExecutionLeaseApprovalDecision | Promise<AttendedTrustedExecutionLeaseApprovalDecision>;
}

export interface AttendedTrustedExecutionLeaseAuthorityOptions {
  readonly binding: AttendedTrustedExecutionLeaseAuthorityBinding;
  readonly approvalPort: AttendedTrustedExecutionLeaseApprovalPort;
  readonly now?: () => string;
}

/** The request fields that the authority may approve for the one fixed tree. */
export interface AttendedTrustedExecutionLeaseIssueRequest {
  readonly harness: TrustedExecutionHarness;
  readonly routeId: string;
  readonly profileCeiling: TrustedExecutionProfile;
  readonly allowedToolNames: readonly string[];
  readonly effectCeiling: ActionEffectEnvelope;
  readonly policyDigest: string;
  readonly enforcementRevision: string;
  readonly durationMs: number;
}

/** Use inputs cannot replace the authority-owned identity and revision binding. */
export interface AttendedTrustedExecutionLeaseUseRequest {
  readonly now: string;
  readonly harness: TrustedExecutionHarness;
  readonly routeId: string;
  readonly policyDigest: string;
  readonly enforcementRevision: string;
  readonly requestedProfile: TrustedExecutionProfile;
  readonly toolName: string;
  readonly effect: ResolvedInvocationEffect;
}

export type AttendedTrustedExecutionLeaseAuthorityLifecycle =
  | "open"
  | "approval-pending"
  | "active"
  | "completed"
  | "session-closed"
  | "revoked"
  | "composition-revision-changed";

export type AttendedTrustedExecutionLeaseIssueDenialReason =
  | "approval-pending"
  | "approval-denied"
  | "approval-failed"
  | "approval-malformed"
  | "approval-expired"
  | "invalid-request"
  | "lease-already-issued"
  | "completed"
  | "session-closed"
  | "revoked"
  | "composition-revision-changed";

export type AttendedTrustedExecutionLeaseIssueResult =
  | { readonly status: "issued"; readonly lease: TrustedExecutionLease }
  | { readonly status: "denied"; readonly reason: AttendedTrustedExecutionLeaseIssueDenialReason };

const AUTHORITY_BINDING_KEYS = [
  "localPrincipalId",
  "operatorSessionId",
  "invocationTreeId",
  "projectRuntimeId",
  "compositionRevision",
] as const;

const ISSUE_REQUEST_KEYS = [
  "harness",
  "routeId",
  "profileCeiling",
  "allowedToolNames",
  "effectCeiling",
  "policyDigest",
  "enforcementRevision",
  "durationMs",
] as const;

const USE_REQUEST_KEYS = [
  "now",
  "harness",
  "routeId",
  "policyDigest",
  "enforcementRevision",
  "requestedProfile",
  "toolName",
  "effect",
] as const;

const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_RUNTIME_ID = /^krp_[a-f0-9]{64}$/u;
const PORTABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;

/**
 * Process-local owner for one attended operator session and one invocation tree.
 *
 * This class intentionally has no durable state, renewal, child-inheritance,
 * fallback, or serialization API. The returned Core lease is passive evidence;
 * use evaluation remains conjunctive with the caller's existing authority.
 */
export class AttendedTrustedExecutionLeaseAuthority {
  readonly #approvalPort: AttendedTrustedExecutionLeaseApprovalPort;
  readonly #now: () => string;
  #binding: AttendedTrustedExecutionLeaseAuthorityBinding;
  #lifecycle: AttendedTrustedExecutionLeaseAuthorityLifecycle = "open";
  #lease: TrustedExecutionLease | undefined;

  constructor(options: AttendedTrustedExecutionLeaseAuthorityOptions) {
    this.#binding = normalizeAuthorityBinding(options.binding);
    if (!options.approvalPort || typeof options.approvalPort.approve !== "function") {
      throw new TypeError("Attended trusted-execution approval port is required.");
    }
    this.#approvalPort = options.approvalPort;
    this.#now = options.now ?? (() => new Date().toISOString());
    // Validate the authority clock at construction so a malformed clock cannot
    // become a hidden source of malformed lifecycle evidence later.
    normalizeTimestamp(this.#now(), "authority now");
  }

  get binding(): AttendedTrustedExecutionLeaseAuthorityBinding {
    return this.#binding;
  }

  get lifecycle(): AttendedTrustedExecutionLeaseAuthorityLifecycle {
    return this.#lifecycle;
  }

  get currentLease(): TrustedExecutionLease | undefined {
    return this.#lease;
  }

  /** Ask once for the exact fixed-tree authority candidate. */
  async issue(input: AttendedTrustedExecutionLeaseIssueRequest): Promise<AttendedTrustedExecutionLeaseIssueResult> {
    const unavailable = this.#unavailableReason();
    if (unavailable !== undefined) return { status: "denied", reason: unavailable };
    if (this.#lifecycle === "approval-pending") return { status: "denied", reason: "approval-pending" };
    if (!isRecordWithExactKeys(input, ISSUE_REQUEST_KEYS)) return { status: "denied", reason: "invalid-request" };

    const candidate = this.#candidate(input);
    if (!candidate) return { status: "denied", reason: "invalid-request" };
    this.#lifecycle = "approval-pending";

    let decision: AttendedTrustedExecutionLeaseApprovalDecision;
    try {
      decision = await this.#approvalPort.approve(toApprovalBinding(candidate));
    } catch {
      this.#lifecycle = "open";
      return { status: "denied", reason: "approval-failed" };
    }

    if (this.#lifecycle !== "approval-pending") {
      return { status: "denied", reason: lifecycleDenialReason(this.#lifecycle) };
    }

    const normalizedDecision = normalizeApprovalDecision(decision);
    if (!normalizedDecision) {
      this.#lifecycle = "open";
      return { status: "denied", reason: "approval-malformed" };
    }
    if (normalizedDecision.status === "denied") {
      this.#lifecycle = "open";
      return { status: "denied", reason: "approval-denied" };
    }

    let now: string;
    try {
      now = normalizeTimestamp(this.#now(), "authority now");
    } catch {
      this.#lifecycle = "open";
      return { status: "denied", reason: "approval-failed" };
    }
    if (Date.parse(now) >= Date.parse(candidate.expiresAt)) {
      this.#lifecycle = "open";
      return { status: "denied", reason: "approval-expired" };
    }

    try {
      const lease = validateTrustedExecutionLeaseEvidence({
        ...candidate,
        ...(normalizedDecision.authorizedBy === undefined ? {} : { authorizedBy: normalizedDecision.authorizedBy }),
        status: { kind: "active" },
      });
      this.#lease = lease;
      this.#lifecycle = "active";
      return { status: "issued", lease };
    } catch {
      this.#lifecycle = "open";
      return { status: "denied", reason: "approval-malformed" };
    }
  }

  /** Observe one exact use through Core's passive lease evaluator. */
  evaluateUse(input: AttendedTrustedExecutionLeaseUseRequest): TrustedExecutionLeaseUseEvaluation {
    if (!isRecordWithExactKeys(input, USE_REQUEST_KEYS)) {
      return {
        matches: false,
        status: this.#lease?.status.kind ?? "absent",
        reason: "malformed-context",
      };
    }
    try {
      const context: TrustedExecutionLeaseUseContext = {
        ...input,
        ...this.#binding,
      };
      const evaluation = evaluateTrustedExecutionLeaseUse(this.#lease, context);
      if (!evaluation.matches && evaluation.reason === "expired" && this.#lifecycle === "active") {
        // Expiry is an earliest-end boundary. Once observed, latch a terminal
        // state so a later wall-clock rollback cannot resurrect the lease.
        this.#transitionLease("revoked", input.now);
        return { ...evaluation, status: "revoked" };
      }
      return evaluation;
    } catch {
      return {
        matches: false,
        status: this.#lease?.status.kind ?? "absent",
        reason: "malformed-context",
      };
    }
  }

  /** Settle the exact tree; no subsequent authority can be issued. */
  completeInvocation(): void {
    if (this.#lifecycle === "active" && this.#lease !== undefined) {
      this.#transitionLease("completed");
      return;
    }
    if (this.#lifecycle === "open" || this.#lifecycle === "approval-pending") this.#lifecycle = "completed";
  }

  /** Close the owner session and invalidate any active or pending authority. */
  closeSession(): void {
    if (this.#lifecycle === "session-closed") return;
    if (this.#lifecycle === "active" && this.#lease !== undefined) {
      this.#transitionLease("session-closed");
      return;
    }
    if (this.#lifecycle === "open" || this.#lifecycle === "approval-pending") this.#lifecycle = "session-closed";
  }

  /** Explicitly revoke an active lease; revocation is terminal and idempotent. */
  revoke(): void {
    if (this.#lifecycle === "active" && this.#lease !== undefined) {
      this.#transitionLease("revoked");
      return;
    }
    if (this.#lifecycle === "open" || this.#lifecycle === "approval-pending") this.#lifecycle = "revoked";
  }

  /** Invalidate this authority when the composition revision changes. */
  onCompositionRevisionChange(compositionRevision: string): void {
    const normalized = requirePattern(compositionRevision, "compositionRevision", SHA256_ID) as `sha256:${string}`;
    if (normalized === this.#binding.compositionRevision) return;
    this.#binding = Object.freeze({ ...this.#binding, compositionRevision: normalized });
    if (this.#lifecycle === "active" && this.#lease !== undefined) {
      this.#transitionLease("revoked");
      this.#lifecycle = "composition-revision-changed";
      return;
    }
    if (this.#lifecycle === "open" || this.#lifecycle === "approval-pending") {
      this.#lifecycle = "composition-revision-changed";
    }
  }

  #candidate(
    input: AttendedTrustedExecutionLeaseIssueRequest,
  ): Omit<TrustedExecutionLease, "status" | "authorizedBy"> | undefined {
    if (
      !Number.isSafeInteger(input.durationMs) ||
      input.durationMs <= 0 ||
      input.durationMs > TRUSTED_EXECUTION_LEASE_MAX_DURATION_MS
    ) {
      return undefined;
    }
    try {
      const issuedAt = normalizeTimestamp(this.#now(), "issuedAt");
      const expiresAt = new Date(Date.parse(issuedAt) + input.durationMs).toISOString();
      const candidate = validateTrustedExecutionLeaseEvidence({
        ...this.#binding,
        kind: "trusted-execution-lease",
        scope: "session",
        harness: input.harness,
        routeId: input.routeId,
        profileCeiling: input.profileCeiling,
        allowedToolNames: input.allowedToolNames,
        effectCeiling: input.effectCeiling,
        policyDigest: input.policyDigest,
        enforcementRevision: input.enforcementRevision,
        issuedAt,
        expiresAt,
        status: { kind: "active" },
      });
      const { status: _status, ...binding } = candidate;
      return binding;
    } catch {
      return undefined;
    }
  }

  #transitionLease(kind: "completed" | "session-closed" | "revoked", transitionAt?: string): void {
    if (this.#lease === undefined || this.#lease.status.kind !== "active") return;
    // A terminal transition must always remove authority, even if the wall
    // clock moves backwards or becomes unavailable after issuance. Clamp the
    // display timestamp to issuedAt; authority derives from the terminal kind,
    // never from the timestamp.
    let at = this.#lease.issuedAt;
    try {
      const observedAt = normalizeTimestamp(transitionAt ?? this.#now(), "lifecycle transition time");
      if (Date.parse(observedAt) >= Date.parse(this.#lease.issuedAt)) at = observedAt;
    } catch {
      // Keep the already validated issuance timestamp as fail-closed evidence.
    }
    this.#lease = Object.freeze({
      ...this.#lease,
      status: Object.freeze({ kind, at }),
    });
    this.#lifecycle = kind;
  }

  #unavailableReason(): AttendedTrustedExecutionLeaseIssueDenialReason | undefined {
    switch (this.#lifecycle) {
      case "open":
        return undefined;
      case "approval-pending":
        return "approval-pending";
      case "active":
        return "lease-already-issued";
      case "completed":
        return "completed";
      case "session-closed":
        return "session-closed";
      case "revoked":
        return "revoked";
      case "composition-revision-changed":
        return "composition-revision-changed";
    }
  }
}

function toApprovalBinding(
  candidate: Omit<TrustedExecutionLease, "status" | "authorizedBy">,
): AttendedTrustedExecutionLeaseApprovalBinding {
  return Object.freeze({
    ...candidate,
    allowedToolNames: Object.freeze([...candidate.allowedToolNames]),
    effectCeiling: Object.freeze({
      ...candidate.effectCeiling,
      boundaries: Object.freeze([...candidate.effectCeiling.boundaries]),
      consequences: Object.freeze([...candidate.effectCeiling.consequences]),
    }),
  });
}

function normalizeApprovalDecision(input: unknown): AttendedTrustedExecutionLeaseApprovalDecision | undefined {
  if (!isPlainRecord(input) || typeof input.status !== "string") return undefined;
  if (input.status === "denied") {
    return Object.keys(input).length === 1 ? { status: "denied" } : undefined;
  }
  if (input.status !== "approved") return undefined;
  if (Object.keys(input).some((key) => key !== "status" && key !== "authorizedBy")) return undefined;
  if (input.authorizedBy === undefined) return { status: "approved" };
  if (
    typeof input.authorizedBy !== "string" ||
    input.authorizedBy.length === 0 ||
    input.authorizedBy.length > 256 ||
    input.authorizedBy !== input.authorizedBy.trim()
  ) {
    return undefined;
  }
  return Object.freeze({ status: "approved", authorizedBy: input.authorizedBy });
}

function normalizeAuthorityBinding(input: unknown): AttendedTrustedExecutionLeaseAuthorityBinding {
  if (!isRecordWithExactKeys(input, AUTHORITY_BINDING_KEYS))
    throw new TypeError("Attended trusted-execution authority binding is malformed.");
  const binding = {
    localPrincipalId: requirePortableIdentifier(input.localPrincipalId, "localPrincipalId"),
    operatorSessionId: requirePortableIdentifier(input.operatorSessionId, "operatorSessionId"),
    invocationTreeId: requirePortableIdentifier(input.invocationTreeId, "invocationTreeId"),
    projectRuntimeId: requirePattern(input.projectRuntimeId, "projectRuntimeId", PROJECT_RUNTIME_ID) as `krp_${string}`,
    compositionRevision: requirePattern(
      input.compositionRevision,
      "compositionRevision",
      SHA256_ID,
    ) as `sha256:${string}`,
  };
  if (binding.localPrincipalId === binding.operatorSessionId) {
    throw new TypeError("localPrincipalId must be distinct from operatorSessionId.");
  }
  return Object.freeze(binding);
}

function lifecycleDenialReason(
  lifecycle: AttendedTrustedExecutionLeaseAuthorityLifecycle,
): AttendedTrustedExecutionLeaseIssueDenialReason {
  switch (lifecycle) {
    case "approval-pending":
      return "approval-pending";
    case "active":
      return "lease-already-issued";
    case "completed":
      return "completed";
    case "session-closed":
      return "session-closed";
    case "revoked":
      return "revoked";
    case "composition-revision-changed":
      return "composition-revision-changed";
    case "open":
      return "approval-failed";
  }
}

function isRecordWithExactKeys(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  return (
    isPlainRecord(input) && Object.keys(input).length === keys.length && keys.every((key) => Object.hasOwn(input, key))
  );
}

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}

function requirePortableIdentifier(input: unknown, label: string): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 128 ||
    input !== input.trim() ||
    !PORTABLE_IDENTIFIER.test(input)
  ) {
    throw new TypeError(`${label} is malformed.`);
  }
  return input;
}

function requirePattern(input: unknown, label: string, pattern: RegExp): string {
  if (typeof input !== "string" || !pattern.test(input)) throw new TypeError(`${label} is malformed.`);
  return input;
}

function normalizeTimestamp(input: unknown, label: string): string {
  if (typeof input !== "string") throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== input)
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  return input;
}
