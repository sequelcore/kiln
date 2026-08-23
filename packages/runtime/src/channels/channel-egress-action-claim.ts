import { createHash } from "node:crypto";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";

export type ChannelEgressActionClaimId = `sha256:${string}`;
export type ChannelEgressActionDigest = `sha256:${string}`;
export type ChannelEgressClaimStatus = "claimed" | "settled" | "unknown";

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;
const SECRET_SHAPED_KEY = /(?:access.?token|api.?key|credential|password|secret|private.?key)/iu;

/** Secret-free durable identity for one irreversible channel send. */
export interface ChannelEgressActionClaim {
  readonly claimId: ChannelEgressActionClaimId;
  readonly admissionId: ChannelEgressActionDigest;
  readonly sessionId: string;
  readonly turnId: string;
  readonly attemptId: string;
  readonly ownerGeneration: string;
  readonly callerId: string;
  readonly idempotencyKey: string;
  readonly channel: string;
  /** Exact logical destination identity; credentials must never be included. */
  readonly destination: string;
  /** Exact adapter identity; credentials must never be included. */
  readonly adapterIdentity: string;
  /** Stable send slot; effect payload mutation must not create a new slot. */
  readonly logicalSendSlot: string;
  readonly intentFingerprint: ChannelEgressActionDigest;
  readonly payloadFingerprint: ChannelEgressActionDigest;
  readonly effectIdentity: ChannelEgressActionDigest;
  readonly status: "claimed";
  readonly claimedAt?: string;
}

const channelEgressPermitBrand: unique symbol = Symbol("channel-egress-action-permit");

/** Opaque capability returned by the durable channel egress owner. */
export interface ChannelEgressActionClaimPermit {
  readonly permitId: string;
  readonly claimId: ChannelEgressActionClaimId;
  readonly consume: () => void;
  readonly [channelEgressPermitBrand]: true;
}

export type ChannelEgressActionClaimSettlement =
  | { readonly kind: "success"; readonly settledAt?: string }
  | { readonly kind: "unknown"; readonly reason: string; readonly settledAt?: string };

export interface ChannelEgressActionClaimRecord extends Omit<ChannelEgressActionClaim, "status"> {
  readonly status: ChannelEgressClaimStatus;
  readonly settledAt?: string;
  readonly outcome?: "success" | "unknown";
  readonly reason?: string;
}

export interface ChannelEgressActionClaimStore {
  claim(input: ChannelEgressActionClaim): ChannelEgressActionClaimPermit;
  settle(permit: ChannelEgressActionClaimPermit, settlement: ChannelEgressActionClaimSettlement): void;
  read?(claimId: ChannelEgressActionClaimId): ChannelEgressActionClaimRecord | undefined;
}

export interface ChannelEgressAdmissionReadInput {
  readonly admissionId: ChannelEgressActionDigest;
  readonly sessionId: string;
  readonly turnId: string;
}

export interface ChannelEgressActionClaimContext {
  readonly ownerGeneration: string;
  readonly store: ChannelEgressActionClaimStore;
  /** Must return the complete immutable persisted EffectiveAuthorityAdmissionBundle. */
  readonly readAdmission: (
    input: ChannelEgressAdmissionReadInput,
  ) => EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
}

export interface ChannelEgressDispatchInput<T> {
  readonly context: ChannelEgressActionClaimContext;
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined;
  readonly attemptId: string;
  readonly callerId: string;
  readonly idempotencyKey: string;
  readonly logicalSendSlot: string;
  readonly channel: string;
  readonly destination: string;
  readonly adapterIdentity: string;
  /** Secret-free payload projection used only for durable identity. */
  readonly payload: unknown;
  readonly abortSignal?: AbortSignal;
  readonly now?: () => string;
  /** Must invoke exactly one provider/transport call and must not retry or fall back. */
  readonly send: () => Promise<T>;
}

export class ChannelEgressClaimedError extends Error {
  override readonly name = "ChannelEgressClaimedError";
  readonly retryable = false;
  readonly claimId: ChannelEgressActionClaimId;
  readonly outcome = "unknown" as const;

  constructor(cause: unknown, claimId: ChannelEgressActionClaimId) {
    super("The channel egress action was claimed; its provider outcome is not safely replayable.", { cause });
    this.claimId = claimId;
  }
}

export class ChannelEgressPreDispatchCancellationError extends Error {
  override readonly name = "ChannelEgressPreDispatchCancellationError";
}

/** Claim, invoke exactly once, and settle the provider outcome. */
export async function dispatchChannelEgress<T>(input: ChannelEgressDispatchInput<T>): Promise<T> {
  const handle = await prepareChannelEgressActionClaim(input);

  let consumed = false;
  let result: T;
  try {
    // Consume the opaque capability immediately before the one exact adapter
    // call. No awaited or fallible work is permitted between these operations.
    handle.permit.consume();
    consumed = true;
    result = await input.send();
  } catch (cause) {
    if (consumed) {
      try {
        settleUnknown(handle, input.context.store, cause);
      } catch (settlementError) {
        throw new ChannelEgressClaimedError(settlementError, handle.claim.claimId);
      }
    }
    throw new ChannelEgressClaimedError(cause, handle.claim.claimId);
  }

  try {
    input.context.store.settle(handle.permit, { kind: "success" });
    return result;
  } catch (settlementError) {
    // The provider has already been called. A settlement failure cannot be
    // repaired with a contradictory second settlement or another send.
    throw new ChannelEgressClaimedError(settlementError, handle.claim.claimId);
  }
}

