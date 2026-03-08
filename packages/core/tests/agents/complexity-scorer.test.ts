import { describe, it, expect } from "vitest";
import { scoreComplexity } from "../../src/agents/complexity-scorer.js";

describe("scoreComplexity", () => {
  it("short greeting returns trivial complexity", () => {
    const result = scoreComplexity({ messageText: "hi", toolCount: 0, turnDepth: 0 });
    expect(result.class).toBe("trivial");
    expect(result.score).toBeLessThan(0.2);
    expect(result.signals.hasTools).toBe(false);
    expect(result.signals.hasCodeBlocks).toBe(false);
    expect(result.signals.hasReasoningMarkers).toBe(false);
  });

  it("long message with code blocks returns higher complexity", () => {
    const longMessage = "a".repeat(4000) + "\n```js\nconsole.log('hello');\n```\n";
    const result = scoreComplexity({ messageText: longMessage, toolCount: 5, turnDepth: 10 });
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.signals.hasCodeBlocks).toBe(true);
    expect(result.signals.hasTools).toBe(true);
  });

  it("message with reasoning markers gets higher score", () => {
    const withMarkers = scoreComplexity({
      messageText: "Please analyze this code step by step",
      toolCount: 0,
      turnDepth: 0,
    });
    const withoutMarkers = scoreComplexity({
      messageText: "What is the capital of France?",
      toolCount: 0,
      turnDepth: 0,
    });
    expect(withMarkers.score).toBeGreaterThan(withoutMarkers.score);
    expect(withMarkers.signals.hasReasoningMarkers).toBe(true);
    expect(withoutMarkers.signals.hasReasoningMarkers).toBe(false);
  });

  it("empty tool count means no tool contribution", () => {
    const result = scoreComplexity({ messageText: "hello", toolCount: 0, turnDepth: 0 });
    expect(result.signals.hasTools).toBe(false);
    expect(result.signals.toolCount).toBe(0);
  });

  it("high turn depth increases score", () => {
    const shallow = scoreComplexity({ messageText: "test", toolCount: 0, turnDepth: 0 });
    const deep = scoreComplexity({ messageText: "test", toolCount: 0, turnDepth: 20 });
    expect(deep.score).toBeGreaterThan(shallow.score);
  });

  it("score is bounded between 0 and 1", () => {
    // Minimal input
    const min = scoreComplexity({ messageText: "", toolCount: 0, turnDepth: 0 });
    expect(min.score).toBeGreaterThanOrEqual(0);
    expect(min.score).toBeLessThanOrEqual(1);

    // Maximal input
    const max = scoreComplexity({
      messageText: "a".repeat(10000) + "```code```\nPlease analyze step by step",
      toolCount: 20,
      turnDepth: 100,
    });
    expect(max.score).toBeGreaterThanOrEqual(0);
    expect(max.score).toBeLessThanOrEqual(1);
  });

  it("returns correct token estimate", () => {
    const result = scoreComplexity({ messageText: "a".repeat(400), toolCount: 0, turnDepth: 0 });
    expect(result.signals.tokenCount).toBe(100); // 400 chars / 4
  });

  it("classifies complexity classes correctly", () => {
    // trivial: score < 0.2
    expect(scoreComplexity({ messageText: "hi", toolCount: 0, turnDepth: 0 }).class).toBe("trivial");

    // expert: lots of signals
    const expert = scoreComplexity({
      messageText: "a".repeat(8000) + "```python\nprint('x')\n```\nPlease analyze step by step and debug",
      toolCount: 10,
      turnDepth: 20,
    });
    expect(expert.class).toBe("expert");
  });
});
