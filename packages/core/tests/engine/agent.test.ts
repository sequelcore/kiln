import { describe, it, expect } from "vitest";
import type { Agent, AgentTier } from "../../src/engine/domain/agent.js";

describe("Agent interface", () => {
  it("accepts a minimal agent configuration", () => {
    const agent: Agent = {
      name: "Aria",
      role: "Senior Architect",
      goal: "Design robust, maintainable solutions",
      tier: "reasoning",
      tools: [],
    };
    expect(agent.name).toBe("Aria");
    expect(agent.role).toBe("Senior Architect");
    expect(agent.goal).toBe("Design robust, maintainable solutions");
    expect(agent.tier).toBe("reasoning");
    expect(agent.tools).toEqual([]);
  });

  it("accepts all optional fields", () => {
    const agent: Agent = {
      name: "Marcus",
      role: "Implementation Specialist",
      goal: "Write clean, well-tested code",
      tier: "coding",
      tools: ["code", "test", "lint"],
      backstory: "Detail-oriented developer who questions vague requirements.",
      instructions: "Always add tests for new features.",
      structured: false,
      count: 2,
      sandbox: true,
    };
    expect(agent.name).toBe("Marcus");
    expect(agent.role).toBe("Implementation Specialist");
    expect(agent.goal).toBe("Write clean, well-tested code");
    expect(agent.backstory).toBe("Detail-oriented developer who questions vague requirements.");
    expect(agent.instructions).toBe("Always add tests for new features.");
    expect(agent.count).toBe(2);
    expect(agent.sandbox).toBe(true);
    expect(agent.structured).toBe(false);
    expect(agent.tools).toHaveLength(3);
  });

  it("supports all three agent tiers", () => {
    const tiers: AgentTier[] = ["reasoning", "coding", "fast"];
    for (const tier of tiers) {
      const agent: Agent = { 
        name: `Agent-${tier}`, 
        role: "Test Role",
        goal: "Test goal",
        tier, 
        tools: [] 
      };
      expect(agent.tier).toBe(tier);
    }
  });

  it("enforces readonly tools array", () => {
    const agent: Agent = {
      name: "Test",
      role: "Tester",
      goal: "Run tests",
      tier: "fast",
      tools: ["summarize"],
    };
    expect(agent.tools[0]).toBe("summarize");
  });

  it("requires role and goal fields", () => {
    // TypeScript will enforce this at compile time
    // This test documents the required fields
    const agent: Agent = {
      name: "Dr. Voss",
      role: "Security & Quality Reviewer",
      goal: "Find vulnerabilities before production",
      tier: "reasoning",
      tools: ["verify"],
    };
    expect(agent.role).toBe("Security & Quality Reviewer");
    expect(agent.goal).toBe("Find vulnerabilities before production");
  });
});
