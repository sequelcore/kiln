// Tests for compareExperiments

import { describe, it, expect } from "vitest";
import { compareExperiments } from "../../src/eval/experiment-comparator.js";
import type { Experiment } from "../../src/eval/types.js";

describe("compareExperiments", () => {
  const expA: Experiment = {
    name: "experiment-a",
    datasetName: "ds",
    scorers: ["accuracy", "latency"],
    results: [
      {
        itemId: "1",
        output: "a1",
        scores: [
          { name: "accuracy", score: 0.8 },
          { name: "latency", score: 0.9 },
        ],
        durationMs: 100,
        tokenUsage: { inputTokens: 10, outputTokens: 20 },
      },
      {
        itemId: "2",
        output: "a2",
        scores: [
          { name: "accuracy", score: 0.6 },
          { name: "latency", score: 0.7 },
        ],
        durationMs: 100,
        tokenUsage: { inputTokens: 10, outputTokens: 20 },
      },
    ],
    startedAt: "2024-01-01T00:00:00Z",
    completedAt: "2024-01-01T00:01:00Z",
  };

  const expB: Experiment = {
    name: "experiment-b",
    datasetName: "ds",
    scorers: ["accuracy", "latency"],
    results: [
      {
        itemId: "1",
        output: "b1",
        scores: [
          { name: "accuracy", score: 0.9 },
          { name: "latency", score: 0.8 },
        ],
        durationMs: 100,
        tokenUsage: { inputTokens: 10, outputTokens: 20 },
      },
      {
        itemId: "2",
        output: "b2",
        scores: [
          { name: "accuracy", score: 0.7 },
          { name: "latency", score: 0.9 },
        ],
        durationMs: 100,
        tokenUsage: { inputTokens: 10, outputTokens: 20 },
      },
    ],
    startedAt: "2024-01-02T00:00:00Z",
    completedAt: "2024-01-02T00:01:00Z",
  };

  it("calculates correct average scores", () => {
    const result = compareExperiments(expA, expB);

    const accuracyA = result.scorerComparisons.find((c) => c.scorerName === "accuracy");
    const latencyA = result.scorerComparisons.find((c) => c.scorerName === "latency");

    expect(accuracyA?.avgScoreA).toBeCloseTo(0.7);
    expect(accuracyA?.avgScoreB).toBeCloseTo(0.8);
    expect(latencyA?.avgScoreA).toBeCloseTo(0.8);
    expect(latencyA?.avgScoreB).toBeCloseTo(0.85);
  });

  it("positive delta means improved", () => {
    const result = compareExperiments(expA, expB);

    const accuracy = result.scorerComparisons.find((c) => c.scorerName === "accuracy");
    expect(accuracy?.delta).toBeCloseTo(0.1);
    expect(accuracy?.improved).toBe(true);
  });

  it("summary text contains experiment names", () => {
    const result = compareExperiments(expA, expB);
    expect(result.summary).toContain("experiment-b");
    expect(result.experimentA).toBe("experiment-a");
    expect(result.experimentB).toBe("experiment-b");
  });

  it("handles experiments with different scorer sets", () => {
    const expC: Experiment = {
      name: "exp-c",
      datasetName: "ds",
      scorers: ["accuracy", "new-scorer"],
      results: [
        {
          itemId: "1",
          output: "c1",
          scores: [
            { name: "accuracy", score: 1.0 },
            { name: "new-scorer", score: 0.5 },
          ],
          durationMs: 100,
          tokenUsage: { inputTokens: 10, outputTokens: 20 },
        },
      ],
      startedAt: "2024-01-03T00:00:00Z",
      completedAt: "2024-01-03T00:01:00Z",
    };

    const result = compareExperiments(expA, expC);

    const scorerNames = result.scorerComparisons.map((c) => c.scorerName);
    expect(scorerNames).toContain("accuracy");
    expect(scorerNames).toContain("latency");
    expect(scorerNames).toContain("new-scorer");
  });
});
