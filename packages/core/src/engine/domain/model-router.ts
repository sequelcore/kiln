import type { ExecutionBillingMode } from "../../agents/execution-identity.js";
import type {
  DeliberationIntent,
  DeliberationResolution,
  DeliberationSource,
} from "../../agents/deliberation-policy.js";

// Engine type: ModelRouter -- per-request model selection
// Pure TypeScript, zero external dependencies.

/** Routing tier describes how the model was selected */
export type RoutingTier = "rule" | "complexity" | "cascade" | "default";

/**
 * How a model route was selected for one turn.
 *
 * `automatic`: the runtime used its default provider/model or ran the model
 * router. It never honors an explicit gateway override silently. A `modelOverride`
 * supplied without valid explicit-operator provenance is ignored in automatic
 * mode and the routed/default provider is used instead.
 *
 * `explicit-operator-only`: the turn used a direct model override that carried
 * valid explicit operator provenance (`source: "operator"`). Only provenanced
 * explicit overrides may drive a non-automatic route.
 */
export type ModelSelectionMode = "automatic" | "explicit-operator-only";
export type ModelRoutingDiagnosticSeverity = "info" | "warning" | "error";

export interface ModelRoutingDiagnostic {
  readonly code: string;
  readonly severity: ModelRoutingDiagnosticSeverity;
  readonly message: string;
  readonly provider?: string;
  readonly model?: string;
}

export interface ModelRoutingRankingEvidence {
  readonly source: string;
  readonly task: string;
  readonly provider: string;
  readonly model: string;
  readonly rank: number;
  readonly sampleSize?: number;
  readonly confidence?: number;
  readonly expiresAt?: string;
}

export interface ModelRoutingPolicyInputsUsed {
  readonly tenantId: string;
  readonly complexityClass: ComplexityClass;
  readonly complexityScore: number;
  readonly hasTools: boolean;
  readonly toolCount: number;
  readonly requiresStreaming: boolean;
  readonly deliberationIntent?: DeliberationIntent;
  readonly task?: string;
  readonly phase?: "orient" | "plan" | "execute" | "verify" | "handoff";
  readonly uncertainty?: number;
  readonly verificationNeed?: number;
  readonly retryRisk?: number;
  readonly cacheInvalidationCostUsd?: number;
  readonly verifierCostUsd?: number;
}

export interface ModelRoutingRationale {
  readonly selectedProvider: string;
  readonly selectedModel: string;
  readonly canonicalModel?: string;
  readonly selectionMode: ModelSelectionMode;
  readonly deliberationResolution?: DeliberationResolution;
  readonly routingReason: string;
  readonly confidence: number;
  readonly routingTier: RoutingTier;
  readonly inputsUsed: ModelRoutingPolicyInputsUsed;
  readonly rankingEvidence: readonly ModelRoutingRankingEvidence[];
  readonly diagnostics: readonly ModelRoutingDiagnostic[];
  readonly overrideSource?: string;
}

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
  readonly deliberationIntent?: DeliberationIntent;
  readonly deliberationSource?: Exclude<DeliberationSource, "provider-default">;
  readonly task?: string;
  readonly phase?: "orient" | "plan" | "execute" | "verify" | "handoff";
  readonly uncertainty?: number;
  readonly verificationNeed?: number;
  readonly retryRisk?: number;
  readonly cacheInvalidationCostUsd?: number;
  readonly verifierCostUsd?: number;
  readonly rankingEvidence?: readonly ModelRoutingRankingEvidence[];
}

/** Output from the model router */
export interface RoutingDecision {
  readonly provider: string;
  readonly model: string;
  readonly canonicalModel?: string;
  readonly billingMode?: ExecutionBillingMode;
  readonly reasoning: string;
  readonly confidence: number;
  readonly routingTier: RoutingTier;
  readonly estimatedCostUsd?: number;
  readonly selectionMode?: ModelSelectionMode;
  readonly deliberationResolution?: DeliberationResolution;
  readonly rationale?: ModelRoutingRationale;
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
