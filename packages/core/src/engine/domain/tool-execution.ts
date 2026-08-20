// Engine domain: tool execution types for Phase 5a (agentic actions)

import type { ResolvedInvocationEffect } from "./action-effect.js";

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

/**
 * Canonical authority descriptor for a tool invocation.
 * The single authority decision/result shape.
 * ToolAuthorizationResult has been consolidated into this type.
 */
export interface AuthorityDescriptor {
  readonly level: AuthorizationLevel;
  readonly allowed: boolean;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

/** Classification of a tool execution error */
export type ToolErrorType = "validation" | "transient" | "fatal";

/** Interface for authorizing tool execution from one resolved invocation effect. */
export interface ToolAuthorizer {
  authorize(toolName: string, resolvedEffect: ResolvedInvocationEffect): AuthorityDescriptor;
}

/**
 * Admission supplied by an outer bounded context (for example CLI policy).
 * Core owns only the invocation envelope; the adapter may inspect concrete
 * input and the caller bound, but its result is always met with effect and
 * caller authority before execution.
 */
export interface InvocationAdmission {
  authorize(input: {
    readonly toolName: string;
    readonly toolInput: Readonly<Record<string, unknown>>;
    readonly resolvedEffect: ResolvedInvocationEffect;
    readonly callerBound?: AuthorityDescriptor;
  }): AuthorityDescriptor;
}

/** Canonical request envelope for tool execution. */
export interface ToolExecutionRequest {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly authority?: AuthorityDescriptor;
}

/** Result of tool execution with retry */
export interface ToolExecutionResult {
  readonly result: unknown;
  readonly attempts: number;
  readonly durationMs: number;
  readonly fallbackUsed: boolean;
}

/** Shell family for command-execution safety checks */
export type CommandShell = "bash" | "sh" | "zsh" | "powershell" | "cmd" | "any";

/** Dangerous command decision action */
export type DangerousCommandAction = "allow" | "ask" | "deny";

/** Stable reason code for dangerous-command decisions */
export type DangerousCommandReasonCode =
  | "empty_command"
  | "safe_read_only"
  | "destructive_unix"
  | "destructive_windows"
  | "download_execute"
  | "ambiguous_expansion"
  | "ambiguous_chaining"
  | "unknown_command";

/** Request shape for deterministic dangerous-command evaluation */
export interface DangerousCommandRequest {
  readonly command: string;
  readonly shell?: CommandShell;
}

/** Result of dangerous-command evaluation */
export interface DangerousCommandDecision {
  readonly action: DangerousCommandAction;
  readonly reasonCode: DangerousCommandReasonCode;
  readonly reason: string;
}

/** Deterministic detector for command/code execution risk */
export interface DangerousCommandDetector {
  evaluate(request: DangerousCommandRequest): DangerousCommandDecision;
}
