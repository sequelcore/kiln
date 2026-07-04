import { describe, expect, it } from "vitest";
import { KILN_BENCHMARK_PROFILES, createBenchmarkProfileScorers } from "../../src/index.js";

describe("createBenchmarkProfileScorers", () => {
  it("creates one structural scorer per required benchmark scorer", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-managed-child-agent")!;
    const scorers = createBenchmarkProfileScorers(profile);

    expect(scorers.map((scorer) => scorer.name)).toEqual(profile.requiredScorers);
    await expect(scorers[0]!.score({
      input: "delegate",
      output: "child result",
      metadata: {
        expectedAgentId: "kiln-managed-child-agent",
        activeAgentId: "kiln-managed-child-agent",
        expectedToolCalls: [{ name: "managed_agent.invoke" }],
        toolCalls: [{ name: "managed_agent.invoke" }],
      },
    })).resolves.toMatchObject({ score: 1 });
  });

  it("keeps expected tool recall separate from bounded supporting calls", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const scorers = createBenchmarkProfileScorers(profile);
    const accuracy = scorers.find((scorer) => scorer.name === "tool-calling-accuracy")!;
    const trajectory = scorers.find((scorer) => scorer.name === "tool-trajectory")!;
    const input = {
      input: "Read and verify docs.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        allowedExtraToolCalls: ["grep"],
        toolCalls: [{ name: "read", args: { filePath: "docs/a.md" } }, { name: "grep", args: { pattern: "authority" } }],
      },
    };

    await expect(accuracy.score(input)).resolves.toMatchObject({ score: 1 });
    await expect(trajectory.score(input)).resolves.toMatchObject({ score: 1 });
  });

  it("fails trajectory for prohibited tools, exact redundant calls, and declared tool budget excess", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const trajectory = createBenchmarkProfileScorers(profile).find((scorer) => scorer.name === "tool-trajectory")!;

    await expect(trajectory.score({
      input: "Read only.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        forbiddenToolCalls: [{ name: "write" }],
        toolCalls: [{ name: "read" }, { name: "write" }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("forbidden") });

    await expect(trajectory.score({
      input: "Read once.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "read" }],
        toolCalls: [{ name: "read", args: { filePath: "docs/a.md" } }, { name: "read", args: { filePath: "docs/a.md" } }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("redundant") });

    await expect(trajectory.score({
      input: "Search.",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "grep" }],
        toolBudgets: { maxToolCalls: 1 },
        toolCalls: [{ name: "grep" }, { name: "read" }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("tool budget") });
  });

  it("scores cache topology only when request evidence includes prefix partition and invalid-reuse probes", async () => {
    const profile = KILN_BENCHMARK_PROFILES.find((entry) => entry.id === "kiln-tool-agent")!;
    const scorer = createBenchmarkProfileScorers(profile).find((entry) => entry.name === "cache-topology")!;

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
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
              { source: "tenant", hash: "sha256:1111111111111111111111111111111111111111111111111111111111111111", evidenceBasis: "session tenant identity" },
              { source: "route", hash: "sha256:2222222222222222222222222222222222222222222222222222222222222222", evidenceBasis: "provider route identity" },
              { source: "policy", hash: "sha256:3333333333333333333333333333333333333333333333333333333333333333", evidenceBasis: "policy identity" },
              { source: "authority", hash: "sha256:4444444444444444444444444444444444444444444444444444444444444444", evidenceBasis: "authority scope" },
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
    })).resolves.toMatchObject({ score: 1 });

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [],
          cachePartition: {
            hash: "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            dimensions: [],
          },
        }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("partition") });

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [
            { source: "tool_schema", stability: "stable", hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bytes: 80, includedInStablePrefix: true },
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
        cacheGainComparisons: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          baselineInputTokens: 2000,
          candidateInputTokens: 2000,
          baselineCachedInputTokens: 0,
          candidateCachedInputTokens: 1200,
        }],
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("invalid-reuse") });

    await expect(scorer.score({
      input: "Use stable tools.",
      output: "done",
      metadata: {
        providerRequests: [{
          stablePrefixHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          stablePrefixBytes: 120,
          stablePrefixRegionCount: 2,
          volatileRegionBytes: 40,
          cacheRegions: [
            { source: "tool_schema", stability: "stable", hash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", bytes: 80, includedInStablePrefix: true },
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
      },
    })).resolves.toMatchObject({ score: 0, reasoning: expect.stringContaining("cache gain") });
  });
});
