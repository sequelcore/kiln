// Tests for PolicyAdherenceScorer

import { describe, it, expect } from "vitest";
import { PolicyAdherenceScorer } from "../../../src/eval/scorers/policy-adherence-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("PolicyAdherenceScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.9\nREASONING: Output follows all policies");
    const scorer = new PolicyAdherenceScorer(llm, ["Be polite", "No refunds after 30 days"]);
    const result = await scorer.score({
      input: "Can I get a refund?",
      output: "I'd be happy to help. Since your purchase is within 30 days, we can process a refund.",
    });
    expect(result.name).toBe("policy-adherence");
    expect(result.score).toBe(0.9);
    expect(result.reasoning).toBe("Output follows all policies");
  });

  it("returns 0 when no policies configured", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new PolicyAdherenceScorer(llm, []);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No policies configured");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("This is not a valid response");
    const scorer = new PolicyAdherenceScorer(llm, ["Be helpful"]);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
  });

  it("includes policies in prompt", async () => {
    let capturedPrompt = "";
    const llm: ScorerLLM = {
      async evaluate(prompt: string) {
        capturedPrompt = prompt;
        return "SCORE: 0.8\nREASONING: ok";
      },
    };
    const scorer = new PolicyAdherenceScorer(llm, ["Rule A", "Rule B"]);
    await scorer.score({ input: "q", output: "a" });
    expect(capturedPrompt).toContain("1. Rule A");
    expect(capturedPrompt).toContain("2. Rule B");
  });
});
