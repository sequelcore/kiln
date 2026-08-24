import {
  type AttendedTrustedExecutionLeaseApprovalPort,
  AttendedTrustedExecutionLeaseAuthority,
  type AttendedTrustedExecutionLeaseAuthorityBinding,
  type AttendedTrustedExecutionLeaseAuthorityOptions,
} from "./attended-trusted-execution-lease-authority.js";

/** Session-owned identity and composition bindings shared by fixed-tree children. */
export type AttendedTrustedExecutionLeaseSessionBinding = Omit<
  AttendedTrustedExecutionLeaseAuthorityBinding,
  "invocationTreeId"
>;

export interface AttendedTrustedExecutionLeaseSessionAuthorityOptions {
  readonly binding: AttendedTrustedExecutionLeaseSessionBinding;
  readonly approvalPort: AttendedTrustedExecutionLeaseApprovalPort;
  readonly now?: () => string;
}

export type AttendedTrustedExecutionLeaseSessionAuthorityLifecycle =
  | "open"
  | "session-closed"
  | "revoked"
  | "composition-revision-changed";

export type AttendedTrustedExecutionLeaseSessionAuthorityErrorCode =
  | "invalid-invocation-tree"
  | "duplicate-invocation-tree"
  | "session-closed"
  | "revoked"
  | "composition-revision-changed";

export class AttendedTrustedExecutionLeaseSessionAuthorityError extends Error {
  override readonly name = "AttendedTrustedExecutionLeaseSessionAuthorityError";
  readonly code: AttendedTrustedExecutionLeaseSessionAuthorityErrorCode;

  constructor(code: AttendedTrustedExecutionLeaseSessionAuthorityErrorCode) {
    super(`Attended trusted-execution session authority rejected ${code}.`);
    this.code = code;
  }
}

const SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_RUNTIME_ID = /^krp_[a-f0-9]{64}$/u;
const PORTABLE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u;
const SESSION_BINDING_KEYS = [
  "localPrincipalId",
  "operatorSessionId",
  "projectRuntimeId",
  "compositionRevision",
] as const;

/**
 * Process-local owner for one attended operator session.
 *
 * Each invocation tree receives one independently attenuable child authority.
 * The registry, lifecycle, approval port, and all bindings stay in memory;
 * there is intentionally no serialization, persistence, renewal, or child
 * inheritance surface.
 */
export class AttendedTrustedExecutionLeaseSessionAuthority {
  readonly #approvalPort: AttendedTrustedExecutionLeaseApprovalPort;
  readonly #now: (() => string) | undefined;
  readonly #children = new Map<string, AttendedTrustedExecutionLeaseAuthority>();
  #binding: AttendedTrustedExecutionLeaseSessionBinding;
  #lifecycle: AttendedTrustedExecutionLeaseSessionAuthorityLifecycle = "open";

  constructor(options: AttendedTrustedExecutionLeaseSessionAuthorityOptions) {
    this.#binding = normalizeSessionBinding(options.binding);
    if (!options.approvalPort || typeof options.approvalPort.approve !== "function") {
      throw new TypeError("Attended trusted-execution approval port is required.");
    }
    this.#approvalPort = options.approvalPort;
    this.#now = options.now;
  }

  get binding(): AttendedTrustedExecutionLeaseSessionBinding {
    return this.#binding;
  }

  get lifecycle(): AttendedTrustedExecutionLeaseSessionAuthorityLifecycle {
    return this.#lifecycle;
  }

  /** Create exactly one child authority for one fixed invocation tree. */
  createInvocationTreeAuthority(invocationTreeId: string): AttendedTrustedExecutionLeaseAuthority {
    this.#assertCanCreate();
    const normalizedTreeId = normalizeInvocationTreeId(invocationTreeId);
    if (this.#children.has(normalizedTreeId)) {
      throw new AttendedTrustedExecutionLeaseSessionAuthorityError("duplicate-invocation-tree");
    }

    const childOptions: AttendedTrustedExecutionLeaseAuthorityOptions = {
      binding: { ...this.#binding, invocationTreeId: normalizedTreeId },
      approvalPort: this.#approvalPort,
      ...(this.#now === undefined ? {} : { now: this.#now }),
    };
    const child = new AttendedTrustedExecutionLeaseAuthority(childOptions);
    this.#children.set(normalizedTreeId, child);
    return child;
  }

  /** Close this session and fan out the terminal state to every child. */
  closeSession(): void {
    if (this.#lifecycle !== "session-closed") this.#lifecycle = "session-closed";
    this.#fanOut((child) => child.closeSession());
  }

  /** Revoke this session and fan out revocation to every child. */
  revoke(): void {
    if (this.#lifecycle === "revoked") {
      this.#fanOut((child) => child.revoke());
      return;
    }
    if (this.#lifecycle !== "open") return;
    this.#lifecycle = "revoked";
    this.#fanOut((child) => child.revoke());
  }

  /** Invalidate this session on a composition revision change. */
  onCompositionRevisionChange(compositionRevision: string): void {
    const normalizedRevision = normalizeRevision(compositionRevision);
    if (normalizedRevision === this.#binding.compositionRevision) return;
    if (this.#lifecycle !== "open") return;

    this.#binding = Object.freeze({ ...this.#binding, compositionRevision: normalizedRevision });
    this.#lifecycle = "composition-revision-changed";
    this.#fanOut((child) => child.onCompositionRevisionChange(normalizedRevision));
  }

  #assertCanCreate(): void {
    switch (this.#lifecycle) {
      case "open":
        return;
      case "session-closed":
      case "revoked":
      case "composition-revision-changed":
        throw new AttendedTrustedExecutionLeaseSessionAuthorityError(this.#lifecycle);
    }
  }

  #fanOut(action: (child: AttendedTrustedExecutionLeaseAuthority) => void): void {
    let firstError: unknown;
    for (const child of this.#children.values()) {
      try {
        action(child);
      } catch (error) {
        firstError ??= error;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
}

function normalizeSessionBinding(input: unknown): AttendedTrustedExecutionLeaseSessionBinding {
  if (
    !isPlainRecord(input) ||
    Object.keys(input).length !== SESSION_BINDING_KEYS.length ||
    !SESSION_BINDING_KEYS.every((key) => Object.hasOwn(input, key))
  ) {
    throw new TypeError("Attended trusted-execution session binding is malformed.");
  }
  const binding = {
    localPrincipalId: requirePortableIdentifier(input.localPrincipalId, "localPrincipalId"),
    operatorSessionId: requirePortableIdentifier(input.operatorSessionId, "operatorSessionId"),
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

function normalizeInvocationTreeId(input: unknown): string {
  if (
    typeof input !== "string" ||
    input.length === 0 ||
    input.length > 128 ||
    input !== input.trim() ||
    !PORTABLE_IDENTIFIER.test(input)
  ) {
    throw new AttendedTrustedExecutionLeaseSessionAuthorityError("invalid-invocation-tree");
  }
  return input;
}

function normalizeRevision(input: unknown): `sha256:${string}` {
  if (typeof input !== "string" || !SHA256_ID.test(input)) {
    throw new TypeError("compositionRevision is malformed.");
  }
  return input as `sha256:${string}`;
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

function isPlainRecord(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const prototype = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
