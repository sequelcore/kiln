// Tests for ExperimentRunner

import { describe, it, expect } from "vitest";
import { ExperimentRunner } from "../../src/eval/experiment-runner.js";
import type { Dataset, Scorer } from "../../src/eval/types.js";

class MockScorer implements Scorer {
  readonly name = "mock";
  async score() {
    return { name: this.name, score: 0.5 };
  }
}

describe("ExperimentRunner", () => {
  const dataset: Dataset = {
    name: "test-dataset",
    items: [
      { id: "1", input: "question 1", expected: "answer 1" },
      { id: "2", input: "question 2" },
    ],
  };

  const scorers: readonly Scorer[] = [new MockScorer()];

  it("runs all items through generateOutput + scorers", async () => {
    const runner = new ExperimentRunner({
      scorers,
      dataset,
      experimentName: "test-exp",
      generateOutput: async (input) => ({
        output: `response to: ${input}`,
        durationMs: 100,
        costUsd: 0.01,
        inputTokens: 10,
        outputTokens: 20,
      }),
    });

    const result = await runner.run();

    expect(result.name).toBe("test-exp");
    expect(result.datasetName).toBe("test-dataset");
    expect(result.results).toHaveLength(2);
  });

  it("results have correct itemIds", async () => {
    const runner = new ExperimentRunner({
      scorers,
      dataset,
      experimentName: "test-exp",
      generateOutput: async () => ({
        output: "response",
        durationMs: 50,
        costUsd: 0.01,
        inputTokens: 5,
        outputTokens: 10,
      }),
    });

    const result = await runner.run();

    expect(result.results[0]?.itemId).toBe("1");
    expect(result.results[1]?.itemId).toBe("2");
  });

  it("timestamps are ISO 8601 strings", async () => {
    const runner = new ExperimentRunner({
      scorers,
      dataset,
      experimentName: "test-exp",
      generateOutput: async () => ({
        output: "response",
        durationMs: 50,
        costUsd: 0.01,
        inputTokens: 5,
        outputTokens: 10,
      }),
    });

    const result = await runner.run();

    expect(result.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("durationMs and costUsd propagated to scorers", async () => {
    let receivedDuration: number | undefined;
    let receivedCost: number | undefined;

    const trackingScorer: Scorer = {
      name: "tracker",
      async score(input) {
        receivedDuration = input.durationMs;
        receivedCost = input.costUsd;
        return { name: "tracker", score: 1 };
      },
    };

    const runner = new ExperimentRunner({
      scorers: [trackingScorer],
      dataset: { name: "d", items: [{ id: "1", input: "q" }] },
      experimentName: "test",
      generateOutput: async () => ({
        output: "response",
        durationMs: 123,
        costUsd: 0.045,
        inputTokens: 5,
        outputTokens: 10,
      }),
    });

    await runner.run();

    expect(receivedDuration).toBe(123);
    expect(receivedCost).toBe(0.045);
  });

  it("continues when scorer throws", async () => {
    const failingScorer: Scorer = {
      name: "failing",
      async score() {
        throw new Error("Scorer crashed");
      },
    };

    const successScorer: Scorer = {
      name: "success",
      async score() {
        return { name: "success", score: 0.8 };
      },
    };

    const runner = new ExperimentRunner({
      scorers: [failingScorer, successScorer],
      dataset: { name: "d", items: [{ id: "1", input: "q" }] },
      experimentName: "test",
      generateOutput: async () => ({
        output: "response",
        durationMs: 50,
        costUsd: 0.01,
        inputTokens: 5,
        outputTokens: 10,
      }),
    });

    const result = await runner.run();

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.scores).toHaveLength(2);
    expect(result.results[0]?.scores[0]?.score).toBe(0);
    expect(result.results[0]?.scores[0]?.reasoning).toContain("crashed");
    expect(result.results[0]?.scores[1]?.score).toBe(0.8);
  });
});
