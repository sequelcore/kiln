// KilnError: unified error hierarchy for all Kiln errors
// Provides code, context, and retryable flag for consistent error handling

/** Error codes for all Kiln errors. Grouped by bounded context. */
export type KilnErrorCode =
  // Engine / Loader
  | "APP_YAML_INVALID"
  | "PRESET_LOAD_FAILED"
  | "GATEWAY_YAML_INVALID"
  | "MODE_B_CONFIG_INVALID"
  // Domain
  | "DOMAIN_YAML_INVALID"
  // Tenant
  | "TENANT_NOT_FOUND"
  | "TENANT_VALIDATION_FAILED"
  // Provider
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_AUTH_FAILED"
  // Budget
  | "BUDGET_CHECK_FAILED"
  | "BUDGET_EXCEEDED"
  // Configuration
  | "CONFIG_MISSING_ENV"
  | "CONFIG_INVALID"
  // Circuit breaker
  | "CIRCUIT_OPEN"
  // Agent Intelligence (Phase 2)
  | "GUARDRAIL_FAILED"
  | "STRUCTURED_OUTPUT_INVALID"
  | "HANDOFF_FAILED"
  | "INTERRUPT_TIMEOUT"
  // Generic
  | "INTERNAL_ERROR";

/** Base error for all Kiln errors. Provides code, context, and retryable flag. */
export class KilnError extends Error {
  readonly code: KilnErrorCode;
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(
    code: KilnErrorCode,
    message: string,
    options?: {
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "KilnError";
    this.code = code;
    this.context = options?.context ?? {};
    this.retryable = options?.retryable ?? false;
  }
}
