// Tool error classifier: categorizes tool execution errors for retry decisions

import type { ToolErrorType } from "../engine/domain/tool-execution.js";

/** Classify a tool execution error as validation, transient, or fatal */
export function classifyToolError(error: unknown): ToolErrorType {
  if (!(error instanceof Error)) return "fatal";

  const message = error.message.toLowerCase();

  // Check for HTTP status codes or known validation patterns
  if (
    message.includes("400") ||
    message.includes("422") ||
    message.includes("validation") ||
    message.includes("invalid") ||
    message.includes("bad request") ||
    message.includes("schema")
  ) {
    return "validation";
  }

  // Check for transient/retryable patterns
  if (
    message.includes("429") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("timeout") ||
    message.includes("rate limit") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("service unavailable") ||
    message.includes("gateway timeout") ||
    message.includes("too many requests")
  ) {
    return "transient";
  }

  return "fatal";
}
