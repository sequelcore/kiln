// Tests for MultiTurnConsistencyScorer

import { describe, it, expect } from "vitest";
import { MultiTurnConsistencyScorer } from "../../../src/eval/scorers/multi-turn-consistency-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("MultiTurnConsistencyScorer", () => {
  it("scores conversation with valid history", async () => {
    const llm = new MockLLM("SCORE: 0.9\nREASONING: Maintained context throughout");
    const scorer = new MultiTurnConsistencyScorer(llm);
    const result = await scorer.score({
      input: "What was my order number again?",
      output: "Your order number is #123, as you mentioned earlier.",
      metadata: {
        conversationHistory: [
          { role: "user", content: "My order #123 hasn't arrived" },
          { role: "assistant", content: "Let me check order #123 for you." },
          { role: "user", content: "What was my order number again?" },
          { role: "assistant", content: "Your order number is #123, as you mentioned earlier." },
        ],
      },
    });
    expect(result.name).toBe("multi-turn-consistency");
    expect(result.score).toBe(0.9);
    expect(result.reasoning).toBe("Maintained context throughout");
  });

  it("returns 0 when no metadata", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new MultiTurnConsistencyScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("No conversation history");
  });

  it("returns 0 when conversation has fewer than 2 turns", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new MultiTurnConsistencyScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        conversationHistory: [{ role: "user", content: "hello" }],
      },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("need >= 2 turns");
  });

  it("returns 0 when conversationHistory is not an array", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new MultiTurnConsistencyScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: { conversationHistory: "not an array" },
    });
    expect(result.score).toBe(0);
  });

  it("filters out invalid turn entries", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new MultiTurnConsistencyScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        conversationHistory: [
          { role: "user", content: "hello" },
          { content: "missing role" },
          42,
        ],
      },
    });
    // Only 1 valid turn, need >= 2
    expect(result.score).toBe(0);
  });

  it("formats transcript in prompt", async () => {
    let capturedPrompt = "";
    const llm: ScorerLLM = {
      async evaluate(prompt: string) {
        capturedPrompt = prompt;
        return "SCORE: 0.7\nREASONING: ok";
      },
    };
    const scorer = new MultiTurnConsistencyScorer(llm);
    await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        conversationHistory: [
          { role: "user", content: "first message" },
          { role: "assistant", content: "first reply" },
        ],
      },
    });
    expect(capturedPrompt).toContain("[user]: first message");
    expect(capturedPrompt).toContain("[assistant]: first reply");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("Broken response");
    const scorer = new MultiTurnConsistencyScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        conversationHistory: [
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ],
      },
    });
    expect(result.score).toBe(0);
  });
});