export async function prepareChannelEgressActionClaim(input: Omit<ChannelEgressDispatchInput<unknown>, "send">): Promise<{
  readonly claim: ChannelEgressActionClaim;
  readonly permit: ChannelEgressActionClaimPermit;
}> {
  if (input.abortSignal?.aborted) {
    throw new ChannelEgressPreDispatchCancellationError("The channel egress action was cancelled before its action claim.");
  }
  const bundle = requirePersistedAuthorityAdmission(input.authorityAdmission);
  const persisted = await input.context.readAdmission({
    admissionId: bundle.admissionId,
    sessionId: bundle.sessionId,
    turnId: bundle.turnId,
  });
  if (!persisted) throw new Error("Channel egress requires a persisted authority admission read-back.");
  const readBack = assertPersistableAuthorityAdmissionBundle(persisted);
  if (stableStringify(readBack) !== stableStringify(bundle)) {
    throw new Error("Channel egress admission read-back does not match the committed bundle.");
  }
  if (input.abortSignal?.aborted) {
    throw new ChannelEgressPreDispatchCancellationError("The channel egress action was cancelled before its action claim.");
  }

  for (const [value, label] of [
    [input.attemptId, "attemptId"],
    [input.callerId, "callerId"],
    [input.idempotencyKey, "idempotencyKey"],
    [input.logicalSendSlot, "logicalSendSlot"],
    [input.channel, "channel"],
    [input.destination, "destination"],
    [input.adapterIdentity, "adapterIdentity"],
    [input.context.ownerGeneration, "ownerGeneration"],
  ] as const) requireText(value, label);
  assertSecretFreeProjection(input.payload, "payload");

  const payloadFingerprint = channelEgressDigest(input.payload);
  const intentFingerprint = channelEgressDigest({
    callerId: input.callerId,
    idempotencyKey: input.idempotencyKey,
    logicalSendSlot: input.logicalSendSlot,
    channel: input.channel,
    destination: input.destination,
    adapterIdentity: input.adapterIdentity,
  });
  const effectIdentity = channelEgressDigest({ intentFingerprint, payloadFingerprint });
  const claim = defineChannelEgressActionClaim({
    admissionId: bundle.admissionId,
    sessionId: bundle.sessionId,
    turnId: bundle.turnId,
    attemptId: input.attemptId,
    ownerGeneration: input.context.ownerGeneration,
    callerId: input.callerId,
    idempotencyKey: input.idempotencyKey,
    channel: input.channel,
    destination: input.destination,
    adapterIdentity: input.adapterIdentity,
    logicalSendSlot: input.logicalSendSlot,
    intentFingerprint,
    payloadFingerprint,
    effectIdentity,
    claimedAt: input.now?.() ?? new Date().toISOString(),
  });
  return { claim, permit: input.context.store.claim(claim) };
}

export function defineChannelEgressActionClaim(input: Omit<ChannelEgressActionClaim, "claimId" | "status">): ChannelEgressActionClaim {
  assertCanonicalSha256Id(input.admissionId, "admissionId");
  assertCanonicalSha256Id(input.intentFingerprint, "intentFingerprint");
  assertCanonicalSha256Id(input.payloadFingerprint, "payloadFingerprint");
  assertCanonicalSha256Id(input.effectIdentity, "effectIdentity");
  for (const [value, label] of [
    [input.sessionId, "sessionId"], [input.turnId, "turnId"], [input.attemptId, "attemptId"],
    [input.ownerGeneration, "ownerGeneration"], [input.callerId, "callerId"], [input.idempotencyKey, "idempotencyKey"],
    [input.channel, "channel"], [input.destination, "destination"], [input.adapterIdentity, "adapterIdentity"],
    [input.logicalSendSlot, "logicalSendSlot"],
  ] as const) requireText(value, label);
  assertSecretFreeText(input.destination, "destination");
  assertSecretFreeText(input.adapterIdentity, "adapterIdentity");
  const identity = {
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    attemptId: input.attemptId,
    ownerGeneration: input.ownerGeneration,
    callerId: input.callerId,
    idempotencyKey: input.idempotencyKey,
    channel: input.channel,
    destination: input.destination,
    adapterIdentity: input.adapterIdentity,
    logicalSendSlot: input.logicalSendSlot,
    intentFingerprint: input.intentFingerprint,
    payloadFingerprint: input.payloadFingerprint,
    effectIdentity: input.effectIdentity,
  } as const;
  return Object.freeze({
    ...input,
    claimId: channelEgressDigest(identity) as ChannelEgressActionClaimId,
    status: "claimed" as const,
  });
}

export function channelEgressDigest(value: unknown): ChannelEgressActionDigest {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function assertCanonicalSha256Id(value: unknown, label: string): asserts value is ChannelEgressActionDigest {
  if (typeof value !== "string" || !CANONICAL_SHA256_ID.test(value)) {
    throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
  }
}

function settleUnknown(
  handle: { readonly claim: ChannelEgressActionClaim; readonly permit: ChannelEgressActionClaimPermit },
  store: ChannelEgressActionClaimStore,
  cause: unknown,
): void {
  store.settle(handle.permit, {
    kind: "unknown",
    reason: cause instanceof Error ? cause.message : String(cause),
  });
}

function requirePersistedAuthorityAdmission(
  authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined,
): EffectiveAuthorityAdmissionBundle {
  if (!authorityAdmission) throw new Error("Channel egress requires the complete authority admission bundle.");
  return assertPersistableAuthorityAdmissionBundle(authorityAdmission);
}

function assertSecretFreeProjection(value: unknown, label: string): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertSecretFreeProjection(item, label);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_SHAPED_KEY.test(key)) throw new TypeError(`${label} must be a secret-free projection; '${key}' is credential-shaped.`);
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
