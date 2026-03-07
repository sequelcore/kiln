// ToolResultSanitizer: wraps SafetyPipeline to sanitize tool execution results
// Includes optional indirect prompt injection scanning on tool results

import type { SafetyPipeline } from "./safety-pipeline.js";
import type { PromptScanner } from "../security/prompt-scanner.js";
import type { EventBus } from "../events/event-bus.js";
import type { SecurityAlertEvent } from "../events/index.js";

export interface SanitizationResult {
  readonly content: string;
  readonly sanitized: boolean;
  readonly blocked: boolean;
}

export interface ToolResultSanitizerConfig {
  readonly pipeline: SafetyPipeline;
  readonly promptScanner?: PromptScanner;
  readonly eventBus?: EventBus;
}

export class ToolResultSanitizer {
  private readonly pipeline: SafetyPipeline;
  private readonly promptScanner?: PromptScanner;
  private readonly eventBus?: EventBus;

  constructor(pipelineOrConfig: SafetyPipeline | ToolResultSanitizerConfig) {
    if ("evaluate" in pipelineOrConfig) {
      // Backward compat: plain SafetyPipeline
      this.pipeline = pipelineOrConfig;
    } else {
      this.pipeline = pipelineOrConfig.pipeline;
      this.promptScanner = pipelineOrConfig.promptScanner;
      this.eventBus = pipelineOrConfig.eventBus;
    }
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

      // Prompt injection scan on tool results (indirect injection defense)
      if (this.promptScanner) {
        try {
          const scanResult = this.promptScanner.scanHeuristic(result);
          if (!scanResult.safe) {
            const alertEvent: SecurityAlertEvent = {
              type: "security_alert",
              severity: "high",
              category: "indirect_injection",
              message: `Tool result contains injection patterns: ${scanResult.threats.map((t) => t.pattern).join(", ")}`,
              timestamp: new Date(),
              sessionId: "sanitizer",
            };
            this.eventBus?.emit(alertEvent);
            return {
              content: "[Tool result blocked: potential prompt injection detected]",
              sanitized: true,
              blocked: true,
            };
          }
        } catch {
          // Fail-open: if scanner throws, proceed with original result
        }
      }

      return { content: result, sanitized: false, blocked: false };
    } catch {
      // Fail-open: if pipeline throws, return original result
      return { content: result, sanitized: false, blocked: false };
    }
  }
}
