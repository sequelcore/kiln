// Tests for LatencyScorer

import { describe, it, expect } from "vitest";
import { LatencyScorer } from "../../../src/eval/scorers/latency-scorer.js";

describe("LatencyScorer", () => {
  it("scores 1.0 when under threshold", async () => {
    const scorer = new LatencyScorer(1000);
    const result = await scorer.score({ input: "q", output: "hello", durationMs: 500 });
    expect(result.score).toBe(1);
  });

  it("scores proportionally when over threshold", async () => {
    const scorer = new LatencyScorer(500);
    const result = await scorer.score({ input: "q", output: "hello", durationMs: 1000 });
    expect(result.score).toBeCloseTo(0.5);
  });

  it("scores 0.0 when no durationMs", async () => {
    const scorer = new LatencyScorer(1000);
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(0);
  });

  it("scores 1.0 when exactly at threshold", async () => {
    const scorer = new LatencyScorer(500);
    const result = await scorer.score({ input: "q", output: "hello", durationMs: 500 });
    expect(result.score).toBe(1);
  });
});
