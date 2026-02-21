// Tests for CompositeScorer

import { describe, it, expect } from "vitest";
import { CompositeScorer } from "../../../src/eval/scorers/composite-scorer.js";
import { ExactMatchScorer } from "../../../src/eval/scorers/exact-match-scorer.js";
import { ContainsScorer } from "../../../src/eval/scorers/contains-scorer.js";

describe("CompositeScorer", () => {
  it("averages scores from multiple scorers", async () => {
    const scorer = new CompositeScorer("composite-test", [
      new ExactMatchScorer(),
      new ContainsScorer(["hello"]),
    ]);
    const result = await scorer.score({ input: "q", output: "hello world", expected: "hello world" });
    expect(result.score).toBe(1);
  });

  it("averages partial scores correctly", async () => {
    const scorer = new CompositeScorer("composite-test", [
      new ExactMatchScorer(),
      new ContainsScorer(["hello", "missing"]),
    ]);
    const result = await scorer.score({ input: "q", output: "hello world", expected: "hello world" });
    expect(result.score).toBeCloseTo(0.75);
  });

  it("passes through single scorer score", async () => {
    const scorer = new CompositeScorer("composite-test", [new ExactMatchScorer()]);
    const result = await scorer.score({ input: "q", output: "hello", expected: "hello" });
    expect(result.score).toBe(1);
  });

  it("includes all scorer names in reasoning", async () => {
    const scorer = new CompositeScorer("composite-test", [
      new ExactMatchScorer(),
      new ContainsScorer(["hello"]),
    ]);
    const result = await scorer.score({ input: "q", output: "hello world", expected: "hello world" });
    expect(result.reasoning).toContain("exact-match");
    expect(result.reasoning).toContain("contains");
  });
});
