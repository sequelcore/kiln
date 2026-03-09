// Tests for ToolTrajectoryScorer

import { describe, it, expect } from "vitest";
import { ToolTrajectoryScorer } from "../../../src/eval/scorers/tool-trajectory-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("ToolTrajectoryScorer", () => {
  it("parses valid LLM response with tool calls", async () => {
    const llm = new MockLLM("SCORE: 0.8\nREASONING: Efficient tool sequence");
    const scorer = new ToolTrajectoryScorer(llm);
    const result = await scorer.score({
      input: "Look up order #123",
      output: "Order #123 is shipped.",
      metadata: {
        toolCalls: [
          { name: "lookup_order", args: { orderId: "123" }, result: "shipped" },
        ],
      },
    });
    expect(result.name).toBe("tool-trajectory");
    expect(result.score).toBe(0.8);
    expect(result.reasoning).toBe("Efficient tool sequence");
  });

  it("returns 0 when metadata is missing", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new ToolTrajectoryScorer(llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No tool calls in metadata");
  });

  it("returns 0 when toolCalls is not an array", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new ToolTrajectoryScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: { toolCalls: "not an array" },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No tool calls in metadata");
  });

  it("returns 0 when toolCalls entries lack name field", async () => {
    const llm = new MockLLM("SCORE: 1.0\nREASONING: Should not be called");
    const scorer = new ToolTrajectoryScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: { toolCalls: [{ args: {}, result: "x" }] },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No tool calls in metadata");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("Broken");
    const scorer = new ToolTrajectoryScorer(llm);
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        toolCalls: [{ name: "t", args: {}, result: "r" }],
      },
    });
    expect(result.score).toBe(0);
  });

  it("formats tool call sequence in prompt", async () => {
    let capturedPrompt = "";
    const llm: ScorerLLM = {
      async evaluate(prompt: string) {
        capturedPrompt = prompt;
        return "SCORE: 0.7\nREASONING: ok";
      },
    };
    const scorer = new ToolTrajectoryScorer(llm);
    await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        toolCalls: [
          { name: "search", args: { q: "test" }, result: "found" },
          { name: "read", args: { id: "1" }, result: "content" },
        ],
      },
    });
    expect(capturedPrompt).toContain("Step 1: search");
    expect(capturedPrompt).toContain("Step 2: read");
  });
});
