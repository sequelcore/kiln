// Tests for FaithfulnessScorer

import { describe, it, expect } from "vitest";
import { FaithfulnessScorer } from "../../../src/eval/scorers/faithfulness-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("FaithfulnessScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.85\nREASONING: Output is faithful to context");
    const scorer = new FaithfulnessScorer(llm);
    const result = await scorer.score({
      input: "What color is the sky?",
      output: "The sky is blue",
      context: ["The sky appears blue during the day"],
    });
    expect(result.score).toBe(0.85);
    expect(result.reasoning).toBe("Output is faithful to context");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("I don't understand the format");
    const scorer = new FaithfulnessScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
  });

  it("handles empty context gracefully", async () => {
    const llm = new MockLLM("SCORE: 0.5\nREASONING: No context to verify against");
    const scorer = new FaithfulnessScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0.5);
  });
});
