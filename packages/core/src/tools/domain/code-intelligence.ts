import type { CodeIntelligenceOperation } from "./tool-result-metadata.js";

export type { CodeIntelligenceOperation };

export interface CodeIntelligencePosition {
  readonly line: number;
  readonly character: number;
}

export interface CodeIntelligenceRange {
  readonly start: CodeIntelligencePosition;
  readonly end: CodeIntelligencePosition;
}

export interface CodeIntelligenceEntry {
  readonly kind:
    | "location"
    | "hover"
    | "symbol"
    | "diagnostic"
    | "call";
  readonly path?: string;
  readonly range?: CodeIntelligenceRange;
  readonly symbol?: string;
  readonly detail?: string;
  readonly severity?: "error" | "warning" | "information" | "hint";
}

export interface CodeIntelligenceRequest {
  readonly operation: CodeIntelligenceOperation;
  readonly workspaceRoot: string;
  readonly path?: string;
  readonly position?: CodeIntelligencePosition;
  readonly query?: string;
  readonly symbol?: string;
  readonly limit: number;
}

export interface CodeIntelligenceResult {
  readonly operation: CodeIntelligenceOperation;
  readonly language?: string;
  readonly entries: readonly CodeIntelligenceEntry[];
}

export interface CodeIntelligenceAdapter {
  readonly name: string;
  query(request: CodeIntelligenceRequest): Promise<CodeIntelligenceResult>;
}
