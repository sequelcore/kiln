// Tests for compareExperiments

import { describe, it, expect } from "vitest";
import { compareExperiments, evaluateCachePolicyPromotion } from "../../src/eval/experiment-comparator.js";
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
        trial: { status: "valid" },
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
        trial: { status: "valid" },
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
        trial: { status: "valid" },
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
        trial: { status: "valid" },
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
          trial: { status: "valid" },
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

  it("promotes cache policy only with rollback to baseline and non-inferior behavior", () => {
    const baseline = cacheExperiment("baseline", {
      cachedInputTokens: 0,
      policyId: "stable-prefix.v0",
    });
    const candidate = cacheExperiment("candidate", {
      cachedInputTokens: 1200,
      policyId: "stable-prefix.v1",
    });

    expect(evaluateCachePolicyPromotion({
      baseline,
      candidate,
      baselinePolicyId: "stable-prefix.v0",
      candidatePolicyId: "stable-prefix.v1",
      rollbackPolicyId: "stable-prefix.v0",
    })).toMatchObject({
      status: "promotable",
      rollbackPolicyId: "stable-prefix.v0",
      cachedInputTokenDelta: 1200,
      issues: [],
    });
  });

  it("blocks cache policy promotion when rollback is not the baseline policy", () => {
    const result = evaluateCachePolicyPromotion({
      baseline: cacheExperiment("baseline", {
        cachedInputTokens: 0,
        policyId: "stable-prefix.v0",
      }),
      candidate: cacheExperiment("candidate", {
        cachedInputTokens: 1200,
        policyId: "stable-prefix.v1",
      }),
      baselinePolicyId: "stable-prefix.v0",
      candidatePolicyId: "stable-prefix.v1",
      rollbackPolicyId: "stable-prefix.v1",
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContain("rollback policy must restore the baseline policy");
  });

  it("blocks cache policy promotion when experiment policy evidence does not match declared ids", () => {
    const result = evaluateCachePolicyPromotion({
      baseline: cacheExperiment("baseline", {
        cachedInputTokens: 0,
        policyId: "stable-prefix.other-baseline",
      }),
      candidate: cacheExperiment("candidate", {
        cachedInputTokens: 1200,
        policyId: "stable-prefix.other-candidate",
      }),
      baselinePolicyId: "stable-prefix.v0",
      candidatePolicyId: "stable-prefix.v1",
      rollbackPolicyId: "stable-prefix.v0",
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toEqual(expect.arrayContaining([
      "baseline policy evidence does not match declared baseline policy",
      "candidate policy evidence does not match declared candidate policy",
    ]));
  });

  it("blocks cache policy promotion when candidate changes output authority tools or scores", () => {
    const baseline = cacheExperiment("baseline", {
      cachedInputTokens: 0,
      policyId: "stable-prefix.v0",
    });
    const candidate = cacheExperiment("candidate", {
      cachedInputTokens: 1200,
      output: "changed",
      policyId: "stable-prefix.v1",
      authority: { scope: "write" },
      toolCalls: [{ name: "write_file", args: { path: "docs/a.md" } }],
      accuracyScore: 0.8,
    });

    const result = evaluateCachePolicyPromotion({
      baseline,
      candidate,
      baselinePolicyId: "stable-prefix.v0",
      candidatePolicyId: "stable-prefix.v1",
      rollbackPolicyId: "stable-prefix.v0",
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toEqual(expect.arrayContaining([
      "item task-1 output changed",
      "item task-1 authority evidence changed",
      "item task-1 tool trajectory changed",
      "scorer accuracy regressed by -0.19999999999999996",
    ]));
  });

  it("blocks cache policy promotion without measured cached-token gain", () => {
    const result = evaluateCachePolicyPromotion({
      baseline: cacheExperiment("baseline", {
        cachedInputTokens: 1200,
        policyId: "stable-prefix.v0",
      }),
      candidate: cacheExperiment("candidate", {
        cachedInputTokens: 1200,
        policyId: "stable-prefix.v1",
      }),
      baselinePolicyId: "stable-prefix.v0",
      candidatePolicyId: "stable-prefix.v1",
      rollbackPolicyId: "stable-prefix.v0",
    });

    expect(result.status).toBe("blocked");
    expect(result.issues).toContain("candidate did not improve cached input tokens");
  });
});

function cacheExperiment(
  name: string,
  options: {
    readonly cachedInputTokens: number;
    readonly policyId: string;
    readonly output?: string;
    readonly authority?: Record<string, unknown>;
    readonly toolCalls?: readonly { readonly name: string; readonly args?: Record<string, unknown> }[];
    readonly accuracyScore?: number;
  },
): Experiment {
  return {
    name,
    datasetName: "cache-fixture",
    scorers: ["accuracy", "cache-topology"],
    results: [{
      itemId: "task-1",
      output: options.output ?? "unchanged",
      scores: [
        { name: "accuracy", score: options.accuracyScore ?? 1 },
        { name: "cache-topology", score: 1 },
      ],
      durationMs: 100,
      tokenUsage: { inputTokens: 2000, outputTokens: 20 },
      trial: { status: "valid" },
      metadata: {
        activeAgentId: "kiln-tool-agent",
        authority: options.authority ?? { scope: "read" },
        cachePolicyId: options.policyId,
        toolCalls: options.toolCalls ?? [{ name: "read_file", args: { path: "docs/a.md" } }],
        cacheGainComparisons: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          baselineInputTokens: 2000,
          candidateInputTokens: 2000,
          baselineCachedInputTokens: name === "baseline" ? options.cachedInputTokens : 0,
          candidateCachedInputTokens: name === "candidate" ? options.cachedInputTokens : 0,
        }],
      },
    }],
    startedAt: "2026-07-04T00:00:00.000Z",
    completedAt: "2026-07-04T00:01:00.000Z",
  };
}
