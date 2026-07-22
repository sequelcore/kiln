import {
  createProviderUsageSnapshot,
  type ProviderUsageAvailability,
  type ProviderUsageSnapshot,
  type ProviderUsageWindow,
} from "@kilnai/core";

export type CodexUsageHeaders =
  | Readonly<Record<string, string | readonly string[] | undefined>>
  | { readonly get: (name: string) => string | null };

export interface ParseCodexProviderUsageInput {
  readonly provider: string;
  readonly credentialId: string;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly body?: unknown;
  readonly headers?: CodexUsageHeaders;
}

interface ParsedCodexUsage {
  readonly plan?: string;
  readonly primary?: ProviderUsageWindow;
  readonly secondary?: ProviderUsageWindow;
  readonly availability: ProviderUsageAvailability;
}

const CODEX_PLAN_TYPES = new Set([
  "guest",
  "free",
  "go",
  "plus",
  "pro",
  "prolite",
  "free_workspace",
  "team",
  "self_serve_business_usage_based",
  "business",
  "enterprise_cbp_usage_based",
  "education",
  "quorum",
  "k12",
  "enterprise",
  "edu",
  "unknown",
]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEpochSeconds(value: unknown): string | undefined {
  const seconds = typeof value === "number" ? value : Number.NaN;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
  const date = new Date(seconds * 1_000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function parseWindow(value: unknown): ProviderUsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const usedPercent = value.used_percent;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return undefined;
  }
  const resetsAt = parseEpochSeconds(value.reset_at);
  return { usedPercent, ...(resetsAt === undefined ? {} : { resetsAt }) };
}

function deriveAvailability(
  primary: ProviderUsageWindow | undefined,
  secondary: ProviderUsageWindow | undefined,
  allowed?: boolean,
  limitReached?: boolean,
): ProviderUsageAvailability {
  if (limitReached === true || allowed === false || primary?.usedPercent === 100 || secondary?.usedPercent === 100) {
    return "exhausted";
  }
  if (allowed === true || primary !== undefined || secondary !== undefined) return "available";
  return "unknown";
}

function parseBody(body: unknown): ParsedCodexUsage | undefined {
  if (!isRecord(body)) return undefined;
  const details = body.rate_limit;
  if (!isRecord(details)) return undefined;

  const primary = parseWindow(details.primary_window);
  const secondary = parseWindow(details.secondary_window);
  const allowed = typeof details.allowed === "boolean" ? details.allowed : undefined;
  const limitReached = typeof details.limit_reached === "boolean" ? details.limit_reached : undefined;
  if (primary === undefined && secondary === undefined && allowed === undefined && limitReached === undefined) return undefined;

  const rawPlan = body.plan_type;
  const normalizedPlan = typeof rawPlan === "string" ? rawPlan.trim().toLowerCase() : undefined;
  const plan = normalizedPlan !== undefined && CODEX_PLAN_TYPES.has(normalizedPlan) ? normalizedPlan : undefined;
  return {
    ...(plan === undefined ? {} : { plan }),
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
    availability: deriveAvailability(primary, secondary, allowed, limitReached),
  };
}

function readHeader(headers: CodexUsageHeaders, name: string): string | undefined {
  if ("get" in headers && typeof headers.get === "function") return headers.get(name) ?? undefined;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = match?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function parseHeaderWindow(headers: CodexUsageHeaders, prefix: "primary" | "secondary"): ProviderUsageWindow | undefined {
  const rawUsedPercent = readHeader(headers, `x-codex-${prefix}-used-percent`);
  if (rawUsedPercent === undefined) return undefined;
  const usedPercent = Number(rawUsedPercent);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) return undefined;
  const rawResetAt = readHeader(headers, `x-codex-${prefix}-reset-at`);
  const resetsAt = rawResetAt === undefined ? undefined : parseEpochSeconds(Number(rawResetAt));
  return { usedPercent, ...(resetsAt === undefined ? {} : { resetsAt }) };
}

function parseHeaders(headers: CodexUsageHeaders | undefined): ParsedCodexUsage | undefined {
  if (headers === undefined) return undefined;
  const primary = parseHeaderWindow(headers, "primary");
  const secondary = parseHeaderWindow(headers, "secondary");
  if (primary === undefined && secondary === undefined) return undefined;
  return {
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
    availability: deriveAvailability(primary, secondary),
  };
}

/** Converts Codex-owned evidence into the provider-neutral sanitized snapshot. */
export function parseCodexProviderUsage(input: ParseCodexProviderUsageInput): ProviderUsageSnapshot {
  const body = parseBody(input.body);
  if (body !== undefined) {
    return createProviderUsageSnapshot({
      provider: input.provider,
      credentialId: input.credentialId,
      ...body,
      observedAt: input.observedAt,
      validUntil: input.validUntil,
      source: "provider-endpoint",
      confidence: "authoritative",
    });
  }

  const headers = parseHeaders(input.headers);
  if (headers !== undefined) {
    return createProviderUsageSnapshot({
      provider: input.provider,
      credentialId: input.credentialId,
      ...headers,
      observedAt: input.observedAt,
      validUntil: input.validUntil,
      source: "provider-response-headers",
      confidence: "authoritative",
    });
  }

  return createProviderUsageSnapshot({
    provider: input.provider,
    credentialId: input.credentialId,
    availability: "unknown",
    observedAt: input.observedAt,
    validUntil: input.validUntil,
    source: "unknown",
    confidence: "unknown",
  });
}
