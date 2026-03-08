import { describe, it, expect } from "vitest";
import { RulesRouter } from "../../src/agents/rules-router.js";
import { ModelCapabilityRegistry } from "../../src/agents/model-capability-registry.js";
import type { RoutingRule, RoutingRequest, ComplexityScore } from "../../src/engine/domain/model-router.js";

function makeComplexity(score: number): ComplexityScore {
  return {
    score,
    class: score < 0.2 ? "trivial" : score < 0.4 ? "simple" : score < 0.6 ? "moderate" : score < 0.8 ? "complex" : "expert",
    signals: {
      tokenCount: 100,
      hasTools: false,
      toolCount: 0,
      hasCodeBlocks: false,
      hasReasoningMarkers: false,
      turnDepth: 0,
    },
  };
}

function makeRequest(overrides: Partial<RoutingRequest> = {}): RoutingRequest {
  return {
    tenantId: "tenant-1",
    complexity: makeComplexity(0.3),
    hasTools: false,
    toolCount: 0,
    requiresStreaming: false,
    ...overrides,
  };
}

describe("RulesRouter", () => {
  const registry = new ModelCapabilityRegistry();
  const defaultTarget = { provider: "anthropic", model: "claude-sonnet-4-6" };

  it("matching rule returns correct target", () => {
    const rules: RoutingRule[] = [
      { name: "always-haiku", priority: 1, condition: { type: "always" }, target: { provider: "anthropic", model: "claude-haiku-4-5-20251001" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);
    const decision = router.route(makeRequest());
    expect(decision.provider).toBe("anthropic");
    expect(decision.model).toBe("claude-haiku-4-5-20251001");
    expect(decision.routingTier).toBe("rule");
    expect(decision.reasoning).toContain("always-haiku");
  });

  it("priority ordering (lower priority number wins)", () => {
    const rules: RoutingRule[] = [
      { name: "low-priority", priority: 10, condition: { type: "always" }, target: { provider: "openai", model: "gpt-4o" } },
      { name: "high-priority", priority: 1, condition: { type: "always" }, target: { provider: "anthropic", model: "claude-haiku-4-5-20251001" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);
    const decision = router.route(makeRequest());
    expect(decision.model).toBe("claude-haiku-4-5-20251001");
    expect(decision.reasoning).toContain("high-priority");
  });

  it("no match returns default", () => {
    const rules: RoutingRule[] = [
      { name: "tools-only", priority: 1, condition: { type: "has_tools" }, target: { provider: "openai", model: "gpt-4o" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);
    const decision = router.route(makeRequest({ hasTools: false }));
    expect(decision.provider).toBe("anthropic");
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.routingTier).toBe("default");
  });

  it("has_tools condition", () => {
    const rules: RoutingRule[] = [
      { name: "tools-rule", priority: 1, condition: { type: "has_tools" }, target: { provider: "openai", model: "gpt-4o" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    const withTools = router.route(makeRequest({ hasTools: true }));
    expect(withTools.model).toBe("gpt-4o");

    const withoutTools = router.route(makeRequest({ hasTools: false }));
    expect(withoutTools.model).toBe("claude-sonnet-4-6");
  });

  it("complexity_above condition", () => {
    const rules: RoutingRule[] = [
      { name: "complex", priority: 1, condition: { type: "complexity_above", threshold: 0.5 }, target: { provider: "anthropic", model: "claude-opus-4-6" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    const high = router.route(makeRequest({ complexity: makeComplexity(0.7) }));
    expect(high.model).toBe("claude-opus-4-6");

    const low = router.route(makeRequest({ complexity: makeComplexity(0.3) }));
    expect(low.model).toBe("claude-sonnet-4-6");
  });

  it("budget_below_cents condition", () => {
    const rules: RoutingRule[] = [
      { name: "budget", priority: 1, condition: { type: "budget_below_cents", cents: 100 }, target: { provider: "openai", model: "gpt-4o-mini" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    const lowBudget = router.route(makeRequest({ budgetRemainingCents: 50 }));
    expect(lowBudget.model).toBe("gpt-4o-mini");

    const highBudget = router.route(makeRequest({ budgetRemainingCents: 200 }));
    expect(highBudget.model).toBe("claude-sonnet-4-6");

    // No budget info -> condition false
    const noBudget = router.route(makeRequest());
    expect(noBudget.model).toBe("claude-sonnet-4-6");
  });

  it("agent_tier condition", () => {
    const rules: RoutingRule[] = [
      { name: "fast", priority: 1, condition: { type: "agent_tier", tier: "fast" }, target: { provider: "openai", model: "gpt-4o-mini" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    const fast = router.route(makeRequest({ agentTier: "fast" }));
    expect(fast.model).toBe("gpt-4o-mini");

    const reasoning = router.route(makeRequest({ agentTier: "reasoning" }));
    expect(reasoning.model).toBe("claude-sonnet-4-6");
  });

  it("agent_id condition", () => {
    const rules: RoutingRule[] = [
      { name: "specific-agent", priority: 1, condition: { type: "agent_id", agentId: "sales" }, target: { provider: "openai", model: "gpt-4o" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    const match = router.route(makeRequest({ agentId: "sales" }));
    expect(match.model).toBe("gpt-4o");

    const noMatch = router.route(makeRequest({ agentId: "support" }));
    expect(noMatch.model).toBe("claude-sonnet-4-6");
  });

  it("always condition matches everything", () => {
    const rules: RoutingRule[] = [
      { name: "always", priority: 1, condition: { type: "always" }, target: { provider: "openai", model: "gpt-4o-mini" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);
    const decision = router.route(makeRequest());
    expect(decision.model).toBe("gpt-4o-mini");
    expect(decision.routingTier).toBe("rule");
  });

  it("skips rule when target model lacks required capabilities", () => {
    // deepseek-reasoner doesn't support tools
    const rules: RoutingRule[] = [
      { name: "use-reasoner", priority: 1, condition: { type: "always" }, target: { provider: "deepseek", model: "deepseek-reasoner" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    // Request requires tools -> deepseek-reasoner is skipped -> falls through to default
    const decision = router.route(makeRequest({ hasTools: true }));
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.routingTier).toBe("default");
  });

  it("skips rule when target model lacks streaming support", () => {
    // o3 doesn't support streaming
    const rules: RoutingRule[] = [
      { name: "use-o3", priority: 1, condition: { type: "always" }, target: { provider: "openai", model: "o3" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);

    const decision = router.route(makeRequest({ requiresStreaming: true }));
    expect(decision.model).toBe("claude-sonnet-4-6");
    expect(decision.routingTier).toBe("default");
  });

  it("confidence is always 1.0", () => {
    const rules: RoutingRule[] = [
      { name: "test", priority: 1, condition: { type: "always" }, target: { provider: "openai", model: "gpt-4o" } },
    ];
    const router = new RulesRouter(rules, defaultTarget, registry);
    const decision = router.route(makeRequest());
    expect(decision.confidence).toBe(1.0);
  });
});
