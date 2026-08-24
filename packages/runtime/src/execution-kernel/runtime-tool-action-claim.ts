import { createHash, randomUUID } from "node:crypto";
import type { ResolvedInvocationEffect } from "@kilnai/core";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";

export type RuntimeToolActionClaimId = `sha256:${string}`;
export type RuntimeToolActionDigest = `sha256:${string}`;
export type RuntimeToolActionAdmissionReceipt = EffectiveAuthorityAdmissionBundle;

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;

export interface RuntimeToolActionClaim {
  readonly claimId: RuntimeToolActionClaimId;
  readonly admissionId: RuntimeToolActionDigest;
  readonly sessionId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  /** Exact normalized selector chosen before the claim boundary. */
  readonly selector: string;
  /** Canonical normalized input JSON chosen before the claim boundary. */
  readonly normalizedInput: string;
  readonly resolvedEffect: ResolvedInvocationEffect;
  /** Prepared adapter identity; no adapter discovery is permitted after claim. */
  readonly adapterIdentity: string;
  readonly status: "claimed" | "settled" | "unknown";
  readonly claimedAt?: string;
  readonly settledAt?: string;
  /** Present only when the claimed effect settled successfully. Unknown effects use status/unknownReason. */
  readonly outcome?: "success";
  readonly unknownReason?: string;
}

declare const runtimeToolActionPermitBrand: unique symbol;

export interface RuntimeToolActionClaimPermit {
  /** Opaque process-private capability consumed exactly once at the effect boundary. */
  readonly permitId: string;
  readonly claimId: RuntimeToolActionClaimId;
  readonly consume: () => void;
  readonly [runtimeToolActionPermitBrand]: true;
}

export interface RuntimeToolActionDispatchState {
  claimed: boolean;
  claimId?: RuntimeToolActionClaimId;
  outcome?: "success" | "unknown";
}

export interface RuntimeToolActionClaimStore {
  claim(input: RuntimeToolActionClaim): RuntimeToolActionClaimPermit;
  settle(
    permit: RuntimeToolActionClaimPermit,
    settlement:
      | { readonly kind: "success"; readonly settledAt?: string }
      | { readonly kind: "unknown"; readonly reason: string; readonly settledAt?: string },
  ): void;
}

export interface RuntimeToolActionClaimsContext {
  /** The immutable full bundle persisted by the workload's admission owner. */
  readonly admission: RuntimeToolActionAdmissionReceipt;
  readonly attemptId: string;
  /** Prefix or workload binding used to identify the already prepared adapter. */
  readonly adapterIdentity: string;
  /** Optional when a child action is bound to a parent persisted admission. */
  readonly admissionReadbackSessionId?: string;
  readonly admissionReadbackTurnId?: string;
  /** Must read back the full immutable bundle before every claim. */
  readonly readAdmission: (input: {
    readonly admissionId: string;
    readonly sessionId: string;
    readonly turnId: string;
  }) => RuntimeToolActionAdmissionReceipt | undefined | Promise<RuntimeToolActionAdmissionReceipt | undefined>;
  readonly store: RuntimeToolActionClaimStore;
  readonly state?: RuntimeToolActionDispatchState;
}

export interface RuntimeToolActionDispatchInput {
  readonly admission: RuntimeToolActionAdmissionReceipt;
  readonly sessionId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly toolCallScopeId: string;
  readonly toolCallId: string;
  readonly selector: string;
  readonly normalizedInput: string;
  readonly resolvedEffect: ResolvedInvocationEffect;
  readonly adapterIdentity: string;
  readonly admissionReadbackSessionId?: string;
  readonly admissionReadbackTurnId?: string;
  readonly readAdmission: RuntimeToolActionClaimsContext["readAdmission"];
  readonly store: RuntimeToolActionClaimStore;
  /** Synchronous final authority guard after readback and before claim. */
  readonly beforeClaim?: () => void;
  /** Prepared adapter invocation. It must be the next effect after permit.consume(). */
  readonly invoke: () => Promise<unknown>;
  readonly abortSignal?: AbortSignal;
  readonly state?: RuntimeToolActionDispatchState;
}

