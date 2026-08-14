// ExperimentRunner: executes an experiment by generating outputs and scoring them

import type { Scorer, Dataset, DatasetItem, Experiment, ExperimentResult, EvalInput } from "./types.js";
import { KilnError } from "../engine/errors.js";

export interface GenerateOutputResult {
  readonly output: string;
  readonly durationMs: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly trial?: { readonly status: "valid" | "invalid"; readonly reason?: string };
  readonly metadata?: Record<string, unknown>;
}

export interface ExperimentRunnerConfig {
  readonly scorers: readonly Scorer[];
  readonly dataset: Dataset;
  readonly experimentName: string;
  readonly generateOutput: (input: string, item: DatasetItem) => Promise<GenerateOutputResult>;
}

export class ExperimentRunner {
  constructor(private readonly config: ExperimentRunnerConfig) {}

  async run(itemIds?: readonly string[]): Promise<Experiment> {
    const startedAt = new Date().toISOString();
    const results: ExperimentResult[] = [];
    const selected = itemIds === undefined ? undefined : new Set(itemIds);

    for (const item of this.config.dataset.items) {
      if (selected && !selected.has(item.id)) continue;
      const generated = await this.config.generateOutput(item.input, item);

      const evalInput: EvalInput = {
        input: item.input,
        output: generated.output,
        expected: item.expected,
        context: item.context,
        durationMs: generated.durationMs,
        costUsd: generated.costUsd,
        metadata: mergeMetadata(item.metadata, generated.metadata),
      };

      const scores = await Promise.all(
        this.config.scorers.map(async (s) => {
          try {
            return await s.score(evalInput);
          } catch (err) {
            return {
              name: s.name,
              score: 0,
              reasoning: err instanceof KilnError ? err.message : String(err),
            };
          }
        }),
      );

      results.push({
        itemId: item.id,
        output: generated.output,
        scores,
        durationMs: generated.durationMs,
        costUsd: generated.costUsd,
        tokenUsage: {
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
        },
        trial: generated.trial ?? { status: "valid" },
        metadata: evalInput.metadata,
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

function mergeMetadata(
  expected: Record<string, unknown> | undefined,
  actual: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!expected && !actual) return undefined;
  return {
    ...(expected ?? {}),
    ...(actual ?? {}),
  };
}
