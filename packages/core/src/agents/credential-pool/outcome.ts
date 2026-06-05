export type CredentialOutcome =
  | { readonly type: "ok" }
  | { readonly type: "rate-limited"; readonly resetAt?: number }
  | { readonly type: "quota-exceeded" }
  | { readonly type: "auth-failed" }
  | { readonly type: "connection-failed" }
  | { readonly type: "unknown-error"; readonly message?: string };

export type CredentialExhaustionReason =
  | "empty-pool"
  | "all-credentials-unavailable"
  | "attempts-exhausted"
  | "no-executable-credentials";

export type CredentialDiagnosticHealth =
  | "ok"
  | "cooling"
  | "exhausted"
  | "expired"
  | "invalid";

export interface CredentialExhaustionEntryDiagnostic {
  readonly id: string;
  readonly label?: string;
  readonly source?: string;
  readonly health: CredentialDiagnosticHealth;
  readonly requestCount?: number;
  readonly lastSuccess?: number | null;
  readonly lastExhausted?: number | null;
  readonly cooldownUntil?: number | null;
  readonly expiresAt?: string;
  readonly invalidReason?: string;
}

export interface CredentialExhaustionDiagnostic {
  readonly providerId: string;
  readonly reason: CredentialExhaustionReason;
  readonly totalCredentials: number;
  readonly availableCredentials: number;
  readonly unavailableCredentials: number;
  readonly lastOutcome?: CredentialOutcome | null;
  readonly entries: readonly CredentialExhaustionEntryDiagnostic[];
}

export function isOk(outcome: CredentialOutcome): outcome is { readonly type: "ok" } {
  return outcome.type === "ok";
}

export function isRetryable(outcome: CredentialOutcome): boolean {
  return (
    outcome.type === "rate-limited"
    || outcome.type === "quota-exceeded"
    || outcome.type === "connection-failed"
  );
}

export function isAuthError(outcome: CredentialOutcome): boolean {
  return outcome.type === "auth-failed";
}

export function getResetAt(outcome: CredentialOutcome): number | null {
  if (outcome.type === "rate-limited" && outcome.resetAt !== undefined) {
    return outcome.resetAt;
  }
  return null;
}

export class AllCredentialsExhaustedError extends Error {
  readonly cause: unknown;
  readonly lastOutcome: CredentialOutcome | null;
  readonly diagnostic: CredentialExhaustionDiagnostic | undefined;

  constructor(
    cause?: unknown,
    lastOutcome?: CredentialOutcome,
    diagnostic?: CredentialExhaustionDiagnostic,
  ) {
    super("All credentials in the pool are exhausted");
    this.name = "AllCredentialsExhaustedError";
    this.cause = cause ?? null;
    this.lastOutcome = lastOutcome ?? null;
    this.diagnostic = diagnostic;
  }
}
