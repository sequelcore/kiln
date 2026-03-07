// Tool execution engine: retry, timeout, fallback wrapper for tool calls

import type { RetryConfig, ToolExecutionResult } from "../engine/domain/tool-execution.js";
import { KilnError } from "../engine/errors.js";
import { classifyToolError } from "./tool-error-classifier.js";

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BACKOFF_MS = 10_000;

export type ToolExecutor = (toolName: string, input: Record<string, unknown>) => Promise<unknown>;

export async function executeWithRetry(
  toolName: string,
  input: Record<string, unknown>,
  executor: ToolExecutor,
  retryConfig?: RetryConfig,
  fallbackExecutor?: ToolExecutor,
): Promise<ToolExecutionResult> {
  const maxAttempts = retryConfig?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = retryConfig?.timeout ? retryConfig.timeout * 1000 : DEFAULT_TIMEOUT_MS;
  const startMs = Date.now();

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await executeWithTimeout(executor, toolName, input, timeoutMs);
      return {
        result,
        attempts: attempt,
        durationMs: Date.now() - startMs,
        fallbackUsed: false,
      };
    } catch (err) {
      lastError = err;

      // Timeout errors: propagate directly (don't classify as transient for retry)
      if (err instanceof KilnError && err.code === "TOOL_EXECUTION_TIMEOUT") {
        break;
      }

      const errorType = classifyToolError(err);

      // mutate_params strategy: re-throw immediately to let LLM correct input
      if (errorType === "validation" && retryConfig?.onValidationError === "mutate_params") {
        throw err;
      }

      // Fatal errors: no retry
      if (errorType === "fatal") break;

      // Last attempt: break to try fallback
      if (attempt === maxAttempts) break;

      // Determine if we should retry based on error type and config
      const strategy = errorType === "validation"
        ? retryConfig?.onValidationError
        : retryConfig?.onTransientError;

      if (!strategy || strategy === "mutate_params") {
        // mutate_params for transient doesn't make sense, re-throw
        throw err;
      }

      // Exponential backoff
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      await sleep(backoffMs);
    }
  }

  // Propagate timeout errors directly
  if (lastError instanceof KilnError && lastError.code === "TOOL_EXECUTION_TIMEOUT") {
    throw lastError;
  }

  // All retries exhausted -- try fallback if configured
  if (retryConfig?.fallback && fallbackExecutor) {
    try {
      const result = await executeWithTimeout(fallbackExecutor, retryConfig.fallback, input, timeoutMs);
      return {
        result,
        attempts: maxAttempts,
        durationMs: Date.now() - startMs,
        fallbackUsed: true,
      };
    } catch {
      // Fallback also failed
    }
  }

  throw new KilnError("TOOL_RETRY_EXHAUSTED", `Tool "${toolName}" failed after ${maxAttempts} attempts`, {
    context: { toolName, attempts: maxAttempts },
    retryable: false,
  });
}

async function executeWithTimeout(
  executor: ToolExecutor,
  toolName: string,
  input: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const result = await Promise.race([
      executor(toolName, input),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new KilnError("TOOL_EXECUTION_TIMEOUT", `Tool "${toolName}" timed out after ${timeoutMs}ms`, {
            context: { toolName, timeoutMs },
            retryable: true,
          }));
        });
      }),
    ]);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
