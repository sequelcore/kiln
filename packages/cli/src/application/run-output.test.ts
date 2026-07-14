import { describe, expect, it } from "vitest";
import { buildRunJsonOutputEnvelope } from "./run-output.js";

const base = {
  answer: "done",
  sessionId: "session-1",
  task: "test",
  domain: "default",
  sessionSucceeded: true,
  costUsd: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCallCount: 0,
  turnDepth: 1,
  startedAt: "2026-07-12T00:00:00.000Z",
  completedAt: "2026-07-12T00:00:01.000Z",
  durationMs: 1_000,
  lastError: null,
  attempts: [],
  exactArtifacts: [],
} as const;

describe("buildRunJsonOutputEnvelope", () => {
  it("keeps the existing JSON shape when context evidence is absent", () => {
    expect(buildRunJsonOutputEnvelope(base).telemetry).not.toHaveProperty("contextUsage");
  });

  it("preserves the shared projection without reinterpreting it", () => {
    const contextUsage = {
      state: "partial" as const,
      usedTokens: 12_000,
      contextWindowTokens: 128_000,
      remainingTokens: 116_000,
      usedPercentage: 9.375,
      providerId: "codex-oauth",
      modelId: "gpt-5.6-terra",
      turnId: "turn-1",
      observedAt: "2026-07-12T00:00:01.000Z",
      measurement: "provider_reported" as const,
      lifecycle: "completed" as const,
      contextWindowAuthority: "runtime_observed" as const,
      freshness: "fresh" as const,
    };

    expect(buildRunJsonOutputEnvelope({ ...base, contextUsage }).telemetry.contextUsage).toEqual(contextUsage);
  });

  it("emits the canonical efficiency view beside outcome telemetry", () => {
    const efficiencyEvidence = efficiencyFixture();
    expect(buildRunJsonOutputEnvelope({ ...base, efficiencyEvidence }).telemetry.efficiencyEvidence).toEqual(
      efficiencyEvidence,
    );
  });
});

function efficiencyFixture() {
  return {
    schemaVersion: "verified-efficiency-evidence-v1" as const,
    sessionId: "session-1",
    observedAt: "2026-07-12T00:00:01.000Z",
    provider: { providerId: "codex-oauth", modelId: "gpt-5.6-terra", billingMode: "subscription" },
    policy: {
      owner: "ContextGovernor",
      policyId: "context-whole-block-static-v1",
      configurationHash: `sha256:${"a".repeat(64)}`,
    },
    totals: {
      providerTotalTokens: 10,
      providerTotalCostUsd: 0,
      measured: { tokens: 2, costUsd: 0 },
      estimated: { tokens: 0, costUsd: 0 },
      cached: { tokens: 3, costUsd: 0 },
      unknown: { tokens: 5, costUsd: 0 },
      cacheWritten: { tokens: 0, costUsd: 0 },
      avoided: { tokens: 0, costUsd: 0 },
    },
    outcome: "succeeded" as const,
    verification: { status: "not_run" as const, results: [] },
    actions: [],
    savings: [],
    evidenceUris: [],
  };
}
