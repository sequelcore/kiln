import { createHash } from "node:crypto";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";

export type RuntimeMediaActionKind =
  | "stt-transcribe"
  | "tts-synthesize"
  | "multimodal-process";
export type RuntimeMediaActionClaimId = `sha256:${string}`;
export type RuntimeMediaActionDigest = `sha256:${string}`;
export type RuntimeMediaActionClaimStatus = "claimed" | "settled" | "unknown";

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const SECRET_SHAPED_KEY = /(?:access.?token|api.?key|credential|password|secret|private.?key)/iu;

/** Secret-free durable identity for one consequential media operation. */
export interface RuntimeMediaActionClaim {
  readonly claimId: RuntimeMediaActionClaimId;
  readonly admissionId: RuntimeMediaActionDigest;
  readonly sessionId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly ownerGeneration: string;
  readonly callerId: string;
  readonly idempotencyKey: string;
  readonly actionKind: RuntimeMediaActionKind;
  /** Exact source identity, never source bytes or credentials. */
  readonly sourceIdentity: string;
  /** Exact adapter/provider or trusted local command identity. */
  readonly adapterIdentity: string;
  /** Stable slot; payload mutation must not create a new effect slot. */
  readonly logicalSendSlot: string;
  readonly intentFingerprint: RuntimeMediaActionDigest;
  readonly payloadFingerprint: RuntimeMediaActionDigest;
  readonly effectIdentity: RuntimeMediaActionDigest;
  readonly status: "claimed";
  readonly claimedAt?: string;
}

declare const runtimeMediaPermitBrand: unique symbol;

/**
 * A process-private capability. The durable owner validates object identity,
 * not copied fields, so a caller cannot forge or duplicate a permit.
 */
export interface RuntimeMediaActionClaimPermit {
  readonly claimId: RuntimeMediaActionClaimId;
  readonly consume: () => void;
  readonly [runtimeMediaPermitBrand]: true;
}

export type RuntimeMediaActionClaimSettlement =
  | { readonly kind: "success"; readonly settledAt?: string }
  | { readonly kind: "unknown"; readonly reason: string; readonly settledAt?: string };

export interface RuntimeMediaActionClaimRecord extends Omit<RuntimeMediaActionClaim, "status"> {
  readonly status: RuntimeMediaActionClaimStatus;
  readonly settledAt?: string;
  readonly outcome?: "success" | "unknown";
  readonly reason?: string;
}

export interface RuntimeMediaActionClaimStore {
  claim(input: RuntimeMediaActionClaim): RuntimeMediaActionClaimPermit;
  settle(permit: RuntimeMediaActionClaimPermit, settlement: RuntimeMediaActionClaimSettlement): void;
  read?(claimId: RuntimeMediaActionClaimId): RuntimeMediaActionClaimRecord | undefined;
}

export interface RuntimeMediaAdmissionReadInput {
  readonly admissionId: RuntimeMediaActionDigest;
  readonly sessionId: string;
  readonly turnId: string;
}

export interface RuntimeMediaActionClaimContext {
  readonly ownerGeneration: string;
  readonly store: RuntimeMediaActionClaimStore;
  /** Must return the complete immutable persisted admission bundle. */
  readonly readAdmission: (
    input: RuntimeMediaAdmissionReadInput,
  ) => EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
}

export function createRuntimeMediaActionClaimContext(input: {
  readonly ownerGeneration: string;
  readonly store: RuntimeMediaActionClaimStore;
  readonly readAdmission: RuntimeMediaActionClaimContext["readAdmission"];
}): RuntimeMediaActionClaimContext {
  return {
    ownerGeneration: input.ownerGeneration,
    store: input.store,
    readAdmission: input.readAdmission,
  };
}

export interface RuntimeMediaActionDispatchInput<T> {
  readonly context: RuntimeMediaActionClaimContext;
  readonly authorityAdmission?: EffectiveAuthorityAdmissionBundle;
  readonly attemptId: string;
  readonly callerId: string;
  readonly idempotencyKey: string;
  readonly actionKind: RuntimeMediaActionKind;
  readonly sourceIdentity: string;
  readonly adapterIdentity: string;
  readonly logicalSendSlot: string;
  /** Secret-free identity projection of the exact adapter payload. */
  readonly payload: unknown;
  readonly abortSignal?: AbortSignal;
  readonly now?: () => string;
  /** Exactly one provider/command call; no retry or fallback is permitted. */
  readonly call: () => Promise<T>;
}

