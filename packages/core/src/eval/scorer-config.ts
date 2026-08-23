/** Configuration consumed by the Eval scorer factory. */
export type EvalScorerType =
  | "exact-match"
  | "contains"
  | "json-validity"
  | "length"
  | "latency"
  | "cost"
  | "faithfulness"
  | "relevance"
  | "coherence"
  | "hallucination"
  | "toxicity"
  | "custom-prompt"
  | "composite"
  | "policy-adherence"
  | "context-relevance"
  | "effort"
  | "resolution"
  | "tool-trajectory"
  | "tool-calling-accuracy"
  | "multi-turn-consistency"
  | "safety-preservation"
  | "routing-accuracy"
  | "handoff-quality"
  | "milestone";

export interface EvalScorerConfig {
  readonly name: string;
  readonly type: EvalScorerType;
  readonly scorers?: readonly EvalScorerConfig[];
  readonly schema?: Record<string, unknown>;
  readonly prompt?: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly maxLatencyMs?: number;
  readonly maxCostUsd?: number;
  readonly substrings?: readonly string[];
  readonly policies?: readonly string[];
}
