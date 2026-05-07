import {
  DEFAULT_COOLDOWN_POLICY,
  type CooldownPolicy,
} from "./credential-pool/cooldown.js";
import type { CredentialOutcome } from "./credential-pool/outcome.js";
import { getResetAt, isRetryable } from "./credential-pool/outcome.js";

export interface ProviderModelRouteKey {
  readonly providerId: string;
  readonly modelId: string;
}

export interface ProviderModelRouteHealthRecord {
  readonly providerId: string;
  readonly modelId: string;
  readonly requestCount: number;
  readonly lastSuccess: number | null;
  readonly lastFailure: number | null;
  readonly cooldownUntil: number | null;
  readonly lastOutcome: CredentialOutcome | null;
  readonly lastError: string | null;
  readonly updatedAt: string;
}

export interface ProviderModelRouteHealthDecision {
  readonly healthy: boolean;
  readonly reason?: string;
  readonly cooldownUntil?: number;
}

export function createProviderModelRouteHealthRecord(input: {
  readonly providerId: string;
  readonly modelId: string;
  readonly previous?: ProviderModelRouteHealthRecord;
  readonly outcome: CredentialOutcome;
  readonly errorMessage?: string;
  readonly now?: number;
}): ProviderModelRouteHealthRecord {
  const now = input.now ?? Date.now();
  const cooldownUntil = isRetryable(input.outcome)
    ? computeRouteCooldownUntil(DEFAULT_COOLDOWN_POLICY, getResetAt(input.outcome), now)
    : null;

  return {
    providerId: input.providerId,
    modelId: input.modelId,
    requestCount: (input.previous?.requestCount ?? 0) + 1,
    lastSuccess: input.outcome.type === "ok" ? now : input.previous?.lastSuccess ?? null,
    lastFailure: input.outcome.type === "ok" ? input.previous?.lastFailure ?? null : now,
    cooldownUntil,
    lastOutcome: input.outcome,
    lastError: input.errorMessage ?? null,
    updatedAt: new Date(now).toISOString(),
  };
}

export function evaluateProviderModelRouteHealth(
  record: ProviderModelRouteHealthRecord | null | undefined,
  now = Date.now(),
): ProviderModelRouteHealthDecision {
  if (!record || record.cooldownUntil === null || now >= record.cooldownUntil) {
    return { healthy: true };
  }

  const outcome = record.lastOutcome?.type ?? "unknown";
  return {
    healthy: false,
    reason: `Provider '${record.providerId}' model '${record.modelId}' is cooling down after ${outcome}`,
    cooldownUntil: record.cooldownUntil,
  };
}

export function mapProviderModelRouteErrorToOutcome(message: string): CredentialOutcome {
  const normalized = message.toLowerCase();
  const status = extractHttpStatus(normalized);
  if (normalized.includes("last outcome rate-limited") || status === 429 || normalized.includes("rate limit")) {
    return { type: "rate-limited" };
  }
  if (normalized.includes("last outcome quota-exceeded") || status === 402 || normalized.includes("quota")) {
    return { type: "quota-exceeded" };
  }
  if (normalized.includes("last outcome auth-failed") || status === 401 || status === 403) {
    return { type: "auth-failed" };
  }
  if (normalized.includes("last outcome connection-failed") || normalized.includes("connection")) {
    return { type: "connection-failed" };
  }
  return { type: "unknown-error", message };
}

export function formatProviderModelRouteCooldown(decision: ProviderModelRouteHealthDecision): string {
  if (decision.healthy) {
    return "";
  }
  const suffix = decision.cooldownUntil
    ? ` until ${new Date(decision.cooldownUntil).toISOString()}`
    : "";
  return `${decision.reason ?? "Provider/model route is cooling down"}${suffix}`;
}

function extractHttpStatus(message: string): number | null {
  const match = message.match(/\b(?:api error|status)\s+(\d{3})\b/);
  if (!match) {
    return null;
  }
  const status = Number(match[1]);
  return Number.isFinite(status) ? status : null;
}

function computeRouteCooldownUntil(
  policy: CooldownPolicy,
  serverResetAt: number | null,
  now: number,
): number {
  if (serverResetAt !== null && serverResetAt > now) {
    const serverCooldown = serverResetAt - now;
    return now + (
      policy.maxCooldownMs === undefined
        ? serverCooldown
        : Math.min(serverCooldown, policy.maxCooldownMs)
    );
  }

  return now + policy.defaultCooldownMs;
}
