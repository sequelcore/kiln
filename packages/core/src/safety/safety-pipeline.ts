// Safety Pipeline: orchestrates PII scanning, content classification, and policy rails

import type { SafetyConfig } from "../engine/domain/safety-config.js";
import type { SafetyDirection, SafetyPipelineResult, PolicyResult } from "./types.js";
import { PiiScanner } from "./pii-scanner.js";
import type { PiiDeepScanProvider } from "./pii-scanner.js";
import { ContentClassifier } from "./content-classifier.js";
import type { ContentDeepScanProvider } from "./content-classifier.js";
import { createRail } from "./rails.js";
import type { PolicyRail } from "./rails.js";

export interface SafetyPipelineOptions {
  readonly piiProvider?: PiiDeepScanProvider;
  readonly contentProvider?: ContentDeepScanProvider;
}

export class SafetyPipeline {
  private readonly config: SafetyConfig;
  private readonly piiScanner?: PiiScanner;
  private readonly contentClassifier?: ContentClassifier;
  private readonly rails: readonly PolicyRail[];

  constructor(config: SafetyConfig) {
    this.config = config;

    if (config.pii) {
      this.piiScanner = new PiiScanner(config.pii);
    }

    if (config.content?.enabled) {
      this.contentClassifier = new ContentClassifier(config.content);
    }

    this.rails = (config.rails ?? []).map(createRail);
  }

  /**
   * Evaluate text through the full safety pipeline.
   * Order: PII scan -> content classification -> policy rails.
   * Short-circuits on block: if PII blocks, content/rails don't run.
   * Redacted text carries forward through subsequent steps.
   */
  async evaluate(
    text: string,
    direction: SafetyDirection,
    options?: SafetyPipelineOptions,
  ): Promise<SafetyPipelineResult> {
    let currentText = text;
    const policyResults: PolicyResult[] = [];

    // 1. PII scan
    if (this.piiScanner) {
      const piiResult = await this.piiScanner.scan(currentText, options?.piiProvider);

      if (piiResult.matches.length > 0) {
        const action = this.config.pii!.action;

        if (action === "block") {
          return {
            allowed: false,
            pii: piiResult,
            policyResults: [],
            blockReason: `PII detected: ${piiResult.matches.map((m) => m.type).join(", ")}`,
          };
        }

        if (action === "redact") {
          currentText = this.piiScanner.redact(currentText, piiResult.matches);
          const result = await this.evaluateContentAndRails(currentText, direction, options, policyResults);
          return {
            ...result,
            redactedText: currentText,
            pii: piiResult,
          };
        }

        // action === "detect" -- just record, continue with original text
        const result = await this.evaluateContentAndRails(currentText, direction, options, policyResults);
        return { ...result, pii: piiResult };
      }
    }

    // No PII found or no PII config -- continue to content + rails
    return this.evaluateContentAndRails(currentText, direction, options, policyResults);
  }

  private async evaluateContentAndRails(
    text: string,
    direction: SafetyDirection,
    options: SafetyPipelineOptions | undefined,
    policyResults: PolicyResult[],
  ): Promise<SafetyPipelineResult> {
    // 2. Content classification
    let contentResult;
    if (this.contentClassifier) {
      contentResult = await this.contentClassifier.classify(text, options?.contentProvider);
      const violations = this.contentClassifier.evaluateThresholds(contentResult.scores);

      const blocked = violations.some((v) => v.action === "block");
      if (blocked) {
        return {
          allowed: false,
          content: contentResult,
          policyResults,
          blockReason: `Content policy violated: ${violations.filter((v) => v.action === "block").map((v) => v.category).join(", ")}`,
        };
      }
    }

    // 3. Policy rails -- evaluate all, short-circuit on first block
    for (const rail of this.rails) {
      const result = rail.evaluate(text, direction);
      policyResults.push(result);

      if (!result.allowed) {
        return {
          allowed: false,
          content: contentResult,
          policyResults,
          blockReason: result.reason ?? `Blocked by ${result.railType} rail`,
        };
      }
    }

    return {
      allowed: true,
      ...(contentResult ? { content: contentResult } : {}),
      policyResults,
    };
  }
}
