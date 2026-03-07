// Engine domain: tool execution types for Phase 5a (agentic actions)

/** Retry strategy for tool execution errors */
export type RetryStrategy = "exponential" | "mutate_params";

/** Retry configuration for a capability */
export interface RetryConfig {
  readonly onValidationError?: RetryStrategy;
  readonly onTransientError?: RetryStrategy;
  readonly maxAttempts?: number;
  readonly timeout?: number;
  readonly fallback?: string;
}

/** Authorization level (1=auto-execute, 2=audit, 3=confirm, 4=always-confirm) */
export type AuthorizationLevel = 1 | 2 | 3 | 4;

/** Result of a tool authorization check */
export interface ToolAuthorizationResult {
  readonly level: AuthorizationLevel;
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

/** Classification of a tool execution error */
export type ToolErrorType = "validation" | "transient" | "fatal";

/** Interface for authorizing tool execution based on annotations */
export interface ToolAuthorizer {
  authorize(toolName: string, annotations?: import("./capability.js").CapabilityAnnotations): ToolAuthorizationResult;
}

/** Result of tool execution with retry */
export interface ToolExecutionResult {
  readonly result: unknown;
  readonly attempts: number;
  readonly durationMs: number;
  readonly fallbackUsed: boolean;
}