export class RuntimeMediaActionClaimedError extends Error {
  override readonly name = "RuntimeMediaActionClaimedError";
  readonly retryable = false;
  readonly outcome = "unknown" as const;
  readonly claimId: RuntimeMediaActionClaimId;

  constructor(cause: unknown, claimId: RuntimeMediaActionClaimId) {
    super("The media action was claimed; its provider outcome is not safely replayable.", { cause });
    this.claimId = claimId;
  }
}

export class RuntimeMediaActionPreDispatchCancellationError extends Error {
  override readonly name = "RuntimeMediaActionPreDispatchCancellationError";
}

/** Claim, consume immediately before the exact call, and settle once. */
export async function dispatchRuntimeMediaAction<T>(
  input: RuntimeMediaActionDispatchInput<T>,
): Promise<T> {
  const handle = await prepareRuntimeMediaActionClaim(input);
  let consumed = false;
  let result: T;
  try {
    // No awaited or fallible operation is permitted between consume and call.
    handle.permit.consume();
    consumed = true;
    result = await input.call();
  } catch (cause) {
    if (consumed) {
      try {
        settleUnknown(handle.permit, input.context.store, cause);
      } catch (settlementError) {
        throw new RuntimeMediaActionClaimedError(settlementError, handle.claim.claimId);
      }
    }
    throw new RuntimeMediaActionClaimedError(cause, handle.claim.claimId);
  }

  try {
    input.context.store.settle(handle.permit, { kind: "success" });
    return result;
  } catch (settlementError) {
    // The effect already happened; never attempt a contradictory settlement or
    // a second provider call.
    throw new RuntimeMediaActionClaimedError(settlementError, handle.claim.claimId);
  }
}

export async function prepareRuntimeMediaActionClaim(
  input: Omit<RuntimeMediaActionDispatchInput<unknown>, "call">,
): Promise<{ readonly claim: RuntimeMediaActionClaim; readonly permit: RuntimeMediaActionClaimPermit }> {
  if (input.abortSignal?.aborted) {
    throw new RuntimeMediaActionPreDispatchCancellationError(
      "The media action was cancelled before its action claim.",
    );
  }

  const bundle = requirePersistedAuthorityAdmission(input.authorityAdmission);
  const persisted = await input.context.readAdmission({
    admissionId: bundle.admissionId,
    sessionId: bundle.sessionId,
    turnId: bundle.turnId,
  });
  if (!persisted) throw new Error("Media action requires a persisted authority admission read-back.");
  const readBack = assertPersistableAuthorityAdmissionBundle(persisted);
  if (stableStringify(readBack) !== stableStringify(bundle)) {
    throw new Error("Media action admission read-back does not match the committed bundle.");
  }
  // Final cancellation fence immediately before the durable action claim.
  if (input.abortSignal?.aborted) {
    throw new RuntimeMediaActionPreDispatchCancellationError(
      "The media action was cancelled before its action claim.",
    );
  }

  for (const [value, label] of [
    [input.attemptId, "attemptId"],
    [input.callerId, "callerId"],
    [input.idempotencyKey, "idempotencyKey"],
    [input.actionKind, "actionKind"],
    [input.sourceIdentity, "sourceIdentity"],
    [input.adapterIdentity, "adapterIdentity"],
    [input.logicalSendSlot, "logicalSendSlot"],
    [input.context.ownerGeneration, "ownerGeneration"],
  ] as const) requireText(value, label);
  assertSecretFreeText(input.sourceIdentity, "sourceIdentity");
  assertSecretFreeText(input.adapterIdentity, "adapterIdentity");
  assertSecretFreeProjection(input.payload, "payload");

  const intentFingerprint = runtimeMediaActionDigest({
    callerId: input.callerId,
    idempotencyKey: input.idempotencyKey,
    actionKind: input.actionKind,
    sourceIdentity: input.sourceIdentity,
    adapterIdentity: input.adapterIdentity,
    logicalSendSlot: input.logicalSendSlot,
  });
  const payloadFingerprint = runtimeMediaActionDigest(input.payload);
  const effectIdentity = runtimeMediaActionDigest({ intentFingerprint, payloadFingerprint });
  const claim = defineRuntimeMediaActionClaim({
    admissionId: bundle.admissionId,
    sessionId: bundle.sessionId,
    turnId: bundle.turnId,
    attemptId: input.attemptId,
    ownerGeneration: input.context.ownerGeneration,
    callerId: input.callerId,
    idempotencyKey: input.idempotencyKey,
    actionKind: input.actionKind,
    sourceIdentity: input.sourceIdentity,
    adapterIdentity: input.adapterIdentity,
    logicalSendSlot: input.logicalSendSlot,
    intentFingerprint,
    payloadFingerprint,
    effectIdentity,
    claimedAt: input.now?.() ?? new Date().toISOString(),
  });
  return { claim, permit: input.context.store.claim(claim) };
}

