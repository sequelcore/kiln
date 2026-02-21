// Tests for ExactMatchScorer

import { describe, it, expect } from "vitest";
import { ExactMatchScorer } from "../../../src/eval/scorers/exact-match-scorer.js";

describe("ExactMatchScorer", () => {
  const scorer = new ExactMatchScorer();

  it("scores 1.0 for exact match", async () => {
    const result = await scorer.score({ input: "q", output: "hello", expected: "hello" });
    expect(result.score).toBe(1);
  });

  it("scores 0.0 for mismatch", async () => {
    const result = await scorer.score({ input: "q", output: "hello", expected: "world" });
    expect(result.score).toBe(0);
  });

  it("scores 0.0 when no expected value", async () => {
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(0);
  });
});
