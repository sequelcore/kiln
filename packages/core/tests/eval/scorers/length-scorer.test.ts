// Tests for LengthScorer

import { describe, it, expect } from "vitest";
import { LengthScorer } from "../../../src/eval/scorers/length-scorer.js";

describe("LengthScorer", () => {
  it("scores 1.0 when length within range", async () => {
    const scorer = new LengthScorer(5, 20);
    const result = await scorer.score({ input: "q", output: "hello world" });
    expect(result.score).toBe(1);
  });

  it("scores proportionally when below minimum", async () => {
    const scorer = new LengthScorer(10);
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBeCloseTo(5 / 10);
  });

  it("scores proportionally when above maximum", async () => {
    const scorer = new LengthScorer(undefined, 5);
    const result = await scorer.score({ input: "q", output: "hello world" });
    expect(result.score).toBeCloseTo(5 / 11);
  });

  it("scores 1.0 when no constraints", async () => {
    const scorer = new LengthScorer();
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(1);
  });

  it("scores 1.0 when exactly at minimum", async () => {
    const scorer = new LengthScorer(5);
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(1);
  });

  it("scores 1.0 when exactly at maximum", async () => {
    const scorer = new LengthScorer(undefined, 5);
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(1);
  });
});
