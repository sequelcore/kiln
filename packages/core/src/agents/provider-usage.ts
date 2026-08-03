import {
  validateManagedEconomicAmount,
  type ManagedEconomicAmount,
  type ManagedEconomicCreditEvidence,
  type ManagedEconomicQuotaExhaustionReason,
  type ManagedEconomicSpendControlEvidence,
} from "../cost/managed-route-economics.js";

export type ProviderUsageAvailability = "available" | "exhausted" | "unknown";
/**
 * `unknown` means the provider answered without usable usage evidence.
 * The remaining values all mean usage was not observed, which never means it
 * was not consumed. They stay distinct because each demands different action:
 * `credential-unavailable` asks the operator to re-authenticate,
 * `provider-request-failed` to investigate reachability, and
 * `provider-response-unusable` signals that the provider answered with data
 * Kiln could not interpret, which is a Kiln defect or a provider contract
 * change rather than anything the operator can resolve.
 */
export type ProviderUsageSource =
  | "provider-endpoint"
  | "provider-response-headers"
  | "provider-request-failed"
  | "credential-unavailable"
  | "provider-response-unusable"
  | "unknown";
export type ProviderUsageConfidence = "authoritative" | "unknown";

export type ProviderUsageExhaustionReason = ManagedEconomicQuotaExhaustionReason;

export interface ProviderUsageWindow {
  readonly bucketId: "primary" | "secondary";
  readonly usedPercent: number;
  readonly windowDurationMinutes?: number;
  readonly resetsAt?: string;
}

export type ProviderUsageCredits = ManagedEconomicCreditEvidence;

export type ProviderUsageSpendControl = ManagedEconomicSpendControlEvidence;

export interface ProviderUsageQuotaObservation {
  readonly primary?: ProviderUsageWindow;
  readonly secondary?: ProviderUsageWindow;
  readonly credits?: ProviderUsageCredits;
  readonly spendControl?: ProviderUsageSpendControl;
  readonly exhaustionReason: ProviderUsageExhaustionReason | null;
}

export interface ProviderUsageSnapshot extends ProviderUsageQuotaObservation {
  readonly provider: string;
  readonly credentialId: string;
  readonly plan?: string;
  readonly availability: ProviderUsageAvailability;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly source: ProviderUsageSource;
  readonly confidence: ProviderUsageConfidence;
  /** Response status when one was received. Status only; never response bodies or headers. */
  readonly httpStatus?: number;
}

const AVAILABILITIES: readonly ProviderUsageAvailability[] = ["available", "exhausted", "unknown"];
const SOURCES: readonly ProviderUsageSource[] = [
  "provider-endpoint",
  "provider-response-headers",
  "provider-request-failed",
  "credential-unavailable",
  "provider-response-unusable",
  "unknown",
];
const CONFIDENCES: readonly ProviderUsageConfidence[] = ["authoritative", "unknown"];
const EXHAUSTION_REASONS: readonly ProviderUsageExhaustionReason[] = [
  "rate-limit-reached",
  "workspace-owner-credits-depleted",
  "workspace-member-credits-depleted",
  "workspace-owner-usage-limit-reached",
  "workspace-member-usage-limit-reached",
  "spend-control-reached",
  "unknown",
];

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError(`${field} must not be empty.`);
  return normalized;
}

function requireTimestamp(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError(`${field} must be an ISO-compatible timestamp.`);
  return timestamp;
}

function requireHttpStatus(value: number): number {
  if (!Number.isSafeInteger(value) || value < 100 || value > 599) {
    throw new TypeError("httpStatus must be an integer between 100 and 599.");
  }
  return value;
}

function requireMember<T extends string>(value: T, members: readonly T[], field: string): T {
  if (!members.includes(value)) throw new TypeError(`${field} has an unsupported value.`);
  return value;
}

function copyWindow(window: ProviderUsageWindow, field: string): ProviderUsageWindow {
  if (window.bucketId !== field) {
    throw new TypeError(`${field}.bucketId must equal ${field}.`);
  }
  if (!Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) {
    throw new TypeError(`${field}.usedPercent must be between 0 and 100.`);
  }
  if (
    window.windowDurationMinutes !== undefined
    && (!Number.isSafeInteger(window.windowDurationMinutes) || window.windowDurationMinutes <= 0)
  ) {
    throw new TypeError(`${field}.windowDurationMinutes must be a positive safe integer.`);
  }
  if (window.resetsAt !== undefined) requireTimestamp(window.resetsAt, `${field}.resetsAt`);
  return Object.freeze({
    bucketId: window.bucketId,
    usedPercent: window.usedPercent,
    ...(window.windowDurationMinutes === undefined ? {} : { windowDurationMinutes: window.windowDurationMinutes }),
    ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
  });
}

