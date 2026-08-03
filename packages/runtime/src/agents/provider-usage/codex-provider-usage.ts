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
  /**
   * True when any carried window reports a `resetsAt` the adapter cannot treat as
   * a credible billing-window end. The window and its `usedPercent` are still
   * surfaced (rolling over or acting on usable capacity must not break here), but
   * the snapshot is downgraded to `confidence: "unknown"` so downstream economic
   * policy stops trusting a sentinel as authoritative evidence.
   */
  readonly implausibleReset: boolean;
}

/**
 * A quota `reset_at` marks the end of a recurring billing window. The longest
 * plausible such window is a calendar year (most are hours to a week, as Codex
 * reports); rarer annual windows are still bounded by 366 days. The
 * operator-observed Codex sentinel resets at year 2099 — roughly 73 years past
 * observation, identical across seven distinct credentials — which no real
 * billing window can produce. A reset instant beyond this horizon is not
 * credible enough to label authoritative.
 */
const PLAUSIBLE_RESET_HORIZON_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * The plausibility bound lives in the Codex adapter rather than the core
 * `copyWindow` contract because `confidence` is the adapter's authority call:
 * the adapter that interprets a provider's semantics decides when its evidence
 * is authoritative. Keeping `copyWindow` structural-only also avoids threading
 * `observedAt` into the core quota-observation builder and lets the core stay a
 * pure shape validator. A future provider exhibiting similar sentinels must
 * apply its own bound; generalizing now would be speculative — no other
 * provider exists in this monorepo.
 */
