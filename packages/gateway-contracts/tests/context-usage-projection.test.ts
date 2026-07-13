import { describe, expect, it } from "vitest";
import {
  ContextUsageProjectionSchema,
  formatContextUsageProjection,
} from "../src/context-usage-projection.js";

describe("ContextUsageProjectionSchema", () => {
  const authoritative = {
    state: "authoritative",
    usedTokens: 12_000,
    contextWindowTokens: 128_000,
    remainingTokens: 116_000,
    usedPercentage: 9.375,
    providerId: "codex-oauth",
    modelId: "gpt-5.6-terra",
    turnId: "turn-1",
    observedAt: "2026-07-12T18:00:00.000Z",
    measurement: "provider_reported",
    lifecycle: "completed",
    contextWindowAuthority: "provider_reported",
    freshness: "fresh",
  } as const;

  it("accepts a route-bound authoritative measurement", () => {
    expect(ContextUsageProjectionSchema.parse(authoritative)).toEqual(authoritative);
  });

  it("rejects an exact percentage without a compatible denominator", () => {
    expect(() => ContextUsageProjectionSchema.parse({
      ...authoritative,
      state: "partial",
      contextWindowTokens: undefined,
      remainingTokens: undefined,
      usedPercentage: 12,
    })).toThrow();
  });

  it("rejects invalid token counts and out-of-range percentages", () => {
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, usedTokens: -1 })).toThrow();
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, usedPercentage: 101 })).toThrow();
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, contextWindowTokens: 0 })).toThrow();
  });

  it("rejects an authoritative state whose lifecycle or source evidence is not authoritative", () => {
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, lifecycle: "streaming" })).toThrow();
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, measurement: "runtime_estimate" })).toThrow();
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, contextWindowAuthority: "runtime_observed" })).toThrow();
    expect(() => ContextUsageProjectionSchema.parse({ ...authoritative, freshness: "stale" })).toThrow();
  });

  it("renders partial and unavailable evidence without fake precision", () => {
    expect(formatContextUsageProjection({
      state: "partial",
      usedTokens: 4_096,
      providerId: "anthropic",
      modelId: "claude-sonnet",
      turnId: "turn-1",
      observedAt: "2026-07-12T18:00:00.000Z",
      measurement: "runtime_estimate",
      lifecycle: "streaming",
      contextWindowAuthority: "inferred",
      freshness: "stale",
      reason: "Model context window is stale.",
    })).toBe("Context partial: 4.1k tokens");
    expect(formatContextUsageProjection({
      state: "unavailable",
      observedAt: "2026-07-12T18:00:00.000Z",
      measurement: "provider_reported",
      lifecycle: "streaming",
      contextWindowAuthority: "unknown",
      freshness: "unknown",
      reason: "Provider has not completed a usage report.",
    })).toBe("Context usage unavailable");
  });
});
