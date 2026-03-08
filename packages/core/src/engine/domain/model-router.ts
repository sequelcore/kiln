// Engine type: ModelRouter -- per-request model selection
// Pure TypeScript, zero external dependencies.

/** Routing tier describes how the model was selected */
export type RoutingTier = "rule" | "complexity" | "cascade" | "default";

/** Complexity class derived from complexity score */
export type ComplexityClass = "trivial" | "simple" | "moderate" | "complex" | "expert";

/** Static capability profile for a model */
export interface ModelCapabilityProfile {
  readonly provider: string;
  readonly model: string;
  readonly supportsTools: boolean;
  readonly supportsStreaming: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsVision: boolean;
  readonly supportsAudio: boolean;
  readonly maxContextTokens: number;
  readonly qualityTier: "high" | "medium" | "low";
  readonly inputPer1M: number;
  readonly outputPer1M: number;
}

/** Complexity scoring output */
export interface ComplexityScore {
  readonly score: number; // 0-1
  readonly class: ComplexityClass;
  readonly signals: {
    readonly tokenCount: number;
    readonly hasTools: boolean;
    readonly toolCount: number;
    readonly hasCodeBlocks: boolean;
    readonly hasReasoningMarkers: boolean;
    readonly turnDepth: number;
  };
}

/** Input to the model router */
export interface RoutingRequest {
  readonly tenantId: string;
  readonly agentId?: string;
  readonly agentTier?: "reasoning" | "coding" | "fast";
  readonly complexity: ComplexityScore;
  readonly hasTools: boolean;
  readonly toolCount: number;
  readonly requiresStreaming: boolean;
  readonly budgetRemainingCents?: number;
}

/** Output from the model router */
export interface RoutingDecision {
  readonly provider: string;
  readonly model: string;
  readonly reasoning: string;
  readonly confidence: number;
  readonly routingTier: RoutingTier;
  readonly estimatedCostUsd?: number;
}

/** Routing condition types for rules-based routing */
export type RoutingCondition =
  | { readonly type: "has_tools" }
  | { readonly type: "complexity_above"; readonly threshold: number }
  | { readonly type: "complexity_below"; readonly threshold: number }
  | { readonly type: "budget_below_cents"; readonly cents: number }
  | { readonly type: "agent_tier"; readonly tier: "fast" | "coding" | "reasoning" }
  | { readonly type: "agent_id"; readonly agentId: string }
  | { readonly type: "always" };

/** A single routing rule */
export interface RoutingRule {
  readonly name: string;
  readonly priority: number; // lower = higher priority
  readonly condition: RoutingCondition;
  readonly target: { readonly provider: string; readonly model: string };
}

/** Model router interface */
export interface ModelRouter {
  route(request: RoutingRequest): RoutingDecision;
}
