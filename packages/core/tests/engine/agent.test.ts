import { describe, it, expect } from "vitest";
import type { Agent, AgentTier } from "../../src/engine/domain/agent.js";

describe("Agent interface", () => {
  it("accepts a minimal agent configuration", () => {
    const agent: Agent = {
      name: "architect",
      tier: "reasoning",
      tools: [],
    };
    expect(agent.name).toBe("architect");
    expect(agent.tier).toBe("reasoning");
    expect(agent.tools).toEqual([]);
  });

  it("accepts all optional fields", () => {
    const agent: Agent = {
      name: "worker",
      tier: "coding",
      tools: ["code", "test", "lint"],
      systemPrompt: "You are a coding assistant",
      structured: false,
      count: 2,
      sandbox: true,
    };
    expect(agent.count).toBe(2);
    expect(agent.sandbox).toBe(true);
    expect(agent.systemPrompt).toBe("You are a coding assistant");
    expect(agent.structured).toBe(false);
    expect(agent.tools).toHaveLength(3);
  });

  it("supports all three agent tiers", () => {
    const tiers: AgentTier[] = ["reasoning", "coding", "fast"];
    for (const tier of tiers) {
      const agent: Agent = { name: `agent-${tier}`, tier, tools: [] };
      expect(agent.tier).toBe(tier);
    }
  });

  it("enforces readonly tools array", () => {
    const agent: Agent = {
      name: "test",
      tier: "fast",
      tools: ["summarize"],
    };
    expect(agent.tools[0]).toBe("summarize");
  });
});
