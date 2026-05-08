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
          toolCalls: context.item.id === "first"
            ? [{ name: "status" }]
            : [{ name: "resource_read" }],
        },
      }),
    });

    const result = await runner.run();

    expect(result.baseline).toMatchObject({
      profileId: "kiln-tool-agent",
      profileVersion: "1",
      datasetName: "kiln-tool-agent-v1",
      datasetVersion: "v1",
      k: profile.minimumK,
      passAtK: 1,
      configHash: "sha256:test",
    });
    expect(result.baseline.scorers).toEqual(profile.requiredScorers);
    expect(result.baseline.artifactUris).toEqual(["kiln://artifacts/benchmark-baselines/artifact_1/content"]);
    expect(artifactStore.get("benchmark-baselines", "artifact_1")?.content).toMatchObject({
      type: "json",
    });
  });
});
