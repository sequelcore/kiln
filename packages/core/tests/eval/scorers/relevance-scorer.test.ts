// Tests for RelevanceScorer

import { describe, it, expect } from "vitest";
import { RelevanceScorer } from "../../../src/eval/scorers/relevance-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("RelevanceScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.9\nREASONING: Output directly answers the input question");
    const scorer = new RelevanceScorer(llm);
    const result = await scorer.score({
      input: "What is 2+2?",
      output: "2+2 equals 4",
    });
    expect(result.score).toBe(0.9);
    expect(result.reasoning).toBe("Output directly answers the input question");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("Invalid response");
    const scorer = new RelevanceScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
  });

  it("handles low relevance score", async () => {
    const llm = new MockLLM("SCORE: 0.2\nREASONING: Output is tangentially related");
    const scorer = new RelevanceScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0.2);
  });
});
