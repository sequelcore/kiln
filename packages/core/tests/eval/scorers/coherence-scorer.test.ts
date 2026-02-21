// Tests for CoherenceScorer

import { describe, it, expect } from "vitest";
import { CoherenceScorer } from "../../../src/eval/scorers/coherence-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("CoherenceScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.95\nREASONING: Output is well-structured and consistent");
    const scorer = new CoherenceScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "First point. Second point. Conclusion.",
    });
    expect(result.score).toBe(0.95);
    expect(result.reasoning).toBe("Output is well-structured and consistent");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("No score here");
    const scorer = new CoherenceScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
  });

  it("handles incoherent output", async () => {
    const llm = new MockLLM("SCORE: 0.3\nREASONING: Output has logical inconsistencies");
    const scorer = new CoherenceScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0.3);
  });
});
