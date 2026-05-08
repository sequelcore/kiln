import type { ArtifactResourceStore } from "../tools/index.js";
import type { BenchmarkBaselineResult, BenchmarkProfile } from "./benchmark-baseline.js";
import { ConsistencyRunner, type ConsistencyResult } from "./consistency-runner.js";
import { ExperimentRunner, type GenerateOutputResult } from "./experiment-runner.js";
import type { Dataset, DatasetItem, Scorer } from "./types.js";

const DEFAULT_ARTIFACT_NAMESPACE = "benchmark-baselines";

export interface BenchmarkItemExecutionContext {
  readonly profile: BenchmarkProfile;
  readonly datasetName: string;
  readonly datasetVersion: string;
  readonly runIndex: number;
  readonly item: DatasetItem;
}

export type BenchmarkItemExecutor = (
  input: string,
  context: BenchmarkItemExecutionContext,
) => Promise<GenerateOutputResult>;

export interface BenchmarkBaselineRunnerOptions {
  readonly profile: BenchmarkProfile;
  readonly dataset: Dataset;
  readonly datasetVersion: string;
  readonly k: number;
  readonly configHash: string;
  readonly scorers: readonly Scorer[];
  readonly artifactStore: ArtifactResourceStore;
  readonly executeItem: BenchmarkItemExecutor;
  readonly artifactNamespace?: string;
}

export interface BenchmarkBaselineRunResult {
  readonly baseline: BenchmarkBaselineResult;
  readonly consistency: ConsistencyResult;
  readonly artifactUris: readonly string[];
}

export class BenchmarkBaselineRunner {
  constructor(private readonly options: BenchmarkBaselineRunnerOptions) {}

  async run(): Promise<BenchmarkBaselineRunResult> {
    const namespace = this.options.artifactNamespace ?? DEFAULT_ARTIFACT_NAMESPACE;
    let nextRunIndex = 0;
    let activeRunIndex = 0;
    const runner = new ExperimentRunner({
      dataset: this.options.dataset,
      experimentName: `${this.options.profile.id}:${this.options.dataset.name}`,
      scorers: this.options.scorers,
      generateOutput: async (input, item) => {
        return this.options.executeItem(input, {
          profile: this.options.profile,
          datasetName: this.options.dataset.name,
          datasetVersion: this.options.datasetVersion,
          runIndex: activeRunIndex,
          item,
        });
      },
    });
    const consistency = await new ConsistencyRunner({
      runner: {
        run: async () => {
          activeRunIndex = nextRunIndex;
          nextRunIndex += 1;
          return runner.run();
        },
      },
      k: this.options.k,
    }).run();

    const artifact = this.options.artifactStore.put({
      namespace,
      title: `${this.options.profile.id} ${this.options.dataset.name} baseline`,
      mimeType: "application/json",
      content: {
        type: "json",
        value: {
          profileId: this.options.profile.id,
          profileVersion: this.options.profile.version,
          datasetName: this.options.dataset.name,
          datasetVersion: this.options.datasetVersion,
          k: this.options.k,
          configHash: this.options.configHash,
          consistency,
        },
      },
      producer: {
        kind: "eval",
        name: "benchmark-baseline-runner",
      },
      retention: {
        scope: "session",
      },
    });
    const artifactUri = `kiln://artifacts/${artifact.namespace}/${artifact.id}/content`;
    const baseline: BenchmarkBaselineResult = {
      profileId: this.options.profile.id,
      profileVersion: this.options.profile.version,
      datasetName: this.options.dataset.name,
      datasetVersion: this.options.datasetVersion,
      k: this.options.k,
      passAtK: consistency.passAtK,
      scorers: this.options.scorers.map((scorer) => scorer.name),
      artifactUris: [artifactUri],
      configHash: this.options.configHash,
    };

    return {
      baseline,
      consistency,
      artifactUris: [artifactUri],
    };
  }
}
