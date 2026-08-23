import { createHash, randomUUID } from "node:crypto";
import type { ManagedAgentInvocationRequest } from "@kilnai/core";
import type { EffectiveAuthorityAdmissionBundle } from "../../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../../session/authority-admission-evidence.js";

export type ManagedExternalInvocationClaimId = `sha256:${string}`;
export type ManagedExternalInvocationDigest = `sha256:${string}`;
export type ManagedExternalInvocationActionKind =
  | "cli-run"
  | "remote-invoke"
  | "remote-cancel";
export type ManagedExternalInvocationClaimStatus =
  | "claimed"
  | "settled"
  | "unknown"
  | "interrupted";

const CANONICAL_SHA256_ID = /^sha256:[a-f0-9]{64}$/u;

/**
 * Secret-free identity for one externally hosted managed action.  The
 * invocation itself is the one external round, so round zero is explicit and
 * the durable owner reserves one slot by admission + attempt + round + kind.
 */
export interface ManagedExternalInvocationActionClaim {
  readonly claimId: ManagedExternalInvocationClaimId;
  readonly admissionId: ManagedExternalInvocationDigest;
  readonly sessionId: string;
  readonly turnId: string;
  readonly invocationId: string;
  readonly attemptId: string;
  readonly round: 0;
  readonly ownerGeneration: string;
  readonly routeAck: string;
  readonly intentFingerprint: ManagedExternalInvocationDigest;
  readonly effectIdentity: ManagedExternalInvocationDigest;
  readonly effectKind: ManagedExternalInvocationActionKind;
  readonly status: "claimed";
  readonly claimedAt?: string;
}

const managedExternalInvocationPermitBrand: unique symbol = Symbol("managed-external-invocation-permit");

/** Opaque one-use capability returned only by the durable action owner. */
export interface ManagedExternalInvocationActionClaimPermit {
  readonly permitId: string;
  readonly claimId: ManagedExternalInvocationClaimId;
  readonly consume: () => void;
  readonly [managedExternalInvocationPermitBrand]: true;
}

export type ManagedExternalInvocationClaimSettlement =
  | { readonly kind: "success"; readonly settledAt?: string }
  | { readonly kind: "unknown"; readonly reason: string; readonly settledAt?: string }
  | { readonly kind: "interrupted"; readonly reason: string; readonly settledAt?: string };

export interface ManagedExternalInvocationActionClaimStore {
  /** Atomically reserves one immutable effect slot and returns its permit. */
  claim(input: ManagedExternalInvocationActionClaim): ManagedExternalInvocationActionClaimPermit;
  /** Consumes the permit and durably records the terminal action evidence. */
  settle(
    permit: ManagedExternalInvocationActionClaimPermit,
    settlement: ManagedExternalInvocationClaimSettlement,
  ): void;
  /** Releases the durable workload-owned claim store at composition shutdown. */
  close(): void;
}

export interface ManagedExternalInvocationAdmissionReadInput {
  readonly admissionId: ManagedExternalInvocationDigest;
  readonly sessionId: string;
  readonly turnId: string;
}

export interface ManagedExternalInvocationActionClaimContext {
  readonly ownerGeneration: string;
  readonly store: ManagedExternalInvocationActionClaimStore;
  /** Must return the complete immutable persisted bundle, not a facet. */
  readonly readAdmission: (
    input: ManagedExternalInvocationAdmissionReadInput,
  ) => EffectiveAuthorityAdmissionBundle | undefined | Promise<EffectiveAuthorityAdmissionBundle | undefined>;
}

export class ManagedExternalInvocationCommittedError extends Error {
  override readonly name = "ManagedExternalInvocationCommittedError";
  readonly retryable = false;
  readonly claimId: ManagedExternalInvocationClaimId;
  readonly outcome: "unknown" | "interrupted";

  constructor(
    cause: unknown,
    claimId: ManagedExternalInvocationClaimId,
    outcome: "unknown" | "interrupted" = "unknown",
  ) {
    super("The managed external action was claimed; its provider outcome is not safely replayable.", { cause });
    this.claimId = claimId;
    this.outcome = outcome;
  }
}

