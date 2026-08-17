import { describe, expect, it } from "vitest";
import {
  observeStandaloneEffectivePrompt,
  projectFinalEffectivePromptObservation,
  type ProviderRequestEvidence,
} from "../../src/index.js";

function request(
  requestIndex: number,
  finalPromptHash?: string,
): ProviderRequestEvidence {
  return {
    requestIndex,
    providerId: requestIndex === 0 ? "primary" : "fallback",
    modelId: requestIndex === 0 ? "model-a" : "model-b",
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cumulativeInputTokens: requestIndex + 1,
    cumulativeOutputTokens: requestIndex + 1,
    cumulativeCacheReadTokens: 0,
    cumulativeCacheWriteTokens: 0,
    systemBytes: 1,
    messageBytes: 1,
    toolSchemaBytes: 0,
    systemHash: "sha256:system",
    messageHash: "sha256:message",
    toolSchemaHash: "sha256:tools",
    stablePrefixHash: "sha256:prefix",
    stablePrefixBytes: 1,
    stablePrefixRegionCount: 1,
    volatileRegionBytes: 1,
    cacheRegions: [],
    cachePartition: { dimensions: [], hash: "sha256:cache" },
    toolCount: 0,
    ...(finalPromptHash
      ? {
          effectivePrompt: {
            version: "v1" as const,
            components: [
              {
                id: "sha256:component",
                revision: "sha256:revision",
                scope: "static" as const,
                estimatedTokens: 3,
                provenance: { source: "sha256:source" },
              },
              {
                id: "sha256:deferred",
                revision: "sha256:revision",
                scope: "deferred" as const,
                estimatedTokens: 2,
                provenance: { source: "sha256:source", auditDecision: "deferred" as const },
              },
            ],
            finalPromptHash,
            estimatedTokens: 3,
          },
        }
      : {}),
  };
}

describe("projectFinalEffectivePromptObservation", () => {
  it("attributes the observation to the last provider request with exact redacted evidence", () => {
    const observation = projectFinalEffectivePromptObservation([
      request(0, "sha256:primary"),
      request(1, "sha256:fallback"),
    ]);

    expect(observation).toMatchObject({
      version: "v1",
      requestIndex: 1,
      providerId: "fallback",
      modelId: "model-b",
      finalPromptHash: "sha256:fallback",
      estimatedTokens: 3,
      componentCount: 2,
      componentScopeCounts: { static: 1, dynamic: 0, deferred: 1 },
    });
    expect(JSON.stringify(observation)).not.toContain("Private");
  });

  it("does not substitute an earlier manifest when the final request lacks one", () => {
    expect(projectFinalEffectivePromptObservation([
      request(0, "sha256:primary"),
      request(1),
    ])).toBeUndefined();
  });

  it("does not fabricate evidence when no provider request was observed", () => {
    expect(projectFinalEffectivePromptObservation([])).toBeUndefined();
    expect(projectFinalEffectivePromptObservation(undefined)).toBeUndefined();
  });
});

describe("observeStandaloneEffectivePrompt", () => {
  it("attributes a communication component inside the exact final harness prompt without raw text", () => {
    const projection = "\ncommunication-contract";
    const observation = observeStandaloneEffectivePrompt({
      providerId: "codex",
      modelId: "gpt-5.6-sol",
      finalPrompt: `system${projection}\nidentity`,
      communicationProjection: projection,
    });

    expect(observation.componentCount).toBe(3);
    expect(observation.effectivePrompt.components[1]?.id).toMatch(/^sha256:/);
    expect(JSON.stringify(observation)).not.toContain("communication-contract");
  });
});
