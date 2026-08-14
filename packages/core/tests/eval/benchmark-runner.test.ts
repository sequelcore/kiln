import { describe, expect, it } from "vitest";
import {
  BenchmarkBaselineRunner,
  KILN_BENCHMARK_PROFILES,
  MemoryArtifactResourceStore,
  type EvalInput,
  type EvalScore,
  type Scorer,
} from "../../src/index.js";
import type { Dataset } from "../../src/eval/types.js";

class PassingScorer implements Scorer {
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  async score(_input: EvalInput): Promise<EvalScore> {
    return {
      name: this.name,
      score: 1,
    };
  }
}

describe("BenchmarkBaselineRunner", () => {
  it("runs pass^k through the provided executor and stores a baseline artifact", async () => {
    const profile = KILN_BENCHMARK_PROFILES[0]!;
    const dataset: Dataset = {
      name: "kiln-tool-agent-v1",
      items: [
        {
          id: "first",
          input: "Call the status tool.",
          expected: "status",
          metadata: {
            expectedToolCalls: [{ name: "status" }],
          },
        },
        {
          id: "second",
          input: "Read the tool catalog.",
          expected: "catalog",
          metadata: {
            expectedToolCalls: [{ name: "resource_read" }],
          },
        },
      ],
    };
    const artifactStore = new MemoryArtifactResourceStore({
      now: () => "2026-05-08T10:00:00.000Z",
    });
    const runner = new BenchmarkBaselineRunner({
      profile,
      dataset,
      datasetVersion: "v1",
      k: profile.minimumK,
      configHash: "sha256:test",
      artifactStore,
      scorers: profile.requiredScorers.map((name) => new PassingScorer(name)),
      executeItem: async (_input, context) => ({
        output: `run ${context.runIndex} item ${context.item.id}`,
        durationMs: 10,
        costUsd: 0.01,
        inputTokens: 12,
        outputTokens: 8,
        metadata: {
          providerId: "codex-oauth",
          modelId: "gpt-5.5",
          toolCalls: context.item.id === "first"
            ? [{ name: "status" }]
            : [{ name: "resource_read" }],
          providerRequests: [{
            stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            stablePrefixBytes: 120,
            stablePrefixRegionCount: 2,
            volatileRegionBytes: 40,
            cacheRegions: [
              { source: "tool_schema", stability: "stable", hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bytes: 80, includedInStablePrefix: true },
              { source: "system", stability: "stable", hash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc", bytes: 40, includedInStablePrefix: true },
              { source: "messages", stability: "volatile", hash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd", bytes: 40, includedInStablePrefix: false },
            ],
            cachePartition: {
              hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              dimensions: [
                { source: "tenant", hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111" },
                { source: "route", hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222" },
                { source: "policy", hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333" },
                { source: "authority", hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444" },
              ],
            },
          }],
          cacheInvalidReuseProbes: [{
            stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            leftPartitionHash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            rightPartitionHash: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            changedDimension: "tenant",
          }],
          cacheGainComparisons: [{
            stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            baselineInputTokens: 2000,
            candidateInputTokens: 2000,
            baselineCachedInputTokens: 0,
            candidateCachedInputTokens: 1200,
            baselineLatencyMs: 1500,
            candidateLatencyMs: 900,
            baselineCostUsd: 0.02,
            candidateCostUsd: 0.012,
          }],
        },
      }),
    });

    const result = await runner.run();

    expect(result.baseline).toMatchObject({
      profileId: "kiln-tool-agent",
      profileVersion: "3",
      datasetName: "kiln-tool-agent-v1",
      datasetVersion: "v1",
      k: profile.minimumK,
      passAtK: 1,
      configHash: "sha256:test",
    });
    expect(result.baseline.scorers).toEqual(profile.requiredScorers);
    expect(result.baseline.evidenceArtifacts.map((artifact) => artifact.kind)).toEqual([
      "transcript",
      "tool-calls",
      "diagnostics",
      "usage",
      "route",
      "cost",
      "cache-topology",
      "diff",
      "verification",
      "result",
    ]);
    expect(result.baseline.artifactUris).toEqual(result.baseline.evidenceArtifacts.map((artifact) => artifact.uri));
    expect(artifactStore.get("benchmark-baselines", "artifact_10")?.content).toMatchObject({
      type: "json",
      value: {
        evidenceManifest: {
          version: "benchmark-baseline-evidence.v1",
          artifacts: result.baseline.evidenceArtifacts.filter((artifact) => artifact.kind !== "result"),
        },
      },
    });
    const routeArtifact = artifactStore.get("benchmark-baselines", "artifact_5")?.content;
    expect(routeArtifact).toMatchObject({
      type: "json",
      value: { kind: "route" },
    });
    expect(routeArtifact?.type === "json" ? routeArtifact.value : undefined).toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          providerId: "codex-oauth",
          modelId: "gpt-5.5",
        }),
      ]),
    });
    const diagnosticsArtifact = artifactStore.get("benchmark-baselines", "artifact_3")?.content;
    expect(diagnosticsArtifact?.type === "json" ? diagnosticsArtifact.value : undefined).toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({ trial: { status: "valid" } }),
      ]),
    });
    const cacheTopologyArtifact = artifactStore.get("benchmark-baselines", "artifact_7")?.content;
    expect(cacheTopologyArtifact).toMatchObject({
      type: "json",
      value: { kind: "cache-topology" },
    });
    expect(cacheTopologyArtifact?.type === "json" ? cacheTopologyArtifact.value : undefined).toMatchObject({
      evidence: expect.arrayContaining([
        expect.objectContaining({
          providerRequests: expect.arrayContaining([
            expect.objectContaining({
              stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              stablePrefixBytes: 120,
            }),
          ]),
          cacheInvalidReuseProbes: expect.arrayContaining([
            expect.objectContaining({ changedDimension: "tenant" }),
          ]),
          cacheGainComparisons: expect.arrayContaining([
            expect.objectContaining({
              baselineInputTokens: 2000,
              candidateCachedInputTokens: 1200,
            }),
          ]),
        }),
      ]),
    });
  });
});