export class ManagedExternalInvocationPreDispatchCancellationError extends Error {
  override readonly name = "ManagedExternalInvocationPreDispatchCancellationError";
}

export interface ManagedExternalInvocationClaimHandle {
  readonly claim: ManagedExternalInvocationActionClaim;
  readonly permit: ManagedExternalInvocationActionClaimPermit;
  /** True before entering the durable settlement call; settlement is never attempted twice. */
  settlementAttempted: boolean;
  settled: boolean;
}

const issuedManagedExternalInvocationPermits = new WeakSet<object>();

export async function prepareManagedExternalInvocationActionClaim(input: {
  readonly context: ManagedExternalInvocationActionClaimContext;
  readonly request: ManagedAgentInvocationRequest;
  readonly admission: { readonly capabilitySnapshot: { readonly routeId: string } };
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined;
  readonly effectKind: ManagedExternalInvocationActionKind;
  readonly effect: unknown;
  readonly abortSignal?: AbortSignal;
  readonly now?: () => string;
}): Promise<ManagedExternalInvocationClaimHandle> {
  if (input.abortSignal?.aborted) {
    throw new ManagedExternalInvocationPreDispatchCancellationError(
      "The managed external action was cancelled before its action claim.",
    );
  }
  const bundle = requirePersistedAuthorityAdmission(input);
  const persisted = await input.context.readAdmission({
    admissionId: bundle.admissionId,
    sessionId: bundle.sessionId,
    turnId: bundle.turnId,
  });
  if (!persisted) {
    throw new Error("Managed external invocation requires a persisted authority admission read-back.");
  }
  const readBack = assertPersistableAuthorityAdmissionBundle(persisted);
  if (stableStringify(readBack) !== stableStringify(bundle)) {
    throw new Error("Managed external invocation admission read-back does not match the committed bundle.");
  }
  if (input.abortSignal?.aborted) {
    throw new ManagedExternalInvocationPreDispatchCancellationError(
      "The managed external action was cancelled before its action claim.",
    );
  }
  const claim = defineManagedExternalInvocationActionClaim({
    admissionId: bundle.admissionId,
    sessionId: bundle.sessionId,
    turnId: bundle.turnId,
    invocationId: input.request.invocationId,
    attemptId: input.request.invocationId,
    round: 0,
    ownerGeneration: input.context.ownerGeneration,
    routeAck: `${input.admission.capabilitySnapshot.routeId}:${input.request.providerRoute.providerId}:${input.request.providerRoute.surface}:${input.request.providerRoute.model ?? ""}`,
    intentFingerprint: managedExternalInvocationDigest({
      effectKind: input.effectKind,
      request: input.request,
    }),
    effectIdentity: managedExternalInvocationDigest({
      effectKind: input.effectKind,
      routeId: input.admission.capabilitySnapshot.routeId,
      request: input.request,
      effect: input.effect,
    }),
    effectKind: input.effectKind,
    claimedAt: input.now?.() ?? new Date().toISOString(),
  });
  const permit = input.context.store.claim(claim);
  return { claim, permit, settlementAttempted: false, settled: false };
}

export function defineManagedExternalInvocationActionClaim(input: Omit<
  ManagedExternalInvocationActionClaim,
  "claimId" | "status"
>): ManagedExternalInvocationActionClaim {
  assertCanonicalSha256Id(input.admissionId, "admissionId");
  assertCanonicalSha256Id(input.intentFingerprint, "intentFingerprint");
  assertCanonicalSha256Id(input.effectIdentity, "effectIdentity");
  requireText(input.sessionId, "sessionId");
  requireText(input.turnId, "turnId");
  requireText(input.invocationId, "invocationId");
  requireText(input.attemptId, "attemptId");
  requireText(input.ownerGeneration, "ownerGeneration");
  requireText(input.routeAck, "routeAck");
  const identity = {
    admissionId: input.admissionId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    invocationId: input.invocationId,
    attemptId: input.attemptId,
    round: input.round,
    ownerGeneration: input.ownerGeneration,
    routeAck: input.routeAck,
    intentFingerprint: input.intentFingerprint,
    effectIdentity: input.effectIdentity,
    effectKind: input.effectKind,
  } as const;
  return Object.freeze({
    ...input,
    claimId: managedExternalInvocationDigest(identity) as ManagedExternalInvocationClaimId,
    status: "claimed" as const,
  });
}

