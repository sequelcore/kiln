// Safety runtime types: result types for PII scanning, content classification, and policy rails

import type { PiiType, ContentCategory, RailType } from "../engine/domain/safety-config.js";

export interface PiiMatch {
  readonly type: PiiType;
  readonly value: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface PiiScanResult {
  readonly matches: readonly PiiMatch[];
  readonly tier: "heuristic";
  readonly scannedAt: Date;
}

export interface ContentScore {
  readonly category: ContentCategory;
  readonly confidence: number;
}

export interface ContentClassificationResult {
  readonly scores: readonly ContentScore[];
  readonly tier: "heuristic";
  readonly scannedAt: Date;
}

export interface PolicyResult {
  readonly allowed: boolean;
  readonly railType: RailType;
  readonly reason?: string;
  readonly suggestion?: string;
  readonly escalate?: boolean;
}

export type SafetyDirection = "input" | "output";

export interface SafetyPipelineResult {
  readonly allowed: boolean;
  readonly redactedText?: string;
  readonly pii?: PiiScanResult;
  readonly content?: ContentClassificationResult;
  readonly policyResults: readonly PolicyResult[];
  readonly blockReason?: string;
}
