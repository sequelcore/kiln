// Rules-based model router: evaluates conditions in priority order, returns first match
// Validates target model capabilities before selecting

import type { ModelRouter, RoutingRequest, RoutingDecision, RoutingRule } from "../engine/domain/model-router.js";
import type { ModelCapabilityRegistry } from "./model-capability-registry.js";

export class RulesRouter implements ModelRouter {
  private readonly rules: readonly RoutingRule[];
  private readonly defaultTarget: { readonly provider: string; readonly model: string };
  private readonly registry: ModelCapabilityRegistry;

  constructor(
    rules: readonly RoutingRule[],
    defaultTarget: { readonly provider: string; readonly model: string },
    registry: ModelCapabilityRegistry,
  ) {
    this.rules = [...rules].sort((a, b) => a.priority - b.priority);
    this.defaultTarget = defaultTarget;
    this.registry = registry;
  }

  route(request: RoutingRequest): RoutingDecision {
    for (const rule of this.rules) {
      if (this.evaluateCondition(rule.condition, request)) {
        // Validate target model has required capabilities
        const profile = this.registry.get(rule.target.model);
        if (
          profile &&
          (!request.hasTools || profile.supportsTools) &&
          (!request.requiresStreaming || profile.supportsStreaming)
        ) {
          return {
            provider: rule.target.provider,
            model: rule.target.model,
            reasoning: `Rule "${rule.name}" matched`,
            confidence: 1.0,
            routingTier: "rule",
            estimatedCostUsd: undefined,
          };
        }
        // Skip rule if target model doesn't support required capabilities
      }
    }

    return {
      provider: this.defaultTarget.provider,
      model: this.defaultTarget.model,
      reasoning: "No rules matched, using default",
      confidence: 1.0,
      routingTier: "default",
    };
  }

  private evaluateCondition(condition: RoutingRule["condition"], request: RoutingRequest): boolean {
    switch (condition.type) {
      case "has_tools":
        return request.hasTools;
      case "complexity_above":
        return request.complexity.score > condition.threshold;
      case "complexity_below":
        return request.complexity.score < condition.threshold;
      case "budget_below_cents":
        return request.budgetRemainingCents !== undefined && request.budgetRemainingCents < condition.cents;
      case "agent_tier":
        return request.agentTier === condition.tier;
      case "agent_id":
        return request.agentId === condition.agentId;
      case "always":
        return true;
    }
  }
}