export function validateManagedExternalInvocationActionClaim(
  input: unknown,
): ManagedExternalInvocationActionClaim {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new TypeError("Managed external invocation action claim must be an object.");
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.round !== 0
    || (candidate.effectKind !== "cli-run" && candidate.effectKind !== "remote-invoke" && candidate.effectKind !== "remote-cancel")
    || candidate.status !== "claimed") {
    throw new TypeError("Managed external invocation action claim is invalid.");
  }
  const claim = defineManagedExternalInvocationActionClaim({
    admissionId: requireDigest(candidate.admissionId, "admissionId"),
    sessionId: requireClaimText(candidate.sessionId, "sessionId"),
    turnId: requireClaimText(candidate.turnId, "turnId"),
    invocationId: requireClaimText(candidate.invocationId, "invocationId"),
    attemptId: requireClaimText(candidate.attemptId, "attemptId"),
    round: 0,
    ownerGeneration: requireClaimText(candidate.ownerGeneration, "ownerGeneration"),
    routeAck: requireClaimText(candidate.routeAck, "routeAck"),
    intentFingerprint: requireDigest(candidate.intentFingerprint, "intentFingerprint"),
    effectIdentity: requireDigest(candidate.effectIdentity, "effectIdentity"),
    effectKind: candidate.effectKind,
    ...(candidate.claimedAt === undefined
      ? {}
      : { claimedAt: requireClaimText(candidate.claimedAt, "claimedAt") }),
  });
  if (candidate.claimId !== claim.claimId) {
    throw new TypeError("Managed external invocation action claim identity does not match its evidence.");
  }
  return claim;
}

export function managedExternalInvocationDigest(value: unknown): ManagedExternalInvocationDigest {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}

export function assertCanonicalSha256Id(value: unknown, label: string): asserts value is ManagedExternalInvocationDigest {
  if (typeof value !== "string" || !CANONICAL_SHA256_ID.test(value)) {
    throw new TypeError(`${label} must be a canonical sha256:<64 lowercase hex> id.`);
  }
}

export function requirePersistedAuthorityAdmission(input: {
  readonly authorityAdmission: EffectiveAuthorityAdmissionBundle | undefined;
  readonly request: ManagedAgentInvocationRequest;
}): EffectiveAuthorityAdmissionBundle {
  if (input.authorityAdmission === undefined) {
    throw new Error("Managed external invocation requires the complete child authority admission bundle.");
  }
  const bundle = assertPersistableAuthorityAdmissionBundle(input.authorityAdmission);
  if (bundle.sessionId !== input.request.parentSessionId || bundle.turnId !== input.request.parentTurnId) {
    throw new Error("Managed external invocation authority admission does not match its parent turn.");
  }
  return bundle;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim().length === 0) throw new TypeError(`${label} is required.`);
}

function requireClaimText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value !== value.trim()) {
    throw new TypeError(`${label} is required.`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): ManagedExternalInvocationDigest {
  assertCanonicalSha256Id(value, label);
  return value;
}

export function createManagedExternalInvocationPermit(
  claimId: ManagedExternalInvocationClaimId,
  permitId = `managed-external:${randomUUID()}`,
): ManagedExternalInvocationActionClaimPermit {
  let consumed = false;
  const permit: ManagedExternalInvocationActionClaimPermit = {
    permitId,
    claimId,
    consume: () => {
      if (consumed) throw new Error("Managed external invocation action permit has already been consumed.");
      consumed = true;
    },
    [managedExternalInvocationPermitBrand]: true,
  };
  issuedManagedExternalInvocationPermits.add(permit);
  return permit;
}

/** Runtime-only identity check; DTO copies are not issued permits. */
export function isManagedExternalInvocationPermit(
  value: unknown,
): value is ManagedExternalInvocationActionClaimPermit {
  return typeof value === "object" && value !== null && issuedManagedExternalInvocationPermits.has(value);
}
