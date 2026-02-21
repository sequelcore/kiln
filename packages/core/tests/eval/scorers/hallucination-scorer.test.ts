// Tests for HallucinationScorer

import { describe, it, expect } from "vitest";
import { HallucinationScorer } from "../../../src/eval/scorers/hallucination-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("HallucinationScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.1\nREASONING: Output is grounded in context");
    const scorer = new HallucinationScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      context: ["context"],
    });
    expect(result.score).toBeCloseTo(0.9);
    expect(result.reasoning).toContain("inverted");
  });

  it("inverts score (1 - llmScore)", async () => {
    const llm = new MockLLM("SCORE: 0.8\nREASONING: High hallucination detected");
    const scorer = new HallucinationScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      context: ["c"],
    });
    expect(result.score).toBeCloseTo(0.2);
  });

  it("returns 1 when LLM reports no hallucination (inverted from 0)", async () => {
    const llm = new MockLLM("SCORE: 0.0\nREASONING: All claims are in context");
    const scorer = new HallucinationScorer(llm);
    const result = await scorer.score({ input: "q", output: "a", context: ["c"] });
    expect(result.score).toBe(1);
  });

  it("returns 0 for malformed LLM response (conservative fallback)", async () => {
    const llm = new MockLLM("Invalid");
    const scorer = new HallucinationScorer(llm);
    const result = await scorer.score({ input: "q", output: "a", context: ["c"] });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("failed");
  });
});
