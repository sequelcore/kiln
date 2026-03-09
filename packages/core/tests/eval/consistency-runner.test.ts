// Tests for ConsistencyRunner

import { describe, it, expect } from "vitest";
import { ConsistencyRunner } from "../../src/eval/consistency-runner.js";
import { ExperimentRunner } from "../../src/eval/experiment-runner.js";
import { KilnError } from "../../src/engine/errors.js";
import type { Dataset, Scorer } from "../../src/eval/types.js";

function createRunner(dataset: Dataset, scorerScore: number): ExperimentRunner {
  const scorer: Scorer = {
    name: "mock",
    async score() {
      return { name: "mock", score: scorerScore };
    },
  };
  return new ExperimentRunner({
    scorers: [scorer],
    dataset,
    experimentName: "test-exp",
    generateOutput: async (input) => ({
      output: `response to: ${input}`,
      durationMs: 50,
      costUsd: 0.01,
      inputTokens: 5,
      outputTokens: 10,
    }),
  });
}

describe("ConsistencyRunner", () => {
  const dataset: Dataset = {
    name: "test-dataset",
    items: [
      { id: "1", input: "q1" },
      { id: "2", input: "q2" },
    ],
  };

  it("computes passAtK = 1.0 when all items pass all runs", async () => {
    const cr = new ConsistencyRunner({ runner: createRunner(dataset, 1.0), k: 3 });
    const result = await cr.run();
    expect(result.passAtK).toBe(1.0);
    expect(result.k).toBe(3);
    expect(result.runs).toHaveLength(3);
    expect(result.itemResults).toHaveLength(2);
    expect(result.itemResults.every((r) => r.allPassed)).toBe(true);
  });

  it("computes passAtK = 0.0 when no items pass threshold", async () => {
    const cr = new ConsistencyRunner({ runner: createRunner(dataset, 0.5), k: 2 });
    const result = await cr.run();
    expect(result.passAtK).toBe(0.0);
    expect(result.itemResults.every((r) => !r.allPassed)).toBe(true);
  });

  it("respects custom passThreshold", async () => {
    const cr = new ConsistencyRunner({
      runner: createRunner(dataset, 0.5),
      k: 2,
      passThreshold: 0.4,
    });
    const result = await cr.run();
    expect(result.passAtK).toBe(1.0);
    expect(result.passThreshold).toBe(0.4);
  });

  it("uses default passThreshold of 1.0", async () => {
    const cr = new ConsistencyRunner({ runner: createRunner(dataset, 0.99), k: 2 });
    const result = await cr.run();
    expect(result.passThreshold).toBe(1.0);
    expect(result.passAtK).toBe(0.0);
  });

  it("handles partial pass across runs", async () => {
    let callCount = 0;
    const variableScorer: Scorer = {
      name: "variable",
      async score() {
        callCount++;
        // First run: all pass. Second run: item 2 fails.
        const score = callCount === 4 ? 0.3 : 1.0;
        return { name: "variable", score };
      },
    };

    const runner = new ExperimentRunner({
      scorers: [variableScorer],
      dataset,
      experimentName: "test-exp",
      generateOutput: async () => ({
        output: "r",
        durationMs: 50,
        costUsd: 0.01,
        inputTokens: 5,
        outputTokens: 10,
      }),
    });

    const cr = new ConsistencyRunner({ runner, k: 2 });
    const result = await cr.run();
    expect(result.passAtK).toBe(0.5);
    expect(result.itemResults[0]!.allPassed).toBe(true);
    expect(result.itemResults[1]!.allPassed).toBe(false);
  });

  it("throws for k < 1", () => {
    expect(() => new ConsistencyRunner({ runner: createRunner(dataset, 1.0), k: 0 })).toThrow(KilnError);
  });

  it("handles empty dataset with passAtK = 1.0", async () => {
    const emptyDataset: Dataset = { name: "empty", items: [] };
    const cr = new ConsistencyRunner({ runner: createRunner(emptyDataset, 1.0), k: 3 });
    const result = await cr.run();
    expect(result.passAtK).toBe(1.0);
    expect(result.itemResults).toHaveLength(0);
  });

  it("populates experimentName and datasetName from first run", async () => {
    const cr = new ConsistencyRunner({ runner: createRunner(dataset, 1.0), k: 1 });
    const result = await cr.run();
    expect(result.experimentName).toBe("test-exp");
    expect(result.datasetName).toBe("test-dataset");
  });

  it("tracks passCount per item", async () => {
    const cr = new ConsistencyRunner({
      runner: createRunner(dataset, 1.0),
      k: 3,
    });
    const result = await cr.run();
    for (const item of result.itemResults) {
      expect(item.passCount).toBe(3);
      expect(item.totalRuns).toBe(3);
    }
  });
});
