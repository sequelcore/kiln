import { createHash, randomUUID } from "node:crypto";
import type { AgentResponse, AgentStreamEvent, CreateMessageOptions, ProviderAdapter } from "@kilnai/core";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";

export type RuntimeModelRoundActionClaimId = `sha256:${string}`;
export type RuntimeModelRoundAdmissionId = `sha256:${string}`;
export type RuntimeModelRoundDigest = `sha256:${string}`;
export type RuntimeModelRoundAdmissionReceipt = EffectiveAuthorityAdmissionBundle;

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;

export function isCanonicalRuntimeModelRoundSha256Id(value: unknown): value is RuntimeModelRoundDigest {
  return typeof value === "string" && CANONICAL_SHA256_ID.test(value);
}

export function assertCanonicalRuntimeModelRoundSha256Id(
  value: unknown,
  label: string,
): asserts value is RuntimeModelRoundDigest {
  if (!isCanonicalRuntimeModelRoundSha256Id(value)) {
    throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
  }
}

export interface RuntimeModelRoundActionClaim {
  readonly claimId: RuntimeModelRoundActionClaimId;
  readonly admissionId: RuntimeModelRoundAdmissionId;
  readonly sessionId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly round: number;
  readonly intentFingerprint: RuntimeModelRoundDigest;
  readonly effectIdentity: RuntimeModelRoundDigest;
  readonly providerRequestId: string;
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialRevision: string;
  readonly status: "claimed" | "settled" | "unknown";
  readonly claimedAt?: string;
  readonly settledAt?: string;
  readonly outcome?: "success" | "unknown";
  readonly unknownReason?: string;
}

declare const runtimeModelRoundPermitBrand: unique symbol;

export interface RuntimeModelRoundActionClaimPermit {
  /** Opaque process-local capability. It can be consumed exactly once. */
  readonly permitId: string;
  readonly claimId: RuntimeModelRoundActionClaimId;
  readonly consume: () => void;
  readonly [runtimeModelRoundPermitBrand]: true;
}

export interface RuntimeModelRoundDispatchState {
  claimed: boolean;
  outcome?: "success" | "unknown";
}

export interface RuntimeModelRoundActionClaimStore {
  /** Atomically creates one claim and returns its one-use permit. */
  claim(input: RuntimeModelRoundActionClaim): RuntimeModelRoundActionClaimPermit;
  /** Settles or conservatively marks the claim unknown after exact-boundary consumption. */
  settle(
    permit: RuntimeModelRoundActionClaimPermit,
    settlement:
      | { readonly kind: "success"; readonly settledAt?: string }
      | { readonly kind: "unknown"; readonly reason: string; readonly settledAt?: string },
  ): void;
}

/**
 * Workload-neutral context for one direct provider model round. Each workload
 * supplies its own durable store and admission readback; Runtime owns only the
 * sequencing between readback, claim, one provider call, and settlement.
 */
export interface RuntimeModelRoundDispatchContext {
  readonly admission: RuntimeModelRoundAdmissionReceipt;
  readonly intentFingerprint: RuntimeModelRoundDigest;
  readonly attemptId: string;
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialRevision: string;
  /**
   * Child workloads may execute in a derived RuntimeSession while the
   * persisted admission remains owned by the parent turn. These identities
   * select that exact persisted readback record; they never become claim
   * identity or authority by themselves.
   */
  readonly admissionReadbackSessionId?: string;
  readonly admissionReadbackTurnId?: string;
  readonly readAdmission: () => RuntimeModelRoundAdmissionReceipt | Promise<RuntimeModelRoundAdmissionReceipt>;
  readonly store: RuntimeModelRoundActionClaimStore;
  readonly state?: RuntimeModelRoundDispatchState;
}

