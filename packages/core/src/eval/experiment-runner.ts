// ExperimentRunner: executes an experiment by generating outputs and scoring them

import type { Scorer, Dataset, Experiment, ExperimentResult, EvalInput } from "./types.js";

export interface GenerateOutputResult {
  readonly output: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ExperimentRunnerConfig {
  readonly scorers: readonly Scorer[];
  readonly dataset: Dataset;
  readonly experimentName: string;
  readonly generateOutput: (input: string) => Promise<GenerateOutputResult>;
}

export class ExperimentRunner {
  constructor(private readonly config: ExperimentRunnerConfig) {}

  async run(): Promise<Experiment> {
    const startedAt = new Date().toISOString();
    const results: ExperimentResult[] = [];

    for (const item of this.config.dataset.items) {
      const generated = await this.config.generateOutput(item.input);

      const evalInput: EvalInput = {
        input: item.input,
        output: generated.output,
        expected: item.expected,
        context: item.context,
        durationMs: generated.durationMs,
        costUsd: generated.costUsd,
      };

      const scores = await Promise.all(
        this.config.scorers.map((s) => s.score(evalInput)),
      );

      results.push({
        itemId: item.id,
        output: generated.output,
        scores,
        durationMs: generated.durationMs,
        tokenUsage: {
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
        },
      });
    }

    return {
      name: this.config.experimentName,
      datasetName: this.config.dataset.name,
      scorers: this.config.scorers.map((s) => s.name),
      results,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }
}
