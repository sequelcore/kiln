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
  // Domain Kits (Phase 4)
  | "DOMAIN_KIT_INVALID"
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
  // Security (Phase 3)
  | "INJECTION_DETECTED"
  | "GUARDIAN_BLOCKED"
  | "GUARDIAN_UNAVAILABLE"
  | "SECRET_DECRYPTION_FAILED"
  | "SECRET_NOT_FOUND"
  | "AUDIT_WRITE_FAILED"
  | "AUDIT_CHAIN_BROKEN"
  | "TENANT_ISOLATION_VIOLATED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMIT_EXCEEDED"
  // Skill (Phase 4)
  | "SKILL_YAML_INVALID"
  | "SKILL_NOT_FOUND"
  // Package (Phase 5)
  | "PACKAGE_YAML_INVALID"
  // Trigger (Phase 5)
  | "TRIGGER_FAILED"
  | "WEBHOOK_VALIDATION_FAILED"
  | "SCHEDULE_PARSE_FAILED"
  // Eval (Phase 10)
  | "EVAL_YAML_INVALID"
  | "EVAL_DATASET_NOT_FOUND"
  | "EVAL_DATASET_INVALID"
  | "EVAL_SCORER_FAILED"
  | "EVAL_EXPERIMENT_FAILED"
  // A2A + MCP (Phase 11)
  | "A2A_INVALID_REQUEST"
  | "A2A_TASK_NOT_FOUND"
  | "A2A_TASK_FAILED"
  | "A2A_CLIENT_FAILED"
  | "MCP_CONNECTION_FAILED"
  | "MCP_DISCOVERY_FAILED"
  | "MCP_SERVER_ERROR"
  | "TOOL_RAG_FAILED"
  // Multimodal (Phase 9)
  | "UNSUPPORTED_MODALITY"
  | "CONTENT_PART_INVALID"
  | "VOICE_CONFIG_INVALID"
  | "STT_FAILED"
  | "TTS_FAILED"
  // Session
  | "INVALID_SESSION_TRANSITION"
  | "CONCURRENT_SESSION_MODIFICATION"
  // Knowledge enrichment (Phase 4b)
  | "ENRICHMENT_FAILED"
  // Knowledge sources (Phase 4c)
  | "SOURCE_NOT_FOUND"
  | "SOURCE_EXTRACTION_FAILED"
  | "SOURCE_ALREADY_EXISTS"
  // Contact memory (Phase 4d)
  | "CONTACT_MEMORY_EXTRACTION_FAILED"
  // Safety (Phase 12)
  | "PII_DETECTED"
  | "CONTENT_POLICY_VIOLATED"
  | "SAFETY_RAIL_BLOCKED"
  | "SAFETY_SCAN_FAILED"
  // Generic
  | "INTERNAL_ERROR";

/** Base error for all Kiln errors. Provides code, context, retryable flag, and developer hints. */
export class KilnError extends Error {
  readonly code: KilnErrorCode;
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;
  readonly suggestion?: string;
  readonly docUrl?: string;

  constructor(
    code: KilnErrorCode,
    message: string,
    options?: {
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: unknown;
      suggestion?: string;
      docUrl?: string;
    },
  ) {
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = "KilnError";
    this.code = code;
    this.context = options?.context ?? {};
    this.retryable = options?.retryable ?? false;
    this.suggestion = options?.suggestion;
    this.docUrl = options?.docUrl;
  }
}