export class RuntimeToolActionCommittedError extends Error {
  override readonly name = "RuntimeToolActionCommittedError";
  readonly retryable = false;
  readonly claimId: RuntimeToolActionClaimId;

  constructor(cause: unknown, claimId: RuntimeToolActionClaimId) {
    super("The Runtime tool action was claimed; its effect outcome is not safely replayable.", { cause });
    this.claimId = claimId;
  }
}

export class RuntimeToolActionPreDispatchCancellationError extends Error {
  override readonly name = "RuntimeToolActionPreDispatchCancellationError";
}

/** Runtime owner for exactly one consequential tool/MCP effect. */
export class RuntimeToolActionDispatchService {
  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  async dispatch(input: RuntimeToolActionDispatchInput): Promise<unknown> {
    if (input.abortSignal?.aborted) {
      throw new RuntimeToolActionPreDispatchCancellationError(
        "The Runtime tool action was cancelled before its action claim.",
      );
    }

    const expectedAdmission = assertPersistableAuthorityAdmissionBundle(input.admission);
    const persisted = await input.readAdmission({
      admissionId: expectedAdmission.admissionId,
      sessionId: input.admissionReadbackSessionId ?? expectedAdmission.sessionId,
      turnId: input.admissionReadbackTurnId ?? expectedAdmission.turnId,
    });
    if (!persisted) throw new Error("Runtime tool-action admission evidence is missing before claiming.");
    const persistedAdmission = assertPersistableAuthorityAdmissionBundle(persisted);
    assertAdmissionMatches(input, expectedAdmission, persistedAdmission);
    assertCanonicalSha256Id(expectedAdmission.admissionId, "admission.admissionId");
    const guardResult = input.beforeClaim?.() as unknown;
    if (guardResult !== undefined) {
      throw new TypeError("Runtime tool-action beforeClaim guard must complete synchronously.");
    }

    const claim = defineRuntimeToolActionClaim(input, this.now());
    assertRuntimeToolActionClaim(claim);

    // This is the final cancellation gate. After claim(), cancellation is
    // represented by the adapter outcome and is never used to redispatch.
    if (input.abortSignal?.aborted) {
      throw new RuntimeToolActionPreDispatchCancellationError(
        "The Runtime tool action was cancelled before its action claim.",
      );
    }
    const permit = input.store.claim(claim);
    if (input.state) {
      input.state.claimed = true;
      input.state.claimId = claim.claimId;
    }

    try {
      // No fallible work belongs between consumption and this one adapter call.
      permit.consume();
    } catch (error) {
      if (input.state) input.state.outcome = "unknown";
      throw new RuntimeToolActionCommittedError(error, claim.claimId);
    }

    let result: unknown;
    try {
      result = await input.invoke();
    } catch (error) {
      if (input.state) input.state.outcome = "unknown";
      this.settleUnknown(input.store, permit, claim.claimId, error);
      throw new RuntimeToolActionCommittedError(error, claim.claimId);
    }

    try {
      input.store.settle(permit, { kind: "success", settledAt: this.now() });
      if (input.state) input.state.outcome = "success";
    } catch (error) {
      if (input.state) input.state.outcome = "unknown";
      throw new RuntimeToolActionCommittedError(error, claim.claimId);
    }
    return result;
  }

  private settleUnknown(
    store: RuntimeToolActionClaimStore,
    permit: RuntimeToolActionClaimPermit,
    claimId: RuntimeToolActionClaimId,
    cause: unknown,
  ): void {
    try {
      store.settle(permit, { kind: "unknown", reason: "tool-dispatch-failed", settledAt: this.now() });
    } catch (error) {
      throw new RuntimeToolActionCommittedError(error, claimId);
    }
    void cause;
  }
}

