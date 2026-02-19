// Engine type: Delegation -- cross-app cognitive delegation (Phase 24)

import type { Capability } from "../domain/capability.js";

/** Error codes for delegation failures */
export type DelegationErrorCode =
  | "TIMEOUT"
  | "SCHEMA_VALIDATION_FAILED"
  | "TARGET_APP_NOT_FOUND"
  | "TARGET_APP_NOT_READY"
  | "PROVIDER_ERROR";

/** A cross-app delegation request */
export interface AppDelegation {
  readonly fromApp: string;
  readonly toApp: string;
  readonly task: string;
  readonly schema: Record<string, unknown>; // JSON Schema for expected response
  readonly context?: string;
  readonly priority?: number; // 0-10, default 5
  readonly timeout?: number;  // ms, default 120_000
}

/** Token usage reported after a delegation call */
export interface DelegationTokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

/** Successful result of a delegation call */
export interface AppDelegationResult {
  readonly delegationId: string;
  readonly fromApp: string;
  readonly toApp: string;
  readonly result: Record<string, unknown>;
  readonly tokenUsage: DelegationTokenUsage;
  readonly durationMs: number;
}

/** Error returned when a delegation call fails */
export interface DelegationError {
  readonly code: DelegationErrorCode;
  readonly message: string;
  readonly delegationId?: string;
  readonly fromApp?: string;
  readonly toApp?: string;
}

/** Validation error for an AppDelegation */
export interface DelegationValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Type guard: returns true when the capability is a delegation capability.
 * Requires type === "delegation", non-empty targetApp, and non-empty task.
 */
export function isDelegationCapability(cap: Capability): boolean {
  return (
    cap.type === "delegation" &&
    typeof cap.targetApp === "string" &&
    cap.targetApp !== "" &&
    typeof cap.task === "string" &&
    cap.task !== ""
  );
}

/**
 * Validate an AppDelegation. Returns an array of errors; empty means valid.
 */
export function validateDelegation(delegation: AppDelegation): DelegationValidationError[] {
  const errors: DelegationValidationError[] = [];

  if (!delegation.fromApp || delegation.fromApp === "") {
    errors.push({ field: "fromApp", message: "must be a non-empty string" });
  }

  if (!delegation.toApp || delegation.toApp === "") {
    errors.push({ field: "toApp", message: "must be a non-empty string" });
  }

  if (
    delegation.fromApp &&
    delegation.toApp &&
    delegation.fromApp !== "" &&
    delegation.toApp !== "" &&
    delegation.fromApp === delegation.toApp
  ) {
    errors.push({ field: "toApp", message: "self-delegation is not allowed (fromApp === toApp)" });
  }

  if (!delegation.task || delegation.task === "") {
    errors.push({ field: "task", message: "must be a non-empty string" });
  }

  if (
    delegation.schema === null ||
    delegation.schema === undefined ||
    typeof delegation.schema !== "object" ||
    Array.isArray(delegation.schema)
  ) {
    errors.push({ field: "schema", message: "must be a non-null, non-array object" });
  }

  if (delegation.timeout !== undefined && delegation.timeout <= 0) {
    errors.push({ field: "timeout", message: "must be greater than 0" });
  }

  if (delegation.priority !== undefined && (delegation.priority < 0 || delegation.priority > 10)) {
    errors.push({ field: "priority", message: "must be between 0 and 10" });
  }

  return errors;
}
