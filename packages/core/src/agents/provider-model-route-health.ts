import {
  DEFAULT_COOLDOWN_POLICY,
  type CooldownPolicy,
} from "./credential-pool/cooldown.js";

export type ProviderModelRouteOutcome =
  | { readonly type: "ok" }
  | { readonly type: "rate-limited"; readonly resetAt?: number }
  | { readonly type: "quota-exceeded" }
  | { readonly type: "auth-failed" }
  | { readonly type: "connection-failed" }
  | { readonly type: "transient-unavailable"; readonly reason?: string }
  | { readonly type: "request-incompatible"; readonly reason?: string }
  | { readonly type: "unknown-error"; readonly message?: string };

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
  readonly lastOutcome: ProviderModelRouteOutcome | null;
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
  readonly outcome: ProviderModelRouteOutcome;
  readonly errorMessage?: string;
  readonly now?: number;
}): ProviderModelRouteHealthRecord {
  const now = input.now ?? Date.now();
  const cooldownUntil = isRouteRetryable(input.outcome)
    ? computeRouteCooldownUntil(DEFAULT_COOLDOWN_POLICY, getRouteResetAt(input.outcome), now)
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

export function mapProviderModelRouteErrorToOutcome(message: string): ProviderModelRouteOutcome {
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
  if (
    status === 503
    || status === 502
    || status === 504
    || normalized.includes("failover_exhausted")
    || normalized.includes("temporarily unavailable")
  ) {
    return { type: "transient-unavailable", reason: extractProviderErrorReason(message) };
  }
  if (
    status === 400
    || normalized.includes("invalid_request_error")
    || normalized.includes("invalid function")
    || normalized.includes("invalid schema")
  ) {
    return { type: "request-incompatible", reason: extractProviderErrorReason(message) };
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

function extractProviderErrorReason(message: string): string {
  const jsonStart = message.indexOf("{");
  if (jsonStart >= 0) {
    try {
      const payload = JSON.parse(message.slice(jsonStart)) as unknown;
      const reason = readNestedErrorMessage(payload);
      if (reason) return reason;
    } catch {
      // Preserve the original provider evidence when the body is not valid JSON.
    }
  }
  return message;
}

function readNestedErrorMessage(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
  }
  return readNestedErrorMessage(record.error);
}

function isRouteRetryable(outcome: ProviderModelRouteOutcome): boolean {
  return outcome.type === "rate-limited"
    || outcome.type === "quota-exceeded"
    || outcome.type === "connection-failed"
    || outcome.type === "transient-unavailable";
}

function getRouteResetAt(outcome: ProviderModelRouteOutcome): number | null {
  return outcome.type === "rate-limited" && outcome.resetAt !== undefined
    ? outcome.resetAt
    : null;
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