export function defineRuntimeToolActionClaim(
  input: Pick<
    RuntimeToolActionDispatchInput,
    | "admission"
    | "sessionId"
    | "turnId"
    | "attemptId"
    | "toolCallScopeId"
    | "toolCallId"
    | "selector"
    | "normalizedInput"
    | "resolvedEffect"
    | "adapterIdentity"
  >,
  claimedAt: string,
): RuntimeToolActionClaim {
  const identity = {
    admissionId: input.admission.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    toolCallScopeId: input.toolCallScopeId,
    toolCallId: input.toolCallId,
    selector: input.selector,
    normalizedInput: input.normalizedInput,
    resolvedEffect: input.resolvedEffect,
    adapterIdentity: input.adapterIdentity,
  } as const;
  const claimId = runtimeToolActionClaimIdFor(identity);
  return Object.freeze({ ...identity, claimId, status: "claimed", claimedAt });
}

export function runtimeToolActionClaimIdFor(
  input: Pick<
    RuntimeToolActionClaim,
    | "admissionId"
    | "sessionId"
    | "turnId"
    | "attemptId"
    | "toolCallScopeId"
    | "toolCallId"
    | "selector"
    | "normalizedInput"
    | "resolvedEffect"
    | "adapterIdentity"
  >,
): RuntimeToolActionClaimId {
  return digest({
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    toolCallScopeId: input.toolCallScopeId,
    toolCallId: input.toolCallId,
    selector: input.selector,
    normalizedInput: input.normalizedInput,
    resolvedEffect: input.resolvedEffect,
    adapterIdentity: input.adapterIdentity,
  }) as RuntimeToolActionClaimId;
}

function assertAdmissionMatches(
  input: RuntimeToolActionDispatchInput,
  expected: RuntimeToolActionAdmissionReceipt,
  persisted: RuntimeToolActionAdmissionReceipt,
): void {
  if (
    persisted.admissionId !== expected.admissionId ||
    persisted.sessionId !== expected.sessionId ||
    persisted.turnId !== expected.turnId ||
    (!input.admissionReadbackSessionId && expected.sessionId !== input.sessionId) ||
    (!input.admissionReadbackTurnId && expected.turnId !== input.turnId)
  ) {
    throw new Error("The Runtime tool action does not match the persisted admission identity.");
  }
  // Revalidation above proves the complete immutable bundle digest, not merely
  // a projection of route or tool fields.
}

function assertCanonicalSha256Id(value: unknown, label: string): asserts value is RuntimeToolActionDigest {
  if (typeof value !== "string" || !CANONICAL_SHA256_ID.test(value)) {
    throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
  }
}

function assertClaimText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} is required.`);
}

function digest(value: unknown): RuntimeToolActionDigest {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function runtimeToolActionEffectIdentity(input: unknown): RuntimeToolActionDigest {
  return digest(input);
}

export function createRuntimeToolActionPermitId(): string {
  return `runtime-tool-action:${randomUUID()}`;
}

export function assertRuntimeToolActionClaim(input: RuntimeToolActionClaim): void {
  assertCanonicalSha256Id(input.claimId, "claimId");
  assertCanonicalSha256Id(input.admissionId, "admissionId");
  for (const [label, value] of [
    ["sessionId", input.sessionId],
    ["turnId", input.turnId],
    ["attemptId", input.attemptId],
    ["toolCallScopeId", input.toolCallScopeId],
    ["toolCallId", input.toolCallId],
    ["selector", input.selector],
    ["normalizedInput", input.normalizedInput],
    ["adapterIdentity", input.adapterIdentity],
  ] as const)
    assertClaimText(value, label);
  if (!input.resolvedEffect || typeof input.resolvedEffect !== "object") {
    throw new TypeError("resolvedEffect is required.");
  }
  if (input.status !== "claimed") throw new TypeError("A new Runtime tool action claim must be claimed.");
  if (input.claimId !== runtimeToolActionClaimIdFor(input)) {
    throw new TypeError("claimId must be the canonical digest of the immutable Runtime tool-action identity.");
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
