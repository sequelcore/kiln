import { describe, it, expect, vi } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { ProviderAdapter } from "../../src/agents/index.js";
import { ProviderRegistry } from "../../src/agents/provider-registry.js";

function makeMockAdapter(name: string): ProviderAdapter {
  return {
    name,
    createMessage: vi.fn(),
    streamMessage: vi.fn() as unknown as ProviderAdapter["streamMessage"],
  };
}

describe("Orchestrator provider integration", () => {
  it("registerProvider adds adapter to registry", () => {
    const orchestrator = new Orchestrator();
    const adapter = makeMockAdapter("openai");

    orchestrator.registerProvider("openai", adapter);

    expect(orchestrator.providerRegistry.get("openai")).toBe(adapter);
  });

  it("setRoleProvider configures role mapping", () => {
    const orchestrator = new Orchestrator();
    const adapter = makeMockAdapter("openai");

    orchestrator.registerProvider("openai", adapter);
    orchestrator.setRoleProvider("architect", "openai");

    expect(orchestrator.getProviderForRole("architect")).toBe(adapter);
  });

  it("getProviderForRole returns configured adapter", () => {
    const orchestrator = new Orchestrator();
    const openai = makeMockAdapter("openai");
    const deepseek = makeMockAdapter("deepseek");

    orchestrator.registerProvider("openai", openai);
    orchestrator.registerProvider("deepseek", deepseek);
    orchestrator.setRoleProvider("architect", "openai");
    orchestrator.setRoleProvider("worker", "deepseek");

    expect(orchestrator.getProviderForRole("architect")).toBe(openai);
    expect(orchestrator.getProviderForRole("worker")).toBe(deepseek);
  });

  it("default falls back correctly", () => {
    const orchestrator = new Orchestrator();
    const adapter = makeMockAdapter("anthropic");

    orchestrator.registerProvider("anthropic", adapter);
    orchestrator.providerRegistry.defaultProvider("anthropic");

    // No role-specific mapping -- falls back to default
    expect(orchestrator.getProviderForRole("optimizer")).toBe(adapter);
  });

  it("providerRegistry getter exposes registry", () => {
    const orchestrator = new Orchestrator();

    expect(orchestrator.providerRegistry).toBeInstanceOf(ProviderRegistry);
  });
});
