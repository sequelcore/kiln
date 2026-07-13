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
});
