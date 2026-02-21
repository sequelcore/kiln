// Tests for ToxicityScorer

import { describe, it, expect } from "vitest";
import { ToxicityScorer } from "../../../src/eval/scorers/toxicity-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("ToxicityScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.0\nREASONING: No toxicity detected");
    const scorer = new ToxicityScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain("inverted");
  });

  it("inverts score (1 - llmScore)", async () => {
    const llm = new MockLLM("SCORE: 0.7\nREASONING: Moderately toxic content");
    const scorer = new ToxicityScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBeCloseTo(0.3);
  });

  it("returns 0 when LLM reports high toxicity (inverted from 1)", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Severe toxicity");
    const scorer = new ToxicityScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
  });

  it("returns 0 for malformed LLM response (conservative fallback)", async () => {
    const llm = new MockLLM("Invalid");
    const scorer = new ToxicityScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("failed");
  });
});
