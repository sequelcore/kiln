import type { ArtifactResourceStore } from "../tools/index.js";
import type {
  BenchmarkBaselineResult,
  BenchmarkEvidenceArtifact,
  BenchmarkEvidenceArtifactKind,
  BenchmarkProfile,
} from "./benchmark-baseline.js";
import { ConsistencyRunner, type ConsistencyResult } from "./consistency-runner.js";
import { ExperimentRunner, type GenerateOutputResult } from "./experiment-runner.js";
import type { Dataset, DatasetItem, ExperimentResult, Scorer } from "./types.js";

const DEFAULT_ARTIFACT_NAMESPACE = "benchmark-baselines";
const EVIDENCE_MANIFEST_VERSION = "benchmark-baseline-evidence.v1";

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

    const evidenceArtifacts = this.putEvidenceArtifacts(namespace, consistency);
    const resultArtifact = this.options.artifactStore.put({
      namespace,
      title: `${this.options.profile.id} ${this.options.dataset.name} baseline`,
      mimeType: "application/json",
      content: {
        type: "json",
        value: {
          evidenceManifest: {
            version: EVIDENCE_MANIFEST_VERSION,
            artifacts: evidenceArtifacts,
          },
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
    const resultArtifactUri = artifactUri(resultArtifact.namespace, resultArtifact.id);
    const allEvidenceArtifacts: readonly BenchmarkEvidenceArtifact[] = [
      ...evidenceArtifacts,
      { kind: "result", uri: resultArtifactUri },
    ];
    const baseline: BenchmarkBaselineResult = {
      profileId: this.options.profile.id,
      profileVersion: this.options.profile.version,
      datasetName: this.options.dataset.name,
      datasetVersion: this.options.datasetVersion,
      k: this.options.k,
      passAtK: consistency.passAtK,
      scorers: this.options.scorers.map((scorer) => scorer.name),
      artifactUris: allEvidenceArtifacts.map((artifact) => artifact.uri),
      evidenceArtifacts: allEvidenceArtifacts,
      configHash: this.options.configHash,
    };

    return {
      baseline,
      consistency,
      artifactUris: allEvidenceArtifacts.map((artifact) => artifact.uri),
    };
  }

  private putEvidenceArtifacts(
    namespace: string,
    consistency: ConsistencyResult,
  ): readonly BenchmarkEvidenceArtifact[] {
    const evidence: readonly {
      readonly kind: Exclude<BenchmarkEvidenceArtifactKind, "result">;
      readonly title: string;
      readonly value: unknown;
    }[] = [
      {
        kind: "transcript",
        title: "assistant transcript evidence",
        value: collectResultEvidence(consistency, (result) => ({
          output: result.output,
        })),
      },
      {
        kind: "tool-calls",
        title: "tool call evidence",
        value: collectResultEvidence(consistency, (result) => ({
          toolCalls: readArrayMetadata(result, "toolCalls"),
          managedInvocations: readArrayMetadata(result, "managedInvocations"),
        })),
      },
      {
        kind: "diagnostics",
        title: "diagnostic evidence",
        value: collectResultEvidence(consistency, (result) => ({
          diagnostics: readArrayMetadata(result, "diagnostics"),
          policyViolations: readArrayMetadata(result, "policyViolations"),
          routeFailures: readArrayMetadata(result, "routeFailures"),
        })),
      },
      {
        kind: "usage",
        title: "usage evidence",
        value: collectResultEvidence(consistency, (result) => ({
          durationMs: result.durationMs,
          tokenUsage: result.tokenUsage,
          providerRequests: readArrayMetadata(result, "providerRequests"),
        })),
      },
      {
        kind: "route",
        title: "route evidence",
        value: collectResultEvidence(consistency, (result) => ({
          providerId: readMetadata(result, "providerId"),
          modelId: readMetadata(result, "modelId"),
          provider: readMetadata(result, "provider"),
          model: readMetadata(result, "model"),
          canonicalModel: readMetadata(result, "canonicalModel"),
          activeAgentId: readMetadata(result, "activeAgentId"),
          routeEvidence: readMetadata(result, "routeEvidence"),
          reasoningEffortResolution: readMetadata(result, "reasoningEffortResolution"),
        })),
      },
      {
        kind: "cost",
        title: "cost evidence",
        value: collectResultEvidence(consistency, (result) => ({
          costUsd: result.costUsd,
          costEvidence: readMetadata(result, "costEvidence"),
        })),
      },
      {
        kind: "cache-topology",
        title: "cache topology evidence",
        value: collectResultEvidence(consistency, (result) => ({
          providerRequests: readArrayMetadata(result, "providerRequests"),
          cacheInvalidReuseProbes: readArrayMetadata(result, "cacheInvalidReuseProbes"),
          cacheGainComparisons: readArrayMetadata(result, "cacheGainComparisons"),
        })),
      },
    ];

    return evidence.map((entry) => {
      const artifact = this.options.artifactStore.put({
        namespace,
        title: `${this.options.profile.id} ${this.options.dataset.name} ${entry.title}`,
        mimeType: "application/json",
        content: {
          type: "json",
          value: {
            version: EVIDENCE_MANIFEST_VERSION,
            kind: entry.kind,
            profileId: this.options.profile.id,
            datasetName: this.options.dataset.name,
            datasetVersion: this.options.datasetVersion,
            k: this.options.k,
            evidence: entry.value,
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
      return {
        kind: entry.kind,
        uri: artifactUri(artifact.namespace, artifact.id),
      };
    });
  }
}

function collectResultEvidence(
  consistency: ConsistencyResult,
  project: (result: ExperimentResult) => Record<string, unknown>,
): readonly Record<string, unknown>[] {
  return consistency.runs.flatMap((run, runIndex) =>
    run.results.map((result) =>
      omitUndefined({
        runIndex,
        itemId: result.itemId,
        ...project(result),
      })
    )
  );
}

function omitUndefined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined));
}

function readMetadata(result: ExperimentResult, key: string): unknown {
  return result.metadata?.[key];
}

function readArrayMetadata(result: ExperimentResult, key: string): readonly unknown[] {
  const value = readMetadata(result, key);
  return Array.isArray(value) ? value : [];
}

function artifactUri(namespace: string, id: string): string {
  return `kiln://artifacts/${namespace}/${id}/content`;
}
