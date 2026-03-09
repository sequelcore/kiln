// Tests for ContextRelevanceScorer

import { describe, it, expect } from "vitest";
import { ContextRelevanceScorer } from "../../../src/eval/scorers/context-relevance-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("ContextRelevanceScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.75\nREASONING: Most chunks are relevant");
    const scorer = new ContextRelevanceScorer(llm);
    const result = await scorer.score({
      input: "What is the return policy?",
      output: "You can return items within 30 days.",
      context: ["Return policy: 30 days with receipt", "Store hours: 9am-5pm"],
    });
    expect(result.name).toBe("context-relevance");
    expect(result.score).toBe(0.75);
    expect(result.reasoning).toBe("Most chunks are relevant");
  });

  it("returns 0 when no context provided", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new ContextRelevanceScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No context provided");
  });

  it("returns 0 for empty context array", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new ContextRelevanceScorer(llm);
    const result = await scorer.score({ input: "q", output: "a", context: [] });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No context provided");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("Invalid format");
    const scorer = new ContextRelevanceScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      context: ["some context"],
    });
    expect(result.score).toBe(0);
  });

  it("numbers context chunks in prompt", async () => {
    let capturedPrompt = "";
    const llm: ScorerLLM = {
      async evaluate(prompt: string) {
        capturedPrompt = prompt;
        return "SCORE: 0.5\nREASONING: ok";
      },
    };
    const scorer = new ContextRelevanceScorer(llm);
    await scorer.score({
      input: "q",
      output: "a",
      context: ["Chunk one", "Chunk two"],
    });
    expect(capturedPrompt).toContain("[1] Chunk one");
    expect(capturedPrompt).toContain("[2] Chunk two");
  });
});
