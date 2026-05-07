import { describe, expect, it } from "vitest";
import {
  createProviderModelRouteHealthRecord,
  evaluateProviderModelRouteHealth,
  formatProviderModelRouteCooldown,
  mapProviderModelRouteErrorToOutcome,
} from "../../src/agents/index.js";

describe("provider model route health", () => {
  it("marks retryable outcomes as cooling down", () => {
    const now = Date.parse("2026-05-07T05:00:00.000Z");
    const record = createProviderModelRouteHealthRecord({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      outcome: { type: "rate-limited" },
      errorMessage: "openrouter API error 429",
      now,
    });

    expect(record).toMatchObject({
      providerId: "openrouter",
      modelId: "qwen/qwen3-coder:free",
      requestCount: 1,
      lastSuccess: null,
      lastFailure: now,
      lastOutcome: { type: "rate-limited" },
      lastError: "openrouter API error 429",
    });
    expect(record.cooldownUntil).toBeGreaterThan(now);
    expect(evaluateProviderModelRouteHealth(record, now)).toMatchObject({
      healthy: false,
      reason: "Provider 'openrouter' model 'qwen/qwen3-coder:free' is cooling down after rate-limited",
    });
  });

  it("does not cool down auth failures", () => {
    const record = createProviderModelRouteHealthRecord({
      providerId: "openrouter",
      modelId: "openrouter/free",
      outcome: { type: "auth-failed" },
      now: Date.parse("2026-05-07T05:00:00.000Z"),
    });

    expect(record.cooldownUntil).toBeNull();
    expect(evaluateProviderModelRouteHealth(record)).toEqual({ healthy: true });
  });

  it("maps provider error messages to canonical outcomes", () => {
    expect(mapProviderModelRouteErrorToOutcome("openrouter API error 429: upstream limited")).toEqual({
      type: "rate-limited",
    });
    expect(mapProviderModelRouteErrorToOutcome("openrouter API error 402: insufficient credits")).toEqual({
      type: "quota-exceeded",
    });
  });

  it("formats cooldown diagnostics with expiration time", () => {
    expect(formatProviderModelRouteCooldown({
      healthy: false,
      reason: "Provider 'openrouter' model 'x' is cooling down after rate-limited",
      cooldownUntil: Date.parse("2026-05-07T06:00:00.000Z"),
    })).toBe("Provider 'openrouter' model 'x' is cooling down after rate-limited until 2026-05-07T06:00:00.000Z");
  });
});
