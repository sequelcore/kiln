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

export interface SafetyMetrics {
  readonly scansInput: number;
  readonly scansOutput: number;
  readonly blocksInput: number;
  readonly blocksOutput: number;
  readonly piiDetections: number;
  readonly contentBlocks: number;
  readonly policyEvaluations: number;
}

export class SafetyPipeline {
  private readonly config: SafetyConfig;
  private readonly piiScanner?: PiiScanner;
  private readonly contentClassifier?: ContentClassifier;
  private readonly rails: readonly PolicyRail[];

  private _scansInput = 0;
  private _scansOutput = 0;
  private _blocksInput = 0;
  private _blocksOutput = 0;
  private _piiDetections = 0;
  private _contentBlocks = 0;
  private _policyEvaluations = 0;

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

  get metrics(): SafetyMetrics {
    return {
      scansInput: this._scansInput,
      scansOutput: this._scansOutput,
      blocksInput: this._blocksInput,
      blocksOutput: this._blocksOutput,
      piiDetections: this._piiDetections,
      contentBlocks: this._contentBlocks,
      policyEvaluations: this._policyEvaluations,
    };
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
    if (direction === "input") {
      this._scansInput++;
    } else {
      this._scansOutput++;
    }

    let currentText = text;
    const policyResults: PolicyResult[] = [];

    // 1. PII scan
    if (this.piiScanner) {
      const piiResult = await this.piiScanner.scan(currentText, options?.piiProvider);

      if (piiResult.matches.length > 0) {
        this._piiDetections++;
        const action = this.config.pii!.action;

        if (action === "block") {
          if (direction === "input") {
            this._blocksInput++;
          } else {
            this._blocksOutput++;
          }
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
          if (!result.allowed) {
            if (direction === "input") {
              this._blocksInput++;
            } else {
              this._blocksOutput++;
            }
          }
          return {
            ...result,
            redactedText: currentText,
            pii: piiResult,
          };
        }

        // action === "detect" -- just record, continue with original text
        const result = await this.evaluateContentAndRails(currentText, direction, options, policyResults);
        if (!result.allowed) {
          if (direction === "input") {
            this._blocksInput++;
          } else {
            this._blocksOutput++;
          }
        }
        return { ...result, pii: piiResult };
      }
    }

    // No PII found or no PII config -- continue to content + rails
    const result = await this.evaluateContentAndRails(currentText, direction, options, policyResults);
    if (!result.allowed) {
      if (direction === "input") {
        this._blocksInput++;
      } else {
        this._blocksOutput++;
      }
    }
    return result;
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
        this._contentBlocks++;
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
      this._policyEvaluations++;
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
