// Tests for CustomPromptScorer

import { describe, it, expect } from "vitest";
import { CustomPromptScorer } from "../../../src/eval/scorers/custom-prompt-scorer.js";
import type { ScorerLLM } from "../../../src/eval/types.js";

class MockLLM implements ScorerLLM {
  constructor(private readonly response: string) {}
  async evaluate(): Promise<string> {
    return this.response;
  }
}

describe("CustomPromptScorer", () => {
  it("parses valid LLM response", async () => {
    const llm = new MockLLM("SCORE: 0.8\nREASONING: Custom evaluation passed");
    const scorer = new CustomPromptScorer("custom", "Evaluate this: {{output}}", llm);
    const result = await scorer.score({ input: "q", output: "test output" });
    expect(result.score).toBe(0.8);
    expect(result.reasoning).toBe("Custom evaluation passed");
  });

  it("substitutes all template variables", async () => {
    let receivedPrompt = "";
    const llm: ScorerLLM = {
      evaluate: async (prompt: string) => {
        receivedPrompt = prompt;
        return "SCORE: 1.0\nREASONING: Done";
      },
    };
    const scorer = new CustomPromptScorer(
      "custom",
      "Input: {{input}}, Output: {{output}}, Expected: {{expected}}, Context: {{context}}",
      llm,
    );
    await scorer.score({
      input: "my input",
      output: "my output",
      expected: "expected value",
      context: ["ctx1", "ctx2"],
    });
    expect(receivedPrompt).toContain("my input");
    expect(receivedPrompt).toContain("my output");
    expect(receivedPrompt).toContain("expected value");
    expect(receivedPrompt).toContain("ctx1\nctx2");
  });

  it("handles missing optional fields in template", async () => {
    let receivedPrompt = "";
    const llm: ScorerLLM = {
      evaluate: async (prompt: string) => {
        receivedPrompt = prompt;
        return "SCORE: 1.0\nREASONING: Done";
      },
    };
    const scorer = new CustomPromptScorer(
      "custom",
      "Expected: {{expected}}, Context: {{context}}",
      llm,
    );
    await scorer.score({ input: "q", output: "a" });
    expect(receivedPrompt).toContain("Expected: ");
    expect(receivedPrompt).toContain("Context: ");
  });

  it("returns 0 for malformed LLM response", async () => {
    const llm = new MockLLM("Invalid");
    const scorer = new CustomPromptScorer("custom", "Evaluate: {{output}}", llm);
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
  });
});
