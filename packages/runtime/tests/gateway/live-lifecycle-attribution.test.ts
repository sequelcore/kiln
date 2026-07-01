import { describe, expect, it } from "vitest";
import { projectLiveLifecycleAttribution } from "../../src/gateway/live-lifecycle-attribution.js";

describe("projectLiveLifecycleAttribution", () => {
  it("projects live gateway cost identity through the canonical lifecycle ledger", () => {
    const projection = projectLiveLifecycleAttribution({
      eventId: "session-1:live:4",
      kilnSessionId: "session-1",
      sequence: 4,
      timestamp: "2026-06-30T18:00:00.000Z",
      turnId: "session-1:turn:live",
      provider: {
        provider: "codex-oauth",
        model: "gpt-5.5",
        canonicalModel: "gpt-5.5",
        billingMode: "metered",
      },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 0,
      },
      cost: {
        deltaUsd: 0.0123,
        currency: "USD",
      },
    });

    expect(projection).toMatchObject({
      parentEventId: "session-1:live:4",
      ledger: {
        sessionId: "session-1",
        turnId: "session-1:turn:live",
        sourceEventId: "session-1:live:4",
        sourceEventSequence: 4,
        context: {
          route: "codex-oauth/gpt-5.5",
        },
      },
      summary: expect.objectContaining({
        totalTokens: 150,
      }),
    });
    expect(projection.ledger.records).toEqual([
      expect.objectContaining({ tokenClass: "raw", tokens: 100 }),
      expect.objectContaining({ tokenClass: "generated", tokens: 20 }),
      expect.objectContaining({ tokenClass: "cached", tokens: 30 }),
    ]);
    expect(projection.summary.totalCostUsd).toBeCloseTo(0.0123);
  });
});
