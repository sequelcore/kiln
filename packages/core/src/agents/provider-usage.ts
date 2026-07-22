export type ProviderUsageAvailability = "available" | "exhausted" | "unknown";
export type ProviderUsageSource = "provider-endpoint" | "provider-response-headers" | "unknown";
export type ProviderUsageConfidence = "authoritative" | "unknown";

export interface ProviderUsageWindow {
  readonly usedPercent: number;
  readonly resetsAt?: string;
}

export interface ProviderUsageSnapshot {
  readonly provider: string;
  readonly credentialId: string;
  readonly plan?: string;
  readonly primary?: ProviderUsageWindow;
  readonly secondary?: ProviderUsageWindow;
  readonly availability: ProviderUsageAvailability;
  readonly observedAt: string;
  readonly validUntil: string;
  readonly source: ProviderUsageSource;
  readonly confidence: ProviderUsageConfidence;
}

const AVAILABILITIES: readonly ProviderUsageAvailability[] = ["available", "exhausted", "unknown"];
const SOURCES: readonly ProviderUsageSource[] = ["provider-endpoint", "provider-response-headers", "unknown"];
const CONFIDENCES: readonly ProviderUsageConfidence[] = ["authoritative", "unknown"];

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

function requireMember<T extends string>(value: T, members: readonly T[], field: string): T {
  if (!members.includes(value)) throw new TypeError(`${field} has an unsupported value.`);
  return value;
}

function copyWindow(window: ProviderUsageWindow, field: string): ProviderUsageWindow {
  if (!Number.isFinite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100) {
    throw new TypeError(`${field}.usedPercent must be between 0 and 100.`);
  }
  if (window.resetsAt !== undefined) requireTimestamp(window.resetsAt, `${field}.resetsAt`);
  return Object.freeze({
    usedPercent: window.usedPercent,
    ...(window.resetsAt === undefined ? {} : { resetsAt: window.resetsAt }),
  });
}

/** Validates and copies sanitized quota evidence at the provider/runtime boundary. */
export function createProviderUsageSnapshot(input: ProviderUsageSnapshot): ProviderUsageSnapshot {
  const provider = requireText(input.provider, "provider");
  const credentialId = requireText(input.credentialId, "credentialId");
  const observedAt = requireTimestamp(input.observedAt, "observedAt");
  const validUntil = requireTimestamp(input.validUntil, "validUntil");
  if (validUntil < observedAt) throw new TypeError("validUntil must not precede observedAt.");

  return Object.freeze({
    provider,
    credentialId,
    ...(input.plan === undefined ? {} : { plan: requireText(input.plan, "plan") }),
    ...(input.primary === undefined ? {} : { primary: copyWindow(input.primary, "primary") }),
    ...(input.secondary === undefined ? {} : { secondary: copyWindow(input.secondary, "secondary") }),
    availability: requireMember(input.availability, AVAILABILITIES, "availability"),
    observedAt: input.observedAt,
    validUntil: input.validUntil,
    source: requireMember(input.source, SOURCES, "source"),
    confidence: requireMember(input.confidence, CONFIDENCES, "confidence"),
  });
}
