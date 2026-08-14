// ConsistencyRunner: implements tau-bench pass^k metric for production readiness evaluation

import type { Experiment } from "./types.js";
import { KilnError } from "../engine/errors.js";

export interface ExperimentExecutor {
  run(itemIds?: readonly string[]): Promise<Experiment>;
}

export interface ConsistencyItemResult {
  readonly itemId: string;
  readonly passCount: number;
  readonly totalRuns: number;
  readonly invalidTrialCount: number;
  readonly allPassed: boolean;
}

export interface ProportionInterval {
  readonly confidence: 0.95;
  readonly lower: number;
  readonly upper: number;
}

export interface ConsistencyResult {
  readonly experimentName: string;
  readonly datasetName: string;
  readonly k: number;
  readonly passThreshold: number;
  readonly runs: readonly Experiment[];
  readonly itemResults: readonly ConsistencyItemResult[];
  readonly passRate: number;
  readonly passRateInterval: ProportionInterval;
  readonly passAtK: number;
  readonly passAtKInterval: ProportionInterval;
  readonly validTrialCount: number;
  readonly invalidTrialCount: number;
  readonly invalidTrialRate: number;
  readonly incompleteItemIds: readonly string[];
}

export interface ConsistencyRunnerConfig {
  readonly runner: ExperimentExecutor;
  readonly k: number;
  readonly passThreshold?: number;
  readonly admissionScorers?: readonly string[];
  readonly maxInvalidAttempts?: number;
}

export class ConsistencyRunner {
  constructor(private readonly config: ConsistencyRunnerConfig) {
    if (config.k < 1) {
      throw new KilnError("EVAL_SCORER_FAILED", "ConsistencyRunner k must be >= 1", {
        context: { k: config.k },
      });
    }
    if (config.maxInvalidAttempts !== undefined && config.maxInvalidAttempts < 0) {
      throw new KilnError("EVAL_SCORER_FAILED", "ConsistencyRunner maxInvalidAttempts must be >= 0", {
        context: { maxInvalidAttempts: config.maxInvalidAttempts },
      });
    }
  }

  async run(): Promise<ConsistencyResult> {
    const {
      runner,
      k,
      passThreshold = 1.0,
      admissionScorers,
      maxInvalidAttempts = 0,
    } = this.config;
    const runs: Experiment[] = [];
    const validByItem = new Map<string, boolean[]>();
    const invalidByItem = new Map<string, number>();
    let itemIds: readonly string[] = [];

    for (let i = 0; i < k + maxInvalidAttempts; i++) {
      const pendingItemIds = i === 0
        ? undefined
        : itemIds.filter((itemId) => validByItem.get(itemId)!.length < k);
      if (pendingItemIds?.length === 0) break;
      const run = await runner.run(pendingItemIds);
      runs.push(run);
      if (i === 0) {
        itemIds = run.results.map((result) => result.itemId);
        for (const itemId of itemIds) {
          validByItem.set(itemId, []);
          invalidByItem.set(itemId, 0);
        }
      }
      for (const itemId of itemIds) {
        const result = run.results.find((candidate) => candidate.itemId === itemId);
        const validTrials = validByItem.get(itemId)!;
        if (validTrials.length >= k) continue;
        if (!result || result.trial.status === "invalid") {
          invalidByItem.set(itemId, (invalidByItem.get(itemId) ?? 0) + 1);
          continue;
        }
        validTrials.push(passedAdmissionScorers(result.scores, admissionScorers, passThreshold));
      }
      if (itemIds.every((itemId) => validByItem.get(itemId)!.length >= k)) break;
    }

    const firstRun = runs[0]!;
    const itemResults: ConsistencyItemResult[] = itemIds.map((itemId) => {
      const trials = validByItem.get(itemId)!;
      const passCount = trials.filter(Boolean).length;
      return {
        itemId,
        passCount,
        totalRuns: trials.length,
        invalidTrialCount: invalidByItem.get(itemId) ?? 0,
        allPassed: trials.length === k && passCount === k,
      };
    });

    const validTrialCount = itemResults.reduce((total, item) => total + item.totalRuns, 0);
    const invalidTrialCount = itemResults.reduce((total, item) => total + item.invalidTrialCount, 0);
    const passedTrialCount = itemResults.reduce((total, item) => total + item.passCount, 0);
    const passedItemCount = itemResults.filter((item) => item.allPassed).length;
    const passRate = validTrialCount === 0 ? 0 : passedTrialCount / validTrialCount;
    const passAtK = itemIds.length === 0 ? 0 : passedItemCount / itemIds.length;
    const totalAttempts = validTrialCount + invalidTrialCount;
    const incompleteItemIds = itemResults.filter((item) => item.totalRuns < k).map((item) => item.itemId);

    return {
      experimentName: firstRun.name,
      datasetName: firstRun.datasetName,
      k,
      passThreshold,
      runs,
      itemResults,
      passRate,
      passRateInterval: wilsonInterval(passedTrialCount, validTrialCount),
      passAtK,
      passAtKInterval: wilsonInterval(passedItemCount, itemIds.length),
      validTrialCount,
      invalidTrialCount,
      invalidTrialRate: totalAttempts === 0 ? 0 : invalidTrialCount / totalAttempts,
      incompleteItemIds,
    };
  }
}

function passedAdmissionScorers(
  scores: Experiment["results"][number]["scores"],
  admissionScorers: readonly string[] | undefined,
  passThreshold: number,
): boolean {
  if (!admissionScorers) return scores.every((score) => score.score >= passThreshold);
  const byName = new Map(scores.map((score) => [score.name, score]));
  return admissionScorers.every((name) => (byName.get(name)?.score ?? 0) >= passThreshold);
}

function wilsonInterval(successes: number, total: number): ProportionInterval {
  if (total === 0) return { confidence: 0.95, lower: 0, upper: 1 };
  const z = 1.959963984540054;
  const proportion = successes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const center = (proportion + zSquared / (2 * total)) / denominator;
  const margin = z * Math.sqrt((proportion * (1 - proportion) + zSquared / (4 * total)) / total) / denominator;
  return {
    confidence: 0.95,
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
  };
}
