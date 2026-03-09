// Tests for HandoffQualityScorer

import { describe, it, expect } from "vitest";
import { HandoffQualityScorer } from "../../../src/eval/scorers/handoff-quality-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("HandoffQualityScorer", () => {
  it("scores with valid handoff history", async () => {
    const llm = new MockLLM("SCORE: 0.85\nREASONING: Context preserved well across handoff");
    const scorer = new HandoffQualityScorer(llm);
    const result = await scorer.score({
      input: "I need to return my order and get a refund",
      output: "Your refund has been processed.",
      metadata: {
        handoffHistory: [
          {
            fromAgent: "general-agent",
            toAgent: "returns-agent",
            reason: "Customer requesting product return",
            summary: "Customer wants to return order #456, purchased 5 days ago.",
          },
        ],
      },
    });
    expect(result.name).toBe("handoff-quality");
    expect(result.score).toBe(0.85);
    expect(result.reasoning).toBe("Context preserved well across handoff");
  });

  it("returns 0 when no metadata", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new HandoffQualityScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("No handoff history");
  });

  it("returns 0 when handoffHistory is not an array", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new HandoffQualityScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: { handoffHistory: "not an array" },
    });
    expect(result.score).toBe(0);
  });

  it("filters invalid handoff entries", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new HandoffQualityScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        handoffHistory: [{ fromAgent: "a" }, 42, null],
      },
    });
    // No valid entries (missing toAgent)
    expect(result.score).toBe(0);
  });

  it("formats handoff log in prompt", async () => {
    let capturedPrompt = "";
    const llm: ScorerLLM = {
      async evaluate(prompt: string) {
        capturedPrompt = prompt;
        return "SCORE: 0.7\nREASONING: ok";
      },
    };
    const scorer = new HandoffQualityScorer(llm);
    await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        handoffHistory: [
          { fromAgent: "agent-a", toAgent: "agent-b", reason: "needs billing", summary: "Customer asked about invoice" },
          { fromAgent: "agent-b", toAgent: "agent-c" },
        ],
      },
    });
    expect(capturedPrompt).toContain("agent-a -> agent-b");
    expect(capturedPrompt).toContain("Reason: needs billing");
    expect(capturedPrompt).toContain("Summary: Customer asked about invoice");
    expect(capturedPrompt).toContain("agent-b -> agent-c");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("Broken");
    const scorer = new HandoffQualityScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        handoffHistory: [{ fromAgent: "a", toAgent: "b" }],
      },
    });
    expect(result.score).toBe(0);
  });
});
