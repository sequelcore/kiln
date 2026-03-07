// ToolResultSanitizer: wraps SafetyPipeline to sanitize tool execution results

import type { SafetyPipeline } from "./safety-pipeline.js";

export interface SanitizationResult {
  readonly content: string;
  readonly sanitized: boolean;
  readonly blocked: boolean;
}

export class ToolResultSanitizer {
  private readonly pipeline: SafetyPipeline;

  constructor(pipeline: SafetyPipeline) {
    this.pipeline = pipeline;
  }

  async sanitize(result: string): Promise<SanitizationResult> {
    try {
      const evaluation = await this.pipeline.evaluate(result, "output");

      if (!evaluation.allowed) {
        return {
          content: evaluation.blockReason ?? "Tool result blocked by safety pipeline",
          sanitized: true,
          blocked: true,
        };
      }

      if (evaluation.redactedText) {
        return {
          content: evaluation.redactedText,
          sanitized: true,
          blocked: false,
        };
      }

      return { content: result, sanitized: false, blocked: false };
    } catch {
      // Fail-open: if pipeline throws, return original result
      return { content: result, sanitized: false, blocked: false };
    }
  }
}