export interface RuntimeModelRoundDispatchInput {
  readonly admission: RuntimeModelRoundAdmissionReceipt;
  readonly sessionId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly round: number;
  readonly intentFingerprint: RuntimeModelRoundDigest;
  readonly effectIdentity: RuntimeModelRoundDigest;
  readonly providerRequestId: string;
  readonly routeId: string;
  readonly accountId: string;
  readonly credentialRevision: string;
  readonly admissionReadbackSessionId?: string;
  readonly admissionReadbackTurnId?: string;
  /** Must read and validate the immutable persisted admission before claim(). */
  readonly readAdmission: () => RuntimeModelRoundAdmissionReceipt | Promise<RuntimeModelRoundAdmissionReceipt>;
  /** Adapter and exact binding are prepared before this service is entered. */
  readonly provider: ProviderAdapter;
  readonly request: CreateMessageOptions;
  readonly abortSignal?: AbortSignal;
  /** Process-local, non-fallible state projection for outer retry/settlement owners. */
  readonly state?: RuntimeModelRoundDispatchState;
}

export class RuntimeModelRoundCommittedError extends Error {
  override readonly name = "RuntimeModelRoundCommittedError";
  readonly retryable = false;
  readonly claimId: RuntimeModelRoundActionClaimId;

  constructor(cause: unknown, claimId: RuntimeModelRoundActionClaimId) {
    super("The Runtime model round was claimed; its provider outcome is not safely replayable.", { cause });
    this.claimId = claimId;
  }
}

export class RuntimeModelRoundPreDispatchCancellationError extends Error {
  override readonly name = "RuntimeModelRoundPreDispatchCancellationError";
}

