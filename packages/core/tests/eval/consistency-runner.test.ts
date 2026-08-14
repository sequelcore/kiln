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

  it("fails closed for an empty dataset", async () => {
    const emptyDataset: Dataset = { name: "empty", items: [] };
    const cr = new ConsistencyRunner({ runner: createRunner(emptyDataset, 1.0), k: 3 });
    const result = await cr.run();
    expect(result.passAtK).toBe(0);
    expect(result.passRate).toBe(0);
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

  it("reports pass^1 separately from pass^k", async () => {
    let callCount = 0;
    const scorer: Scorer = {
      name: "correctness",
      async score() {
        callCount += 1;
        return { name: "correctness", score: callCount === 4 ? 0 : 1 };
      },
    };
    const runner = new ExperimentRunner({
      scorers: [scorer],
      dataset: { name: "one-item", items: [{ id: "only", input: "q" }] },
      experimentName: "test-exp",
      generateOutput: async () => ({
        output: "r",
        durationMs: 1,
        costUsd: 0,
        inputTokens: 1,
        outputTokens: 1,
      }),
    });

    const result = await new ConsistencyRunner({ runner, k: 5 }).run();

    expect(result.passRate).toBe(0.8);
    expect(result.passAtK).toBe(0);
    expect(result.validTrialCount).toBe(5);
    expect(result.passRateInterval).toMatchObject({ confidence: 0.95 });
    expect(result.passRateInterval.lower).toBeLessThan(0.8);
    expect(result.passRateInterval.upper).toBeGreaterThan(0.8);
  });

  it("retries invalid infrastructure trials without scoring them as semantic failures", async () => {
    let runCount = 0;
    const runner = {
      run: async () => {
        runCount += 1;
        return {
          name: "test-exp",
          datasetName: "one-item",
          scorers: ["correctness"],
          startedAt: "2026-08-14T00:00:00.000Z",
          completedAt: "2026-08-14T00:00:01.000Z",
          results: [{
            itemId: "only",
            output: "r",
            scores: [{ name: "correctness", score: runCount === 1 ? 0 : 1 }],
            durationMs: 1,
            costUsd: 0,
            tokenUsage: { inputTokens: 1, outputTokens: 1 },
            trial: runCount === 1
              ? { status: "invalid" as const, reason: "provider unavailable" }
              : { status: "valid" as const },
          }],
        };
      },
    };

    const result = await new ConsistencyRunner({ runner, k: 2, maxInvalidAttempts: 1 }).run();

    expect(result.runs).toHaveLength(3);
    expect(result.validTrialCount).toBe(2);
    expect(result.invalidTrialCount).toBe(1);
    expect(result.passRate).toBe(1);
    expect(result.passAtK).toBe(1);
    expect(result.incompleteItemIds).toEqual([]);
  });

  it("retries only items that still lack valid trials", async () => {
    const requested: Array<readonly string[] | undefined> = [];
    const runner = new ExperimentRunner({
      scorers: [{ name: "correctness", score: async () => ({ name: "correctness", score: 1 }) }],
      dataset: { name: "two-items", items: [{ id: "ready", input: "a" }, { id: "retry", input: "b" }] },
      experimentName: "test-exp",
      generateOutput: async (_input, item) => ({
        output: "ok",
        durationMs: 1,
        costUsd: 0,
        inputTokens: 1,
        outputTokens: 1,
        trial: item.id === "retry" && requested.length === 1
          ? { status: "invalid" as const, reason: "capacity" }
          : { status: "valid" as const },
      }),
    });
    const originalRun = runner.run.bind(runner);
    runner.run = async (itemIds) => {
      requested.push(itemIds);
      return originalRun(itemIds);
    };

    const result = await new ConsistencyRunner({ runner, k: 1, maxInvalidAttempts: 1 }).run();

    expect(requested).toEqual([undefined, ["retry"]]);
    expect(result.runs[1]?.results.map((entry) => entry.itemId)).toEqual(["retry"]);
    expect(result.validTrialCount).toBe(2);
    expect(result.invalidTrialCount).toBe(1);
  });

  it("reports incomplete items when the invalid-trial retry budget is exhausted", async () => {
    const runner = {
      run: async () => ({
        name: "test-exp",
        datasetName: "one-item",
        scorers: ["correctness"],
        startedAt: "2026-08-14T00:00:00.000Z",
        results: [{
          itemId: "only",
          output: "",
          scores: [{ name: "correctness", score: 0 }],
          durationMs: 1,
          costUsd: 0,
          tokenUsage: { inputTokens: 0, outputTokens: 0 },
          trial: { status: "invalid" as const, reason: "route timeout" },
        }],
      }),
    };

    const result = await new ConsistencyRunner({ runner, k: 2, maxInvalidAttempts: 1 }).run();

    expect(result.validTrialCount).toBe(0);
    expect(result.invalidTrialCount).toBe(3);
    expect(result.incompleteItemIds).toEqual(["only"]);
    expect(result.passRate).toBe(0);
    expect(result.passAtK).toBe(0);
  });

  it("uses only admission scorers to determine semantic success", async () => {
    const runner = new ExperimentRunner({
      scorers: [{ name: "correctness", score: async () => ({ name: "correctness", score: 1 }) }, {
        name: "efficiency",
        score: async () => ({ name: "efficiency", score: 0 }),
      }],
      dataset: { name: "one-item", items: [{ id: "only", input: "q" }] },
      experimentName: "test-exp",
      generateOutput: async () => ({ output: "r", durationMs: 1, costUsd: 0, inputTokens: 1, outputTokens: 1 }),
    });

    const result = await new ConsistencyRunner({
      runner,
      k: 2,
      admissionScorers: ["correctness"],
    }).run();

    expect(result.passRate).toBe(1);
    expect(result.passAtK).toBe(1);
  });
});
