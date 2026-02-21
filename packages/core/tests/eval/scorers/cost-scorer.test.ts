// Tests for CostScorer

import { describe, it, expect } from "vitest";
import { CostScorer } from "../../../src/eval/scorers/cost-scorer.js";

describe("CostScorer", () => {
  it("scores 1.0 when under threshold", async () => {
    const scorer = new CostScorer(0.10);
    const result = await scorer.score({ input: "q", output: "hello", costUsd: 0.05 });
    expect(result.score).toBe(1);
  });

  it("scores proportionally when over threshold", async () => {
    const scorer = new CostScorer(0.05);
    const result = await scorer.score({ input: "q", output: "hello", costUsd: 0.10 });
    expect(result.score).toBeCloseTo(0.5);
  });

  it("scores 0.0 when no costUsd", async () => {
    const scorer = new CostScorer(0.10);
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(0);
  });

  it("scores 1.0 when exactly at threshold", async () => {
    const scorer = new CostScorer(0.05);
    const result = await scorer.score({ input: "q", output: "hello", costUsd: 0.05 });
    expect(result.score).toBe(1);
  });
});
