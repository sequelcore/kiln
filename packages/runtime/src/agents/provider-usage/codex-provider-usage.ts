import {
  createManagedEconomicAmountFromDecimal,
  createProviderUsageSnapshot,
  type ProviderUsageAvailability,
  type ProviderUsageCredits,
  type ProviderUsageExhaustionReason,
  type ProviderUsageSnapshot,
  type ProviderUsageSpendControl,
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
  /**
   * Present when Kiln never obtained a usable answer. Body and header evidence
   * still take precedence, because a rejected response may still carry
   * authoritative rate-limit headers.
   */
  readonly failure?: CodexUsageRequestFailure;
}

export interface CodexUsageRequestFailure {
  /** Absent for transport failures, where no response was received. */
  readonly httpStatus?: number;
}

interface ParsedCodexUsage {
  readonly plan?: string;
  readonly primary?: ProviderUsageWindow;
  readonly secondary?: ProviderUsageWindow;
  readonly credits?: ProviderUsageCredits;
  readonly spendControl?: ProviderUsageSpendControl;
  readonly exhaustionReason: ProviderUsageExhaustionReason | null;
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

function parseWindow(
  value: unknown,
  bucketId: ProviderUsageWindow["bucketId"],
): ProviderUsageWindow | undefined {
  if (!isRecord(value)) return undefined;
  const usedPercent = value.used_percent;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return undefined;
  }
  const resetsAt = parseEpochSeconds(value.reset_at);
  const durationSeconds = value.limit_window_seconds;
  const windowDurationMinutes = typeof durationSeconds === "number"
    && Number.isSafeInteger(durationSeconds)
    && durationSeconds > 0
    && durationSeconds % 60 === 0
    ? durationSeconds / 60
    : undefined;
  return {
    bucketId,
    usedPercent,
    ...(windowDurationMinutes === undefined ? {} : { windowDurationMinutes }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function parseExactAmount(value: unknown, unit: string, creditSchemeId?: string) {
  if (typeof value !== "string") return null;
  try {
    return createManagedEconomicAmountFromDecimal({
      value,
      unit,
      scheme: creditSchemeId
        ? { kind: "credit", creditSchemeId }
        : { kind: "unit" },
    });
  } catch {
    return null;
  }
}

function parseCredits(value: unknown, provider: string): ProviderUsageCredits | undefined {
  if (!isRecord(value) || typeof value.has_credits !== "boolean" || typeof value.unlimited !== "boolean") {
    return undefined;
  }
  const balance = value.balance === null || value.balance === undefined
    ? null
    : parseExactAmount(value.balance, "credit", provider);
  if (value.balance !== null && value.balance !== undefined && balance === null) return undefined;
  const status = value.unlimited ? "unlimited" : value.has_credits ? "available" : "unavailable";
  // Codex reports a residual balance alongside `has_credits: false`. The
  // availability flag is authoritative, and the sanitized contract requires no
  // balance once credits are unavailable, so the residual figure is dropped
  // rather than carried as contradictory evidence.
  return { status, balance: status === "unavailable" ? null : balance };
}

function parseSpendControl(value: unknown): ProviderUsageSpendControl | undefined {
  if (!isRecord(value) || typeof value.reached !== "boolean") return undefined;
  const details = isRecord(value.individual_limit) ? value.individual_limit : undefined;
  const limit = details ? parseExactAmount(details.limit, "provider-spend-unit") : null;
  const used = details ? parseExactAmount(details.used, "provider-spend-unit") : null;
  if (details && (limit === null || used === null)) return undefined;
  const remainingPercent = details && Number.isSafeInteger(details.remaining_percent)
    && Number(details.remaining_percent) >= 0
    && Number(details.remaining_percent) <= 100
    ? Number(details.remaining_percent)
    : null;
  const resetsAt = details ? parseEpochSeconds(details.reset_at) ?? null : null;
  return {
    status: value.reached ? "exhausted" : "available",
    limit,
    used,
    remainingPercent,
    resetsAt,
  };
}

function parseExhaustionReason(value: unknown): ProviderUsageExhaustionReason | null {
  const kind = isRecord(value) ? value.kind : value;
  switch (kind) {
    case "rate_limit_reached": return "rate-limit-reached";
    case "workspace_owner_credits_depleted": return "workspace-owner-credits-depleted";
    case "workspace_member_credits_depleted": return "workspace-member-credits-depleted";
    case "workspace_owner_usage_limit_reached": return "workspace-owner-usage-limit-reached";
    case "workspace_member_usage_limit_reached": return "workspace-member-usage-limit-reached";
    default: return null;
  }
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

function parseBody(body: unknown, provider: string): ParsedCodexUsage | undefined {
  if (!isRecord(body)) return undefined;
  const details = body.rate_limit;
  if (!isRecord(details)) return undefined;

  const primary = parseWindow(details.primary_window, "primary");
  const secondary = parseWindow(details.secondary_window, "secondary");
  const allowed = typeof details.allowed === "boolean" ? details.allowed : undefined;
  const limitReached = typeof details.limit_reached === "boolean" ? details.limit_reached : undefined;
  const rawPlan = body.plan_type;
  const normalizedPlan = typeof rawPlan === "string" ? rawPlan.trim().toLowerCase() : undefined;
  const plan = normalizedPlan !== undefined && CODEX_PLAN_TYPES.has(normalizedPlan) ? normalizedPlan : undefined;
  const credits = parseCredits(body.credits, provider);
  const spendControl = parseSpendControl(body.spend_control);
  const classifiedExhaustion = parseExhaustionReason(body.rate_limit_reached_type);
  if (
    primary === undefined
    && secondary === undefined
    && allowed === undefined
    && limitReached === undefined
    && credits === undefined
    && spendControl === undefined
    && classifiedExhaustion === null
  ) return undefined;
  const availability = deriveAvailability(primary, secondary, allowed, limitReached);
  const exhausted = availability === "exhausted" || spendControl?.status === "exhausted" || classifiedExhaustion !== null;
  return {
    ...(plan === undefined ? {} : { plan }),
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
    ...(credits === undefined ? {} : { credits }),
    ...(spendControl === undefined ? {} : { spendControl }),
    exhaustionReason: exhausted
      ? classifiedExhaustion ?? (spendControl?.status === "exhausted" ? "spend-control-reached" : "rate-limit-reached")
      : null,
    availability: exhausted ? "exhausted" : availability,
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
  const rawDuration = readHeader(headers, `x-codex-${prefix}-window-minutes`);
  const duration = rawDuration === undefined ? Number.NaN : Number(rawDuration);
  const windowDurationMinutes = Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
  return {
    bucketId: prefix,
    usedPercent,
    ...(windowDurationMinutes === undefined ? {} : { windowDurationMinutes }),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

function parseHeaders(headers: CodexUsageHeaders | undefined): ParsedCodexUsage | undefined {
  if (headers === undefined) return undefined;
  const primary = parseHeaderWindow(headers, "primary");
  const secondary = parseHeaderWindow(headers, "secondary");
  if (primary === undefined && secondary === undefined) return undefined;
  return {
    ...(primary === undefined ? {} : { primary }),
    ...(secondary === undefined ? {} : { secondary }),
    exhaustionReason: deriveAvailability(primary, secondary) === "exhausted" ? "rate-limit-reached" : null,
    availability: deriveAvailability(primary, secondary),
  };
}

/** Converts Codex-owned evidence into the provider-neutral sanitized snapshot. */
export function parseCodexProviderUsage(input: ParseCodexProviderUsageInput): ProviderUsageSnapshot {
  const body = parseBody(input.body, input.provider);
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
    exhaustionReason: null,
    availability: "unknown",
    observedAt: input.observedAt,
    validUntil: input.validUntil,
    source: input.failure === undefined ? "unknown" : "provider-request-failed",
    confidence: "unknown",
    ...(input.failure?.httpStatus === undefined ? {} : { httpStatus: input.failure.httpStatus }),
  });
}
