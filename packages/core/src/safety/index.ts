// Safety bounded context: PII detection, content classification, policy rails

// Types
export type {
  PiiMatch,
  PiiScanResult,
  ContentScore,
  ContentClassificationResult,
  PolicyResult,
  SafetyDirection,
  SafetyPipelineResult,
} from "./types.js";

// PII Scanner
export { PiiScanner, PII_PATTERNS } from "./pii-scanner.js";

// Content Classifier
export { ContentClassifier, CONTENT_PATTERNS } from "./content-classifier.js";

// Policy Rails
export { TopicRail, CompetitorRail, EscalationRail, ComplianceRail, createRail } from "./rails.js";
export type { PolicyRail } from "./rails.js";

// Safety Pipeline
export { SafetyPipeline } from "./safety-pipeline.js";
export type { SafetyMetrics } from "./safety-pipeline.js";

// Tool Result Sanitizer
export { ToolResultSanitizer } from "./tool-result-sanitizer.js";
export type { SanitizationResult, ToolResultSanitizerConfig } from "./tool-result-sanitizer.js";
