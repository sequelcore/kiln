import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProviderAdapter, ModelRouter, RoutingDecision, RoutingRequest } from "@kilnai/core";
import { textParts } from "@kilnai/core";
import { ModeBOrchestrator } from "../../src/session/mode-b-orchestrator.js";
import { ModeBSession } from "../../src/session/mode-b-session.js";

function makeProvider(name = "mock"): ProviderAdapter {
  return {
    name,
    createMessage: vi.fn().mockResolvedValue({
      parts: textParts("mock response"),
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "end_turn",
    }),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

function makeSession(systemPrompt = "You are helpful."): ModeBSession {
  return new ModeBSession({ appName: "app", tenantId: "test-tenant", userId: "user-1", systemPrompt });
}

function makeRouter(decision: RoutingDecision): ModelRouter {
  return {
    route: vi.fn().mockReturnValue(decision),
  };
}

describe("ModeBOrchestrator model routing", () => {
  let defaultProvider: ProviderAdapter;

  beforeEach(() => {
    defaultProvider = makeProvider("default");
  });

  it("without modelRouter, uses default provider", async () => {
    const orchestrator = new ModeBOrchestrator({ provider: defaultProvider });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    expect(defaultProvider.createMessage).toHaveBeenCalled();
    expect(result.routingDecision).toBeUndefined();
  });

  it("with modelRouter, uses routed provider from pool", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Test rule matched",
      confidence: 1.0,
      routingTier: "rule",
    });

    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    expect(routedProvider.createMessage).toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("routed");
    expect(result.routingDecision!.model).toBe("routed-model");
    expect(result.routingDecision!.routingTier).toBe("rule");
    expect(result.routingDecision!.reasoning).toBe("Test rule matched");
  });

  it("injects routed execution identity when router-selected provider is applied", async () => {
    const routedProvider = makeProvider("routed");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Test route",
      confidence: 1.0,
      routingTier: "rule",
    });

    const providerPool = new Map<string, ProviderAdapter>([["routed", routedProvider]]);

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    await orchestrator.processMessage(session, textParts("hello"));

    const routedCall = (routedProvider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
    } | undefined;

    expect(routedCall?.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(routedCall?.system).toContain("provider: routed");
    expect(routedCall?.system).toContain("model: routed-model");
    expect(routedCall?.system).toContain("source: runtime-routed");
    expect(routedCall?.system).not.toContain("model: configured-model");
  });

  it("with modelRouter but unknown provider, falls back to default provider", async () => {
    const router = makeRouter({
      provider: "unknown-provider",
      model: "unknown-model",
      reasoning: "No pool match",
      confidence: 1.0,
      routingTier: "default",
    });

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool: new Map(),
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    // Falls back to default provider since unknown-provider isn't in pool
    expect(defaultProvider.createMessage).toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("unknown-provider");
  });

  it("keeps configured execution identity when routed provider cannot be applied", async () => {
    const router = makeRouter({
      provider: "unknown-provider",
      model: "unknown-model",
      reasoning: "No pool match",
      confidence: 1.0,
      routingTier: "default",
    });

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      model: "configured-model",
      modelRouter: router,
      providerPool: new Map(),
    });
    const session = makeSession();
    await orchestrator.processMessage(session, textParts("hello"));

    const defaultCall = (defaultProvider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as {
      system: string;
    } | undefined;

    expect(defaultCall?.system).toContain("[KILN EXECUTION IDENTITY]");
    expect(defaultCall?.system).toContain("provider: default");
    expect(defaultCall?.system).toContain("model: configured-model");
    expect(defaultCall?.system).toContain("source: configured");
    expect(defaultCall?.system).not.toContain("provider: unknown-provider");
  });

  it("modelOverride in perCallConfig takes precedence over router", async () => {
    const routedProvider = makeProvider("routed");
    const overrideProvider = makeProvider("override");
    const router = makeRouter({
      provider: "routed",
      model: "routed-model",
      reasoning: "Should not be used",
      confidence: 1.0,
      routingTier: "rule",
    });

    const providerPool = new Map<string, ProviderAdapter>([
      ["routed", routedProvider],
      ["override", overrideProvider],
    ]);

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      providerPool,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"), undefined, undefined, {
      modelOverride: { provider: "override", model: "override-model" },
    });

    // Override provider should be used, not the routed one
    expect(overrideProvider.createMessage).toHaveBeenCalled();
    expect(routedProvider.createMessage).not.toHaveBeenCalled();
    expect(defaultProvider.createMessage).not.toHaveBeenCalled();
    // Router should not have been called
    expect(router.route).not.toHaveBeenCalled();
    expect(result.routingDecision).toBeDefined();
    expect(result.routingDecision!.provider).toBe("override");
    expect(result.routingDecision!.model).toBe("override-model");
  });

  it("routingDecision is included in OrchestrateResult", async () => {
    const router = makeRouter({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      reasoning: "Budget saving rule",
      confidence: 1.0,
      routingTier: "rule",
    });

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    expect(result.routingDecision).toEqual({
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      routingTier: "rule",
      reasoning: "Budget saving rule",
    });
  });

  it("emits model_routed event via eventBus", async () => {
    const eventBus = { emit: vi.fn(), on: vi.fn(), off: vi.fn(), clear: vi.fn() };
    const router = makeRouter({
      provider: "openai",
      model: "gpt-4o-mini",
      reasoning: "Cost optimization",
      confidence: 1.0,
      routingTier: "complexity",
    });

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
      eventBus,
    });
    const session = makeSession();
    await orchestrator.processMessage(session, textParts("hello"));

    const modelRoutedEvents = eventBus.emit.mock.calls.filter(
      (call: unknown[]) => (call[0] as { type: string }).type === "model_routed",
    );
    expect(modelRoutedEvents.length).toBe(1);
    expect(modelRoutedEvents[0][0]).toMatchObject({
      type: "model_routed",
      model: "gpt-4o-mini",
      provider: "openai",
      routingTier: "complexity",
      reason: "Cost optimization",
    });
  });

  it("fails open when router throws", async () => {
    const router: ModelRouter = {
      route: vi.fn().mockImplementation(() => {
        throw new Error("Router failed");
      }),
    };

    const orchestrator = new ModeBOrchestrator({
      provider: defaultProvider,
      modelRouter: router,
    });
    const session = makeSession();
    const result = await orchestrator.processMessage(session, textParts("hello"));

    // Should fall back to default provider
    expect(defaultProvider.createMessage).toHaveBeenCalled();
    expect(result.routingDecision).toBeUndefined();
  });
});