/** Runtime owner for one direct-provider model round inside any workload. */
export class RuntimeModelRoundDispatchService {
  constructor(
    private readonly store: RuntimeModelRoundActionClaimStore,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async dispatch(input: RuntimeModelRoundDispatchInput): Promise<AgentResponse> {
    if (input.abortSignal?.aborted) {
      throw new RuntimeModelRoundPreDispatchCancellationError("The Runtime model round was cancelled before its action claim.");
    }

    const expectedAdmission = assertPersistableAuthorityAdmissionBundle(input.admission);
    const persistedAdmission = assertPersistableAuthorityAdmissionBundle(await input.readAdmission());
    assertAdmissionMatches(input, expectedAdmission, persistedAdmission);
    assertCanonicalRuntimeModelRoundSha256Id(expectedAdmission.admissionId, "admission.admissionId");
    assertCanonicalRuntimeModelRoundSha256Id(input.intentFingerprint, "intentFingerprint");
    assertCanonicalRuntimeModelRoundSha256Id(input.effectIdentity, "effectIdentity");
    const claim = defineRuntimeModelRoundActionClaim(input, this.now());
    if (input.abortSignal?.aborted) {
      throw new RuntimeModelRoundPreDispatchCancellationError("The Runtime model round was cancelled before its action claim.");
    }
    const permit = this.store.claim(claim);
    if (input.state) input.state.claimed = true;

    try {
      // Consumption is the final process-local step immediately before the
      // sole provider effect. No fallible work belongs between these calls.
      permit.consume();
    } catch (error) {
      if (input.state) input.state.outcome = "unknown";
      // The durable claim remains claimed and is reconciled to unknown on
      // restart; there is no safe fallback after the claim boundary.
      throw new RuntimeModelRoundCommittedError(error, claim.claimId);
    }

    let response: AgentResponse;
    try {
      // The permit is intentionally consumed by exactly this one call. Do not
      // retry here, even when the adapter reports a transport-looking error.
      response = await input.provider.createMessage(input.request);
    } catch (error) {
      this.settleUnknown(permit, claim.claimId, error);
      if (input.state) input.state.outcome = "unknown";
      throw new RuntimeModelRoundCommittedError(error, claim.claimId);
    }

    try {
      this.store.settle(permit, { kind: "success", settledAt: this.now() });
      if (input.state) input.state.outcome = "success";
    } catch (error) {
      if (input.state) input.state.outcome = "unknown";
      throw new RuntimeModelRoundCommittedError(error, claim.claimId);
    }
    return response;
  }

  async *dispatchStream(input: RuntimeModelRoundDispatchInput): AsyncGenerator<AgentStreamEvent> {
    if (input.abortSignal?.aborted) {
      throw new RuntimeModelRoundPreDispatchCancellationError("The Runtime model round was cancelled before its action claim.");
    }

    const expectedAdmission = assertPersistableAuthorityAdmissionBundle(input.admission);
    const persistedAdmission = assertPersistableAuthorityAdmissionBundle(await input.readAdmission());
    assertAdmissionMatches(input, expectedAdmission, persistedAdmission);
    assertCanonicalRuntimeModelRoundSha256Id(expectedAdmission.admissionId, "admission.admissionId");
    assertCanonicalRuntimeModelRoundSha256Id(input.intentFingerprint, "intentFingerprint");
    assertCanonicalRuntimeModelRoundSha256Id(input.effectIdentity, "effectIdentity");
    const claim = defineRuntimeModelRoundActionClaim(input, this.now());
    if (input.abortSignal?.aborted) {
      throw new RuntimeModelRoundPreDispatchCancellationError("The Runtime model round was cancelled before its action claim.");
    }
    const permit = this.store.claim(claim);
    if (input.state) input.state.claimed = true;
    let settled = false;
    let settlementAttempted = false;
    let sawDone = false;

    try {
      // Consumption is the final process-local step immediately before the
      // sole provider stream effect. No fallible work belongs between these calls.
      permit.consume();
      for await (const event of input.provider.streamMessage(input.request)) {
        if (input.abortSignal?.aborted) {
          throw new Error("The Runtime model round stream was cancelled after its action claim.");
        }
        if (event.type === "done") sawDone = true;
        yield event;
      }
      if (!sawDone) {
        throw new Error("The Runtime model round stream ended without a terminal done event.");
      }
      settlementAttempted = true;
      this.store.settle(permit, { kind: "success", settledAt: this.now() });
      settled = true;
      if (input.state) input.state.outcome = "success";
    } catch (error) {
      if (!settled && !settlementAttempted) {
        settlementAttempted = true;
        this.settleUnknown(permit, claim.claimId, error);
        settled = true;
        if (input.state) input.state.outcome = "unknown";
      }
      if (error instanceof RuntimeModelRoundCommittedError) throw error;
      throw new RuntimeModelRoundCommittedError(error, claim.claimId);
    } finally {
      // A consumer can close the iterator before the provider returns. The
      // claim is still consumed, so preserve success only after a terminal
      // event; otherwise leave durable unknown evidence.
      if (!settled && !settlementAttempted) {
        settlementAttempted = true;
        if (sawDone && !input.abortSignal?.aborted) {
          try {
            this.store.settle(permit, { kind: "success", settledAt: this.now() });
            if (input.state) input.state.outcome = "success";
          } catch {
            if (input.state) input.state.outcome = "unknown";
          }
        } else {
          try {
            this.store.settle(permit, { kind: "unknown", reason: "provider-stream-interrupted-after-claim", settledAt: this.now() });
          } catch {
            // The durable claim remains conservatively unresolved for restart reconciliation.
          }
          if (input.state) input.state.outcome = "unknown";
        }
      }
    }
  }

  private settleUnknown(
    permit: RuntimeModelRoundActionClaimPermit,
    claimId: RuntimeModelRoundActionClaimId,
    cause: unknown,
  ): void {
    try {
      this.store.settle(permit, { kind: "unknown", reason: "provider-dispatch-failed", settledAt: this.now() });
    } catch (settlementError) {
      throw new RuntimeModelRoundCommittedError(settlementError, claimId);
    }
    void cause;
  }
}

export function defineRuntimeModelRoundActionClaim(
  input: Pick<RuntimeModelRoundDispatchInput, "admission" | "sessionId" | "turnId" | "attemptId" | "round" | "intentFingerprint" | "effectIdentity" | "providerRequestId" | "routeId" | "accountId" | "credentialRevision">,
  claimedAt: string,
): RuntimeModelRoundActionClaim {
  const identity = {
    admissionId: input.admission.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    round: input.round,
    intentFingerprint: input.intentFingerprint,
    effectIdentity: input.effectIdentity,
    providerRequestId: input.providerRequestId,
    routeId: input.routeId,
    accountId: input.accountId,
    credentialRevision: input.credentialRevision,
  } as const;
  const claimId = `sha256:${createHash("sha256").update(stableStringify(identity), "utf8").digest("hex")}` as RuntimeModelRoundActionClaimId;
  return Object.freeze({ ...identity, claimId, status: "claimed", claimedAt });
}

function assertAdmissionMatches(
  input: RuntimeModelRoundDispatchInput,
  expected: RuntimeModelRoundAdmissionReceipt,
  persisted: RuntimeModelRoundAdmissionReceipt,
): void {
  const expectedExecution = expected.turn.execution;
  const persistedExecution = persisted.turn.execution;
  if (expectedExecution.status !== "routed" || persistedExecution.status !== "routed") {
    throw new Error("The Runtime model round requires a routed persisted admission.");
  }
  const binding = persistedExecution.binding;
  const readbackSessionId = input.admissionReadbackSessionId ?? expected.sessionId;
  const readbackTurnId = input.admissionReadbackTurnId ?? expected.turnId;
  if (
    persisted.admissionId !== expected.admissionId
    || persisted.sessionId !== readbackSessionId
    || persisted.turnId !== readbackTurnId
    || (!input.admissionReadbackSessionId && expected.sessionId !== input.sessionId)
    || (!input.admissionReadbackTurnId && expected.turnId !== input.turnId)
    || binding.routeId !== input.routeId
    || binding.accountId !== input.accountId
    || binding.credentialRevision !== input.credentialRevision
  ) {
    throw new Error("The Runtime model round does not match the persisted admission.");
  }
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

export function runtimeModelRoundEffectIdentity(input: unknown): RuntimeModelRoundDigest {
  return `sha256:${createHash("sha256").update(stableStringify(input), "utf8").digest("hex")}`;
}

export function createRuntimeModelRoundPermitId(): string {
  return `runtime-model-round:${randomUUID()}`;
}

/** Reads the immutable full admission used by a workload's model-round owner. */
export async function readRuntimeModelRoundAdmission(input: {
  readonly readAdmission: (input: {
    readonly admissionId: string;
    readonly sessionId: string;
    readonly turnId: string;
  }) => EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
  readonly admissionId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly expected: {
    readonly routeId: string;
    readonly accountId: string;
    readonly credentialRevision: string;
  };
}): Promise<EffectiveAuthorityAdmissionBundle> {
  const persisted = await input.readAdmission({
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
  });
  if (!persisted) throw new Error("Runtime model-round admission evidence is missing before claiming.");
  const admitted = assertPersistableAuthorityAdmissionBundle(persisted);
  if (admitted.admissionId !== input.admissionId || admitted.sessionId !== input.sessionId || admitted.turnId !== input.turnId) {
    throw new Error("Runtime model-round admission readback identity does not match the committed admission.");
  }
  if (admitted.turn.execution.status !== "routed") {
    throw new Error("Runtime model-round admission readback is not routed to a provider account.");
  }
  const binding = admitted.turn.execution.binding;
  if (
    binding.routeId !== input.expected.routeId
    || binding.accountId !== input.expected.accountId
    || binding.credentialRevision !== input.expected.credentialRevision
  ) {
    throw new Error("Runtime model-round admission readback binding does not match the fenced account identity.");
  }
  return admitted;
}