function isPlausibleReset(resetsAtIso: string, observedAtMs: number): boolean {
  const resetMs = Date.parse(resetsAtIso);
  // A reset in the recent past is stale-but-legitimate rollover evidence, not a
  // sentinel; only the far-future direction is the defect observed in #48.
  return Number.isFinite(resetMs) && resetMs - observedAtMs <= PLAUSIBLE_RESET_HORIZON_MS;
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

interface ParsedWindow {
  readonly window: ProviderUsageWindow | undefined;
  readonly implausibleReset: boolean;
}

function parseWindow(
  value: unknown,
  bucketId: ProviderUsageWindow["bucketId"],
  observedAtMs: number,
): ParsedWindow {
  if (!isRecord(value)) return { window: undefined, implausibleReset: false };
  const usedPercent = value.used_percent;
  if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return { window: undefined, implausibleReset: false };
  }
  const resetsAt = parseEpochSeconds(value.reset_at);
  const durationSeconds = value.limit_window_seconds;
  const windowDurationMinutes = typeof durationSeconds === "number"
    && Number.isSafeInteger(durationSeconds)
    && durationSeconds > 0
    && durationSeconds % 60 === 0
    ? durationSeconds / 60
    : undefined;
  // Keep `resetsAt` in the window even when implausible: dropping it silently
  // would hide the sentinel. The downgrade to `confidence: "unknown"` is the
  // signal that something was wrong; the value stays auditable.
  const implausibleReset = resetsAt !== undefined && !isPlausibleReset(resetsAt, observedAtMs);
  return {
    window: {
      bucketId,
      usedPercent,
      ...(windowDurationMinutes === undefined ? {} : { windowDurationMinutes }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    },
    implausibleReset,
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

function parseBody(body: unknown, provider: string, observedAtMs: number): ParsedCodexUsage | undefined {
  if (!isRecord(body)) return undefined;
  const details = body.rate_limit;
  if (!isRecord(details)) return undefined;

  const primary = parseWindow(details.primary_window, "primary", observedAtMs);
  const secondary = parseWindow(details.secondary_window, "secondary", observedAtMs);
  const allowed = typeof details.allowed === "boolean" ? details.allowed : undefined;
  const limitReached = typeof details.limit_reached === "boolean" ? details.limit_reached : undefined;
  const rawPlan = body.plan_type;
  const normalizedPlan = typeof rawPlan === "string" ? rawPlan.trim().toLowerCase() : undefined;
  const plan = normalizedPlan !== undefined && CODEX_PLAN_TYPES.has(normalizedPlan) ? normalizedPlan : undefined;
  const credits = parseCredits(body.credits, provider);
  const spendControl = parseSpendControl(body.spend_control);
  const classifiedExhaustion = parseExhaustionReason(body.rate_limit_reached_type);
  if (
    primary.window === undefined
    && secondary.window === undefined
    && allowed === undefined
    && limitReached === undefined
    && credits === undefined
    && spendControl === undefined
    && classifiedExhaustion === null
  ) return undefined;
  const availability = deriveAvailability(primary.window, secondary.window, allowed, limitReached);
  const exhausted = availability === "exhausted" || spendControl?.status === "exhausted" || classifiedExhaustion !== null;
  return {
    ...(plan === undefined ? {} : { plan }),
    ...(primary.window === undefined ? {} : { primary: primary.window }),
    ...(secondary.window === undefined ? {} : { secondary: secondary.window }),
    ...(credits === undefined ? {} : { credits }),
    ...(spendControl === undefined ? {} : { spendControl }),
    exhaustionReason: exhausted
      ? classifiedExhaustion ?? (spendControl?.status === "exhausted" ? "spend-control-reached" : "rate-limit-reached")
      : null,
    availability: exhausted ? "exhausted" : availability,
    implausibleReset: primary.implausibleReset || secondary.implausibleReset,
  };
}

function readHeader(headers: CodexUsageHeaders, name: string): string | undefined {
  if ("get" in headers && typeof headers.get === "function") return headers.get(name) ?? undefined;
  const match = Object.entries(headers).find(([key]) => key.toLowerCase() === name);
  const value = match?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function parseHeaderWindow(
  headers: CodexUsageHeaders,
  prefix: "primary" | "secondary",
  observedAtMs: number,
): ParsedWindow {
  const rawUsedPercent = readHeader(headers, `x-codex-${prefix}-used-percent`);
  if (rawUsedPercent === undefined) return { window: undefined, implausibleReset: false };
  const usedPercent = Number(rawUsedPercent);
  if (!Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) {
    return { window: undefined, implausibleReset: false };
  }
  const rawResetAt = readHeader(headers, `x-codex-${prefix}-reset-at`);
  const resetsAt = rawResetAt === undefined ? undefined : parseEpochSeconds(Number(rawResetAt));
  const rawDuration = readHeader(headers, `x-codex-${prefix}-window-minutes`);
  const duration = rawDuration === undefined ? Number.NaN : Number(rawDuration);
  const windowDurationMinutes = Number.isSafeInteger(duration) && duration > 0 ? duration : undefined;
  const implausibleReset = resetsAt !== undefined && !isPlausibleReset(resetsAt, observedAtMs);
  return {
    window: {
      bucketId: prefix,
      usedPercent,
      ...(windowDurationMinutes === undefined ? {} : { windowDurationMinutes }),
      ...(resetsAt === undefined ? {} : { resetsAt }),
    },
    implausibleReset,
  };
}

function parseHeaders(headers: CodexUsageHeaders | undefined, observedAtMs: number): ParsedCodexUsage | undefined {
  if (headers === undefined) return undefined;
  const primary = parseHeaderWindow(headers, "primary", observedAtMs);
  const secondary = parseHeaderWindow(headers, "secondary", observedAtMs);
  if (primary.window === undefined && secondary.window === undefined) return undefined;
  return {
    ...(primary.window === undefined ? {} : { primary: primary.window }),
    ...(secondary.window === undefined ? {} : { secondary: secondary.window }),
    exhaustionReason: deriveAvailability(primary.window, secondary.window) === "exhausted" ? "rate-limit-reached" : null,
    availability: deriveAvailability(primary.window, secondary.window),
    implausibleReset: primary.implausibleReset || secondary.implausibleReset,
  };
}

/** Converts Codex-owned evidence into the provider-neutral sanitized snapshot. */
export function parseCodexProviderUsage(input: ParseCodexProviderUsageInput): ProviderUsageSnapshot {
  const observedAtMs = Date.parse(input.observedAt);
  const body = parseBody(input.body, input.provider, observedAtMs);
  if (body !== undefined) {
    const { implausibleReset, ...bodyEvidence } = body;
    return createProviderUsageSnapshot({
      provider: input.provider,
      credentialId: input.credentialId,
      ...bodyEvidence,
      observedAt: input.observedAt,
      validUntil: input.validUntil,
      source: "provider-endpoint",
      // Authoritative only when every carried reset instant is plausible. A
      // far-future sentinel (e.g. year 2099) is downgraded, not discarded, so
      // downstream economic policy stops treating a sentinel as capacity truth.
      confidence: implausibleReset ? "unknown" : "authoritative",
    });
  }

  const headers = parseHeaders(input.headers, observedAtMs);
  if (headers !== undefined) {
    const { implausibleReset, ...headerEvidence } = headers;
    return createProviderUsageSnapshot({
      provider: input.provider,
      credentialId: input.credentialId,
      ...headerEvidence,
      observedAt: input.observedAt,
      validUntil: input.validUntil,
      source: "provider-response-headers",
      confidence: implausibleReset ? "unknown" : "authoritative",
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
