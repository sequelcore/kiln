import { createHmac } from "node:crypto";
import type { ProviderModelRouteIdentity, ModelTurnResult } from "@kilnai/core";
import {
  abandonModelGatewayReplayClaim,
  commitModelGatewayReplayClaim,
  completeModelGatewayReplayClaim,
  createModelGatewayReplayClaim,
  settleModelGatewayReplayClaimUnknown,
  type ModelGatewayReplayClaim,
  type ModelGatewayReplayFence,
  type ModelGatewayReplayKey,
} from "./replay-claim.js";

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
  | { readonly kind: "dispatch"; readonly key: ModelGatewayReplayKey; readonly fence: ModelGatewayReplayFence }
  | { readonly kind: "join-inflight"; readonly retryAfterSeconds: number }
  | { readonly kind: "replay-completed"; readonly value: ModelGatewayReplayCompletedValue }
  | { readonly kind: "committed-unknown" };

export interface ModelGatewayReplayGuard {
  fingerprint(input: ModelGatewayReplayFingerprintInput): ModelGatewayReplayKey;
  claim(key: ModelGatewayReplayKey): ModelGatewayReplayDecision;
  markCommitted(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void;
  settleUnknown(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void;
  complete(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence, value: ModelGatewayReplayCompletedValue): void;
  abandon(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void;
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
  expiresAt?: number;
}

/**
 * Process-local replay protection. It is deliberately neither durable nor distributed:
 * restart loses every claim, and claimed/completed/terminal-unknown states expire after TTL.
 * Active committed work does not expire while provider invocation is unresolved. A crash around
 * provider dispatch still cannot be made safe: redispatch is possible after restart, and after TTL
 * for terminal states. Only a durable ledger can extend that guarantee.
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
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) this.#entries.delete(candidate);
    }
    const current = this.#entries.get(key);
    if (current?.claim.phase === "claimed") {
      return { kind: "join-inflight", retryAfterSeconds: Math.max(1, Math.min(60, Math.ceil((current.expiresAt! - now) / 1_000))) };
    }
    if (current?.claim.phase === "completed") return { kind: "replay-completed", value: clone(current.claim.value) };
    if (current?.claim.phase === "committed-unknown") return { kind: "committed-unknown" };
    if (current?.claim.phase === "committed") return { kind: "committed-unknown" };
    if (this.#entries.size >= this.#maxEntries) throw new Error("Replay guard capacity is exhausted.");
    const fence = this.#createFence() as ModelGatewayReplayFence;
    this.#entries.set(key, { claim: createModelGatewayReplayClaim(fence), expiresAt: now + this.#ttlMs });
    return { kind: "dispatch", key, fence };
  }

  markCommitted(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    const entry = this.#require(key);
    entry.claim = commitModelGatewayReplayClaim(entry.claim, fence);
    entry.expiresAt = undefined;
  }

  settleUnknown(key: ModelGatewayReplayKey, fence: ModelGatewayReplayFence): void {
    const entry = this.#require(key);
    entry.claim = settleModelGatewayReplayClaimUnknown(entry.claim, fence);
    entry.expiresAt = this.#now() + this.#ttlMs;
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
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      throw new Error("Replay claim is unavailable.");
    }
    return entry;
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
