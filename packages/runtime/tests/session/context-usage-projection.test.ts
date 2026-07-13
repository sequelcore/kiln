import { describe, expect, it } from "vitest";
import {
  normalizeContextUsageProjection,
  restoreContextUsageProjection,
} from "../../src/session/context-usage-projection.js";

const base = {
  providerId: "codex-oauth",
  modelId: "gpt-5.6-terra",
  turnId: "turn-1",
  observedAt: "2026-07-12T18:00:00.000Z",
  usage: { inputTokens: 12_000, cacheReadTokens: 3_000, cacheWriteTokens: 0, cacheSemantics: "included_in_input" as const },
  contextWindow: {
    providerId: "codex-oauth",
    modelId: "gpt-5.6-terra",
    tokens: 128_000,
    authority: "provider_reported" as const,
    freshness: "fresh" as const,
  },
  measurement: "provider_reported" as const,
  lifecycle: "completed" as const,
};

describe("normalizeContextUsageProjection", () => {
  it("fails closed when a numerator or denominator is missing", () => {
    expect(normalizeContextUsageProjection({ ...base, usage: undefined }).state).toBe("unavailable");
    expect(normalizeContextUsageProjection({ ...base, contextWindow: undefined }).state).toBe("unavailable");
  });

  it("uses OpenAI/Codex input as inclusive of cached input", () => {
    expect(normalizeContextUsageProjection(base)).toMatchObject({
      state: "authoritative",
      usedTokens: 12_000,
      remainingTokens: 116_000,
      usedPercentage: 9.375,
    });
  });

  it("adds Anthropic cache read/write tokens because its input is uncached", () => {
    expect(normalizeContextUsageProjection({
      ...base,
      providerId: "anthropic",
      modelId: "claude-sonnet",
      usage: { inputTokens: 10_000, cacheReadTokens: 1_500, cacheWriteTokens: 500, cacheSemantics: "additive_to_input" },
      contextWindow: { ...base.contextWindow, providerId: "anthropic", modelId: "claude-sonnet" },
    })).toMatchObject({ state: "authoritative", usedTokens: 12_000 });
  });

  it("keeps estimates, stale catalog evidence, and non-final streaming observations partial", () => {
    expect(normalizeContextUsageProjection({ ...base, measurement: "runtime_estimate" }).state).toBe("partial");
    expect(normalizeContextUsageProjection({
      ...base,
      contextWindow: { ...base.contextWindow, authority: "inferred", freshness: "stale" },
    })).toMatchObject({ state: "partial", usedPercentage: 9.375 });
    expect(normalizeContextUsageProjection({ ...base, lifecycle: "streaming" }).state).toBe("partial");
  });

  it("rejects mismatched routes, invalid values, and zero windows", () => {
    expect(normalizeContextUsageProjection({
      ...base,
      contextWindow: { ...base.contextWindow, modelId: "gpt-5.6-sol" },
    })).toMatchObject({ state: "unavailable", reason: expect.stringMatching(/match/i) });
    expect(normalizeContextUsageProjection({ ...base, usage: { inputTokens: -1, cacheReadTokens: 0, cacheWriteTokens: 0, cacheSemantics: "included_in_input" } }).state).toBe("unavailable");
    expect(normalizeContextUsageProjection({ ...base, contextWindow: { ...base.contextWindow, tokens: 0 } }).state).toBe("unavailable");
  });

  it("bounds over-window measurements and never adds output or reasoning tokens", () => {
    expect(normalizeContextUsageProjection({
      ...base,
      usage: { inputTokens: 200_000, cacheReadTokens: 0, cacheWriteTokens: 0, cacheSemantics: "included_in_input", outputTokens: 50_000, reasoningTokens: 30_000 },
    })).toMatchObject({ usedTokens: 200_000, remainingTokens: 0, usedPercentage: 100 });
  });

  it("does not merge managed-child usage into its parent turn", () => {
    expect(normalizeContextUsageProjection({ ...base, scope: "managed_child" })).toMatchObject({
      state: "unavailable",
      reason: expect.stringMatching(/child/i),
    });
  });

  it("preserves historical authority without presenting replay as live", () => {
    const restored = restoreContextUsageProjection(normalizeContextUsageProjection(base));
    expect(restored).toMatchObject({ state: "authoritative", lifecycle: "restored", freshness: "historical" });
  });
});