function copyAmount(value: ManagedEconomicAmount | null, field: string): ManagedEconomicAmount | null {
  if (value === null) return null;
  try {
    validateManagedEconomicAmount(value);
  } catch (error) {
    throw new TypeError(`${field} is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Object.freeze({ ...value, scheme: Object.freeze({ ...value.scheme }) });
}

function copyCredits(credits: ProviderUsageCredits): ProviderUsageCredits {
  if (!["available", "unavailable", "unlimited", "unknown"].includes(credits.status)) {
    throw new TypeError("credits.status is invalid.");
  }
  if (credits.status === "unavailable" && credits.balance !== null) {
    throw new TypeError("credits.balance must be null when credits are unavailable.");
  }
  return Object.freeze({ status: credits.status, balance: copyAmount(credits.balance, "credits.balance") });
}

function copySpendControl(spend: ProviderUsageSpendControl): ProviderUsageSpendControl {
  if (!["available", "exhausted", "unknown"].includes(spend.status)) {
    throw new TypeError("spendControl.status is invalid.");
  }
  if (spend.remainingPercent !== null && (
    !Number.isSafeInteger(spend.remainingPercent)
    || spend.remainingPercent < 0
    || spend.remainingPercent > 100
  )) {
    throw new TypeError("spendControl.remainingPercent must be an integer between 0 and 100.");
  }
  if (spend.resetsAt !== null) requireTimestamp(spend.resetsAt, "spendControl.resetsAt");
  return Object.freeze({
    status: spend.status,
    limit: copyAmount(spend.limit, "spendControl.limit"),
    used: copyAmount(spend.used, "spendControl.used"),
    remainingPercent: spend.remainingPercent,
    resetsAt: spend.resetsAt,
  });
}

/** Validates and copies the secret-free quota portion of provider usage. */
export function createProviderUsageQuotaObservation(
  input: ProviderUsageQuotaObservation,
): ProviderUsageQuotaObservation {
  const exhaustionReason = input.exhaustionReason === null
    ? null
    : requireMember(input.exhaustionReason, EXHAUSTION_REASONS, "exhaustionReason");
  return Object.freeze({
    ...(input.primary === undefined ? {} : { primary: copyWindow(input.primary, "primary") }),
    ...(input.secondary === undefined ? {} : { secondary: copyWindow(input.secondary, "secondary") }),
    ...(input.credits === undefined ? {} : { credits: copyCredits(input.credits) }),
    ...(input.spendControl === undefined ? {} : { spendControl: copySpendControl(input.spendControl) }),
    exhaustionReason,
  });
}

/** Validates and copies sanitized quota evidence at the provider/runtime boundary. */
export function createProviderUsageSnapshot(input: ProviderUsageSnapshot): ProviderUsageSnapshot {
  const provider = requireText(input.provider, "provider");
  const credentialId = requireText(input.credentialId, "credentialId");
  const observedAt = requireTimestamp(input.observedAt, "observedAt");
  const validUntil = requireTimestamp(input.validUntil, "validUntil");
  if (validUntil < observedAt) throw new TypeError("validUntil must not precede observedAt.");
  const availability = requireMember(input.availability, AVAILABILITIES, "availability");
  const quota = createProviderUsageQuotaObservation(input);
  const exhaustionReason = quota.exhaustionReason;
  if (availability === "exhausted" && exhaustionReason === null) {
    throw new TypeError("exhausted provider usage requires an exhaustionReason.");
  }
  if (availability !== "exhausted" && exhaustionReason !== null) {
    throw new TypeError("provider usage exhaustionReason requires exhausted availability.");
  }

  return Object.freeze({
    provider,
    credentialId,
    ...(input.plan === undefined ? {} : { plan: requireText(input.plan, "plan") }),
    ...quota,
    availability,
    observedAt: input.observedAt,
    validUntil: input.validUntil,
    source: requireMember(input.source, SOURCES, "source"),
    confidence: requireMember(input.confidence, CONFIDENCES, "confidence"),
    ...(input.httpStatus === undefined ? {} : { httpStatus: requireHttpStatus(input.httpStatus) }),
  });
}
