// Engine primitive: Capability -- an MCP tool that agents can invoke

import type { RetryConfig } from "./tool-execution.js";
import type { ActionEffectEnvelope } from "./action-effect.js";

/** An MCP/runtime capability with schema, tags, and canonical effect declaration. */
export interface Capability {
  readonly name: string;
  readonly description: string;
  readonly schema: Record<string, unknown>;
  readonly tags: readonly string[];
  readonly effectEnvelope?: ActionEffectEnvelope;
  /** Cache TTL in seconds. 0 = no cache, Infinity = permanent. */
  readonly cacheTtl?: number;
  readonly type?: string;                          // "delegation" | "handoff"
  readonly targetApp?: string;                     // target app name in the gateway
  readonly task?: string;                          // task description sent to target
  readonly timeout?: number;                       // timeout in seconds
  readonly guardrail?: string;                     // Guardrail function name or JSON Schema reference
  readonly guardrailRetries?: number;              // Max retries on guardrail failure (default: 3)
  readonly outputSchema?: Record<string, unknown>; // JSON Schema for structured output validation
  readonly retry?: RetryConfig;                    // Retry/fallback config for tool execution errors
}
