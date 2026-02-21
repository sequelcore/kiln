// Tests for parseLLMResponse

import { describe, it, expect } from "vitest";
import { parseLLMResponse } from "../../../src/eval/scorers/parse-llm-response.js";

describe("parseLLMResponse", () => {
  it("extracts valid SCORE and REASONING", () => {
    const result = parseLLMResponse("SCORE: 0.85\nREASONING: Output is faithful to context", "test");
    expect(result.score).toBe(0.85);
    expect(result.reasoning).toBe("Output is faithful to context");
  });

  it("returns 0 for missing SCORE", () => {
    const result = parseLLMResponse("REASONING: No score provided", "test");
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("failed to parse");
  });

  it("clamps score to 0-1 range", () => {
    const result = parseLLMResponse("SCORE: 1.5\nREASONING: High score", "test");
    expect(result.score).toBe(1);
  });

  it("clamps negative score to 0", () => {
    const result = parseLLMResponse("SCORE: -0.5\nREASONING: Negative score", "test");
    expect(result.score).toBe(0);
  });

  it("handles missing REASONING", () => {
    const result = parseLLMResponse("SCORE: 0.5", "test");
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toBe("");
  });

  it("is case-insensitive for SCORE", () => {
    const result = parseLLMResponse("score: 0.7\nreasoning: Lowercase", "test");
    expect(result.score).toBe(0.7);
  });

  it("handles NaN score gracefully", () => {
    const result = parseLLMResponse("SCORE: invalid\nREASONING: Bad score", "test");
    expect(result.score).toBe(0);
  });

  it("does not bleed trailing SCORE into reasoning", () => {
    const result = parseLLMResponse("SCORE: 0.8\nREASONING: The output is good\nSCORE: 0.5", "test");
    expect(result.score).toBe(0.8);
    expect(result.reasoning).not.toContain("SCORE");
    expect(result.reasoning).toBe("The output is good");
  });
});