export function defineRuntimeMediaActionClaim(
  input: Omit<RuntimeMediaActionClaim, "claimId" | "status">,
): RuntimeMediaActionClaim {
  assertCanonicalSha256Id(input.admissionId, "admissionId");
  assertCanonicalSha256Id(input.intentFingerprint, "intentFingerprint");
  assertCanonicalSha256Id(input.payloadFingerprint, "payloadFingerprint");
  assertCanonicalSha256Id(input.effectIdentity, "effectIdentity");
  for (const [value, label] of [
    [input.sessionId, "sessionId"],
    [input.turnId, "turnId"],
    [input.attemptId, "attemptId"],
    [input.ownerGeneration, "ownerGeneration"],
    [input.callerId, "callerId"],
    [input.idempotencyKey, "idempotencyKey"],
    [input.actionKind, "actionKind"],
    [input.sourceIdentity, "sourceIdentity"],
    [input.adapterIdentity, "adapterIdentity"],
    [input.logicalSendSlot, "logicalSendSlot"],
  ] as const) requireText(value, label);
  assertSecretFreeText(input.sourceIdentity, "sourceIdentity");
  assertSecretFreeText(input.adapterIdentity, "adapterIdentity");
  const identity = {
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    ownerGeneration: input.ownerGeneration,
    callerId: input.callerId,
    idempotencyKey: input.idempotencyKey,
    actionKind: input.actionKind,
    sourceIdentity: input.sourceIdentity,
    adapterIdentity: input.adapterIdentity,
    logicalSendSlot: input.logicalSendSlot,
    intentFingerprint: input.intentFingerprint,
    payloadFingerprint: input.payloadFingerprint,
    effectIdentity: input.effectIdentity,
  } as const;
  return Object.freeze({
    ...input,
    claimId: runtimeMediaActionDigest(identity) as RuntimeMediaActionClaimId,
    status: "claimed" as const,
  });
}

export function runtimeMediaActionDigest(value: unknown): RuntimeMediaActionDigest {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function assertCanonicalSha256Id(
  value: unknown,
  label: string,
): asserts value is RuntimeMediaActionDigest {
  if (typeof value !== "string" || !CANONICAL_SHA256_ID.test(value)) {
    throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
  }
}

function settleUnknown(
  permit: RuntimeMediaActionClaimPermit,
  store: RuntimeMediaActionClaimStore,
  cause: unknown,
): void {
  store.settle(permit, {
    kind: "unknown",
    reason: cause instanceof Error ? cause.message : String(cause),
  });
}

function requirePersistedAuthorityAdmission(
  authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined,
): EffectiveAuthorityAdmissionBundle {
  if (!authorityAdmission) throw new Error("Media action requires the complete authority admission bundle.");
  return assertPersistableAuthorityAdmissionBundle(authorityAdmission);
}

function assertSecretFreeProjection(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertSecretFreeProjection(item, label);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_SHAPED_KEY.test(key)) {
      throw new TypeError(`${label} must be a secret-free projection; '${key}' is credential-shaped.`);
    }
    assertSecretFreeProjection(nested, label);
  }
}

function assertSecretFreeText(value: string, label: string): void {
  if (SECRET_SHAPED_KEY.test(value)) throw new TypeError(`${label} must be secret-free.`);
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} is required.`);
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
