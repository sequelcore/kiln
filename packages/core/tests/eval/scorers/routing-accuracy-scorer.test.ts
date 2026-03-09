// Tests for RoutingAccuracyScorer

import { describe, it, expect } from "vitest";
import { RoutingAccuracyScorer } from "../../../src/eval/scorers/routing-accuracy-scorer.js";

describe("RoutingAccuracyScorer", () => {
  it("returns 1 when agent matches expected", async () => {
    const scorer = new RoutingAccuracyScorer();
    const result = await scorer.score({
      input: "I want to return my order",
      output: "I can help with returns.",
      metadata: { expectedAgentId: "returns-agent", activeAgentId: "returns-agent" },
    });
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain("Correct");
  });

  it("returns 0 when agent does not match", async () => {
    const scorer = new RoutingAccuracyScorer();
    const result = await scorer.score({
      input: "I want to return my order",
      output: "Let me check your billing.",
      metadata: { expectedAgentId: "returns-agent", activeAgentId: "billing-agent" },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain('Expected "returns-agent"');
    expect(result.reasoning).toContain('got "billing-agent"');
  });

  it("returns 0 when expectedAgentId is missing", async () => {
    const scorer = new RoutingAccuracyScorer();
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No expectedAgentId in metadata");
  });

  it("returns 0 when activeAgentId is missing", async () => {
    const scorer = new RoutingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: { expectedAgentId: "returns-agent" },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No activeAgentId in metadata");
  });
});
