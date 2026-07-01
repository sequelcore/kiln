import { describe, expect, it } from "vitest";
import type { CostUpdateEvent } from "@kilnai/core";
import { appendCanonicalTurnEvents } from "../../src/session/runtime-session-event-ledger.js";
import { RuntimeSession } from "../../src/session/runtime-session.js";

describe("runtime session lifecycle attribution events", () => {
  it("emits lifecycle attribution after canonical cost updates", () => {
    const session = new RuntimeSession({
      appName: "app",
      tenantId: "tenant",
      userId: "user",
      systemPrompt: "Be useful.",
    });
    const startedAt = new Date("2026-06-30T12:00:00.000Z");
    const completedAt = new Date("2026-06-30T12:00:01.000Z");
    const costUpdate: CostUpdateEvent = {
      type: "cost_update",
      sessionId: session.id,
      provider: "codex-oauth",
      model: "gpt-5.5",
      canonicalModel: "gpt-5.5",
      billingMode: "metered",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 30,
      totalCostUsd: 0.0123,
      byRoleModel: {},
      timestamp: completedAt,
    };

    const events = appendCanonicalTurnEvents({
      session,
      channel: "gui",
      userMessageContent: "Measure this turn.",
      assistantMessageContent: "Measured.",
      queued: false,
      turnStartedAt: startedAt,
      turnCompletedAt: completedAt,
      continuity: { strategy: "none" },
      runtimeEvents: [costUpdate],
    });

    const costEvent = events.find((event) => event.kind === "cost_updated");
    const attributionEvent = events.find((event) => event.kind === "lifecycle_attribution_recorded");

    expect(costEvent).toMatchObject({
      kind: "cost_updated",
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
    });
    expect(attributionEvent).toMatchObject({
      kind: "lifecycle_attribution_recorded",
      parentEventId: costEvent?.eventId,
      ledger: {
        sessionId: session.id,
        turnId: costEvent?.turnId,
        sourceEventId: costEvent?.eventId,
        sourceEventSequence: costEvent?.sequence,
        provider: {
          provider: "codex-oauth",
          model: "gpt-5.5",
        },
        records: [
          expect.objectContaining({ source: "unknown", tokenClass: "raw", providerTokenClass: "input", tokens: 100 }),
          expect.objectContaining({ source: "unknown", tokenClass: "generated", providerTokenClass: "output", tokens: 20 }),
          expect.objectContaining({ source: "unknown", tokenClass: "cached", providerTokenClass: "cache_read", tokens: 30 }),
        ],
      },
      summary: expect.objectContaining({
        totalTokens: 150,
      }),
    });
    if (attributionEvent?.kind !== "lifecycle_attribution_recorded") {
      throw new Error("Expected lifecycle attribution event.");
    }
    expect(attributionEvent.summary.totalCostUsd).toBeCloseTo(0.0123);
    expect(events.map((event) => event.kind)).toContain("lifecycle_attribution_recorded");
  });
});
