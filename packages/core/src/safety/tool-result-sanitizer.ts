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

const PERSISTED_EVIDENCE_SANITIZATION_FAILURE_MESSAGE =
  "Tool result withheld: safety verification could not be completed for persisted evidence.";

export class ToolResultSanitizer {
  private readonly pipeline: SafetyPipeline;
  private readonly promptScanner?: PromptScanner;
  private readonly eventBus?: EventBus;

  constructor(config: ToolResultSanitizerConfig) {
    this.pipeline = config.pipeline;
    this.promptScanner = config.promptScanner;
    this.eventBus = config.eventBus;
  }

  /**
   * Best-effort sanitization: on scanner/pipeline failure, the original
   * result is returned unchanged (fail-open). Suitable for ephemeral
   * reinjection into a live conversation where the model can be asked to
   * re-derive the result on a subsequent turn if this one is wrong.
   */
  async sanitize(result: string): Promise<SanitizationResult> {
    try {
      const pipelineResult = await this.evaluateAndRedact(result);
      if (pipelineResult) {
        return pipelineResult;
      }
      try {
        const scanResult = this.scanForInjection(result);
        if (scanResult) {
          return scanResult;
        }
      } catch {
        // Fail-open: if scanner throws, proceed with original result
      }
      return { content: result, sanitized: false, blocked: false };
    } catch {
      // Fail-open: if pipeline throws, return original result
      return { content: result, sanitized: false, blocked: false };
    }
  }

  /**
   * Fail-CLOSED sanitization for content that will be written as canonical,
   * durable evidence (e.g. a failed external-tool result recorded on a work
   * item or persisted transcript). Unlike `sanitize()`, this never returns
   * the original, unscanned content: a pipeline or scanner failure produces
   * a fixed safe diagnostic instead, with `sanitized`/`blocked` set so
   * callers can tell degradation happened.
   */
  async sanitizeForPersistedEvidence(result: string): Promise<SanitizationResult> {
    try {
      const pipelineResult = await this.evaluateAndRedact(result);
      if (pipelineResult) {
        return pipelineResult;
      }
      try {
        const scanResult = this.scanForInjection(result);
        if (scanResult) {
          return scanResult;
        }
      } catch {
        return this.persistedEvidenceFailureResult();
      }
      return { content: result, sanitized: false, blocked: false };
    } catch {
      return this.persistedEvidenceFailureResult();
    }
  }

  private async evaluateAndRedact(result: string): Promise<SanitizationResult | undefined> {
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

    return undefined;
  }

  // Prompt injection scan on tool results (indirect injection defense)
  private scanForInjection(result: string): SanitizationResult | undefined {
    if (!this.promptScanner) {
      return undefined;
    }
    const scanResult = this.promptScanner.scanHeuristic(result);
    if (scanResult.safe) {
      return undefined;
    }
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

  private persistedEvidenceFailureResult(): SanitizationResult {
    return {
      content: PERSISTED_EVIDENCE_SANITIZATION_FAILURE_MESSAGE,
      sanitized: true,
      blocked: true,
    };
  }
}
