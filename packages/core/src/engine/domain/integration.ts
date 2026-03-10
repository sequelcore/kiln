// Engine domain: Integration adapter interfaces
// Pure TypeScript, zero external dependencies

import type { CapabilityAnnotations } from "./capability.js";

/** Resolved credential for third-party API authentication */
export interface ResolvedCredential {
  readonly type: "bearer" | "api_key" | "basic" | "custom";
  readonly value: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly expiresAt?: Date;
}

/** Resolves encrypted credential references to usable credentials at execution time */
export interface CredentialResolver {
  resolve(tenantId: string, credentialKey: string): Promise<ResolvedCredential>;
  invalidate(tenantId: string, credentialKey: string): void;
}

/** A single operation exposed by an integration adapter */
export interface IntegrationOperation {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations?: CapabilityAnnotations;
}

/** Execution options passed to adapter on each call */
export interface ExecutionOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

/** Result returned by an adapter after executing an operation */
export interface IntegrationResult {
  readonly data: unknown;
  readonly metadata?: IntegrationResultMetadata;
}

/** Optional metadata about the execution (latency, rate limits, cost) */
export interface IntegrationResultMetadata {
  readonly durationMs: number;
  readonly rateLimitRemaining?: number;
  readonly costUsd?: number;
}

/**
 * Contract for third-party API adapters.
 *
 * Each adapter is a separate npm package implementing this interface.
 * The adapter imports ONLY types from @kilnai/core — zero runtime dependency on Kiln.
 */
export interface IntegrationAdapter {
  readonly provider: string;
  readonly version: string;
  readonly operations: readonly IntegrationOperation[];
  execute(
    operation: string,
    credentials: ResolvedCredential,
    input: Record<string, unknown>,
    options?: ExecutionOptions,
  ): Promise<IntegrationResult>;
}
