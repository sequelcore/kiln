import { describe, expect, it } from "vitest";
import { projectProviderRequestObservations } from "../../src/application/provider-request-observation-projection.js";

describe("provider request observation projection", () => {
  it("projects Runtime evidence per physical attempt without private correlation hashes", () => {
    const observations = projectProviderRequestObservations({
      routeId: "codex-luna",
      requests: [{
        requestIndex: 0,
        providerResponseObserved: true,
        providerId: "codex-oauth",
        modelId: "gpt-5.6-luna",
        deliberation: { status: "exact", selectedLevel: "low" },
        authority: {
          requestedAuthority: "read_only",
          admittedAuthority: "read_only",
          completeness: "authoritative",
        },
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cumulativeInputTokens: 10,
        cumulativeOutputTokens: 2,
        cumulativeCacheReadTokens: 0,
        cumulativeCacheWriteTokens: 0,
        systemBytes: 20,
        messageBytes: 10,
        toolSchemaBytes: 0,
        physicalAttempts: [
          { attempt: 1, retry: false, outcome: "failed", failurePhase: "transport" },
          { attempt: 2, retry: true, outcome: "completed", responseStatus: 200 },
        ],
        systemHash: "private-system-hash",
        messageHash: "private-message-hash",
        toolSchemaHash: "private-tool-hash",
        stablePrefixHash: "private-prefix-hash",
        stablePrefixBytes: 20,
        stablePrefixRegionCount: 1,
        volatileRegionBytes: 10,
        cacheRegions: [],
        cachePartition: {
          hash: `sha256:${"1".repeat(64)}`,
          dimensions: [],
        },
        toolCount: 0,
      }],
    });

    expect(observations).toHaveLength(2);
    expect(observations.map((observation) => observation.dispatch.attempt)).toEqual([
      { state: "observed", value: 1 },
      { state: "observed", value: 2 },
    ]);
    expect(observations[1]?.usage.input).toEqual({ tokens: 10, measurement: "estimated" });
    expect(JSON.stringify(observations)).not.toContain("private-");
    expect(JSON.stringify(observations)).not.toContain("Hash");
  });
});
