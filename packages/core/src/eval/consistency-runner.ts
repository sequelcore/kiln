// ConsistencyRunner: implements tau-bench pass^k metric for production readiness evaluation

import type { Experiment } from "./types.js";
import type { ExperimentRunner } from "./experiment-runner.js";
import { KilnError } from "../engine/errors.js";

export interface ConsistencyItemResult {
  readonly itemId: string;
  readonly passCount: number;
  readonly totalRuns: number;
  readonly allPassed: boolean;
}

export interface ConsistencyResult {
  readonly experimentName: string;
  readonly datasetName: string;
  readonly k: number;
  readonly passThreshold: number;
  readonly runs: readonly Experiment[];
  readonly itemResults: readonly ConsistencyItemResult[];
  readonly passAtK: number;
}

export interface ConsistencyRunnerConfig {
  readonly runner: ExperimentRunner;
  readonly k: number;
  readonly passThreshold?: number;
}

export class ConsistencyRunner {
  constructor(private readonly config: ConsistencyRunnerConfig) {
    if (config.k < 1) {
      throw new KilnError("EVAL_SCORER_FAILED", "ConsistencyRunner k must be >= 1", {
        context: { k: config.k },
      });
    }
  }

  async run(): Promise<ConsistencyResult> {
    const { runner, k, passThreshold = 1.0 } = this.config;
    const runs: Experiment[] = [];

    for (let i = 0; i < k; i++) {
      runs.push(await runner.run());
    }

    const firstRun = runs[0]!;
    const itemIds = firstRun.results.map((r) => r.itemId);

    const itemResults: ConsistencyItemResult[] = itemIds.map((itemId) => {
      let passCount = 0;
      for (const run of runs) {
        const result = run.results.find((r) => r.itemId === itemId);
        if (result && result.scores.every((s) => s.score >= passThreshold)) {
          passCount++;
        }
      }
      return { itemId, passCount, totalRuns: k, allPassed: passCount === k };
    });

    const passAtK = itemIds.length === 0 ? 1.0 : itemResults.filter((r) => r.allPassed).length / itemIds.length;

    return {
      experimentName: firstRun.name,
      datasetName: firstRun.datasetName,
      k,
      passThreshold,
      runs,
      itemResults,
      passAtK,
    };
  }
}
