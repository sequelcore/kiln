export type CredentialOutcome =
  | { readonly type: "ok" }
  | { readonly type: "rate-limited"; readonly resetAt?: number }
  | { readonly type: "quota-exceeded" }
  | { readonly type: "auth-failed" }
  | { readonly type: "connection-failed" }
  | { readonly type: "unknown-error"; readonly message?: string };

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

  constructor(cause?: unknown, lastOutcome?: CredentialOutcome) {
    super("All credentials in the pool are exhausted");
    this.name = "AllCredentialsExhaustedError";
    this.cause = cause ?? null;
    this.lastOutcome = lastOutcome ?? null;
  }
}
