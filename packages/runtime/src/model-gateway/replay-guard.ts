import { createHmac, randomUUID } from "node:crypto";
import type { ProviderModelRouteIdentity, ModelTurnResult } from "@kilnai/core";
import type { EffectiveAuthorityAdmissionBundle } from "../session/effective-authority-admission-bundle.js";
import { assertPersistableAuthorityAdmissionBundle } from "../session/authority-admission-evidence.js";
import {
  abandonModelGatewayReplayClaim,
  claimModelGatewayReplayAction,
  completeModelGatewayReplayClaim,
  createModelGatewayReplayClaim,
  persistModelGatewayReplayAdmission,
  settleModelGatewayReplayClaimUnknown,
  type ModelGatewayReplayClaim,
  type ModelGatewayReplayFence,
  type ModelGatewayReplayKey,
} from "./replay-claim.js";
import {
  createGovernedOneRoundDispatchPermit,
  type GovernedOneRoundDispatchPermit,
} from "../execution-kernel/dispatch-permit.js";

export const MODEL_GATEWAY_REPLAY_FINGERPRINT_VERSION = "kiln-replay-v1";

export interface ModelGatewayReplayFingerprintInput {
  readonly rawBody: string;
  readonly ingress: string;
  readonly tenantId: string;
  readonly applicationId: string;
  readonly callerId: string;
  readonly sessionId: string;
  readonly turnId: string;
  readonly route: ProviderModelRouteIdentity;
  readonly toolExecutionMode: string;
  readonly affinityKey?: string;
}

export interface ModelGatewayReplayCompletedValue {
  readonly result: ModelTurnResult;
  readonly responseId: string;
}

export type ModelGatewayReplayDecision =
  | { readonly kind: "dispatch"; readonly key: ModelGatewayReplayKey; readonly fence: ModelGatewayReplayFence; readonly attemptId: string }
  | { readonly kind: "join-inflight"; readonly retryAfterSeconds: number }
  | { readonly kind: "replay-completed"; readonly value: ModelGatewayReplayCompletedValue }
  | { readonly kind: "committed-unknown" };

export interface ModelGatewayReplayGuard {
  fingerprint(input: ModelGatewayReplayFingerprintInput): ModelGatewayReplayKey;
  claim(key: ModelGatewayReplayKey): ModelGatewayReplayDecision;
  /** Atomically persists and reads back the complete, immutable admission bundle. */
  persistAdmission(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, bundle: EffectiveAuthorityAdmissionBundle): ModelGatewayAdmissionReceipt;
  /** Fences the exact provider effect and returns the one-use dispatch permit. */
  claimAction(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, input: ModelGatewayReplayActionInput): GovernedOneRoundDispatchPermit;
  settleUnknown(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void;
  complete(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, value: ModelGatewayReplayCompletedValue): void;
  abandon(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void;
}

export interface ModelGatewayAdmissionReceipt {
  readonly attemptId: string;
  readonly admissionId: `sha256:${string}`;
  readonly bundle: EffectiveAuthorityAdmissionBundle;
}

export interface ModelGatewayReplayActionInput {
  readonly admissionId: `sha256:${string}`;
  readonly effectIdentity: string;
}

export interface InMemoryModelGatewayReplayGuardOptions {
  readonly hmacKey: string | Uint8Array;
  readonly now?: () => number;
  readonly ttlMs?: number;
  readonly createFence?: () => string;
  readonly maxEntries?: number;
}

interface Entry {
  claim: ModelGatewayReplayClaim<ModelGatewayReplayCompletedValue>;
  /** Pre-action claims and encrypted payloads expire. Tombstones do not. */
  expiresAt?: number;
  /** Test-only readback state; replay expiry never owns admission evidence. */
  admissionBundle?: EffectiveAuthorityAdmissionBundle;
}

/**
 * Test-only process-local replay protection. It is deliberately neither durable nor distributed:
 * restart loses every claim. Pre-action claims (including admitted claims) and
 * completed payloads use TTL, while committed and committed-unknown tombstones
 * remain non-redispatchable for the lifetime of this process.
 * Production ingress uses the durable SQLite implementation.
 */
export class InMemoryModelGatewayReplayGuard implements ModelGatewayReplayGuard {
  readonly #entries = new Map<ModelGatewayReplayKey, Entry>();
  readonly #key: Uint8Array;
  readonly #now: () => number;
  readonly #ttlMs: number;
  readonly #createFence: () => string;
  readonly #maxEntries: number;
  #nextFence = 0;

  constructor(options: InMemoryModelGatewayReplayGuardOptions) {
    if (typeof options.hmacKey !== "string" && !(options.hmacKey instanceof Uint8Array)) throw new TypeError("Replay HMAC key must be a string or Uint8Array.");
    const key = typeof options.hmacKey === "string" ? Buffer.from(options.hmacKey, "utf8") : Buffer.from(options.hmacKey);
    if (key.byteLength < 32) throw new TypeError("Replay HMAC key must contain at least 32 bytes.");
    const ttlMs = options.ttlMs ?? 5 * 60_000;
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) throw new TypeError("Replay TTL must be a positive integer.");
    const maxEntries = options.maxEntries ?? 10_000;
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0 || maxEntries > 1_000_000) {
      throw new TypeError("Replay maxEntries must be an integer between 1 and 1000000.");
    }
    this.#key = key;
    this.#now = options.now ?? Date.now;
    this.#ttlMs = ttlMs;
    this.#createFence = options.createFence ?? (() => `f-${++this.#nextFence}`);
    this.#maxEntries = maxEntries;
  }

  fingerprint(input: ModelGatewayReplayFingerprintInput): ModelGatewayReplayKey {
    const hmac = createHmac("sha256", this.#key);
    for (const value of [
      MODEL_GATEWAY_REPLAY_FINGERPRINT_VERSION,
      input.ingress,
      input.tenantId,
      input.applicationId,
      input.callerId,
      input.sessionId,
      input.turnId,
      input.route.providerId,
      input.route.providerModelId,
      input.route.scope,
      input.toolExecutionMode,
      input.affinityKey ?? "",
      input.rawBody,
    ]) {
      const bytes = Buffer.from(value, "utf8");
      hmac.update(String(bytes.byteLength));
      hmac.update(":");
      hmac.update(bytes);
      hmac.update(";");
    }
    return hmac.digest("hex") as ModelGatewayReplayKey;
  }

  claim(key: ModelGatewayReplayKey): ModelGatewayReplayDecision {
    const now = this.#now();
    for (const [candidate, entry] of this.#entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now && (entry.claim.phase === "claimed" || entry.claim.phase === "admitted")) this.#entries.delete(candidate);
    }
    const current = this.#entries.get(key);
    if (current?.claim.phase === "claimed") {
      return { kind: "join-inflight", retryAfterSeconds: Math.max(1, Math.min(60, Math.ceil((current.expiresAt! - now) / 1_000))) };
    }
    if (current?.claim.phase === "completed") {
      if (current.expiresAt !== undefined && current.expiresAt <= now) return { kind: "committed-unknown" };
      return { kind: "replay-completed", value: clone(current.claim.value) };
    }
    if (current?.claim.phase === "committed-unknown") return { kind: "committed-unknown" };
    if (current?.claim.phase === "committed") return { kind: "committed-unknown" };
    let preActionEntries = 0;
    for (const entry of this.#entries.values()) {
      if (entry.claim.phase === "claimed" || entry.claim.phase === "admitted") preActionEntries += 1;
    }
    if (preActionEntries >= this.#maxEntries) throw new Error("Replay guard capacity is exhausted.");
    const fence = this.#createFence() as ModelGatewayReplayFence;
    const attemptId = `attempt-${randomUUID()}`;
    this.#entries.set(key, { claim: createModelGatewayReplayClaim(fence, attemptId), expiresAt: now + this.#ttlMs });
    return { kind: "dispatch", key, fence, attemptId };
  }

  persistAdmission(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, bundle: EffectiveAuthorityAdmissionBundle): ModelGatewayAdmissionReceipt {
    const entry = this.#require(key);
    const admitted = assertPersistableAuthorityAdmissionBundle(bundle);
    entry.claim = persistModelGatewayReplayAdmission(entry.claim, fence, admitted.admissionId);
    entry.expiresAt = this.#now() + this.#ttlMs;
    // The canonical bundle is already deeply frozen; retain that exact
    // immutable value so test readback has the same contract as SQLite.
    entry.admissionBundle = admitted;
    return { attemptId: entry.claim.attemptId, admissionId: admitted.admissionId, bundle: admitted };
  }

  claimAction(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, input: ModelGatewayReplayActionInput): GovernedOneRoundDispatchPermit {
    const entry = this.#require(key);
    entry.claim = claimModelGatewayReplayAction(entry.claim, fence, input);
    return createGovernedOneRoundDispatchPermit();
  }

  settleUnknown(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    const entry = this.#require(key);
    entry.claim = settleModelGatewayReplayClaimUnknown(entry.claim, fence);
    entry.expiresAt = undefined;
  }

  complete(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, value: ModelGatewayReplayCompletedValue): void {
    const entry = this.#require(key);
    entry.claim = completeModelGatewayReplayClaim(entry.claim, fence, clone(value));
    entry.expiresAt = this.#now() + this.#ttlMs;
  }

  abandon(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    const entry = this.#require(key);
    abandonModelGatewayReplayClaim(entry.claim, fence);
    this.#entries.delete(key);
  }

  #require(key: ModelGatewayReplayKey): Entry {
    const entry = this.#entries.get(key);
    if (entry === undefined) throw new Error("Replay claim is unavailable.");
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.#now() && (entry.claim.phase === "claimed" || entry.claim.phase === "admitted")) {
      this.#entries.delete(key);
      throw new Error("Replay claim is unavailable.");
    }
    return entry;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
