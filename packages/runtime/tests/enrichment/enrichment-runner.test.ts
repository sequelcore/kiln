import { describe, it, expect, vi, beforeEach } from "vitest";
import { EnrichmentRunner } from "../../src/enrichment/enrichment-runner.js";
import type { ConversationEnricher, CompletedSession, ConversationEnrichment, EnrichmentStore } from "@kilnai/core";
import type { ConversationEventEmitter } from "../../src/gateway/conversation-event-emitter.js";

function makeSession(): CompletedSession {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    conversationHistory: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi!" },
    ],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    closedAt: new Date("2026-01-01T00:05:00Z"),
    closedBy: "resolved",
    escalated: false,
    handoffCount: 0,
  };
}

function makeEnrichment(): ConversationEnrichment {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    enrichedAt: new Date().toISOString(),
    summary: "Test",
    topics: [],
    topicDrift: false,
    resolution: { status: "resolved", confidence: 0.9, evidence: "Done" },
    effortScore: 10,
    effortComponents: {
      userTurns: 1,
      clarificationRequests: 0,
      toolErrors: 0,
      agentHandoffs: 0,
      escalated: false,
    },
    csatPrediction: { score: 5, confidence: 0.9, basis: [] },
    sentimentArc: [],
    sentimentArcPattern: "neutral_throughout",
    overallSentiment: { polarity: "positive", score: 0.5, confidence: 0.8 },
    agentPerformance: [],
    multilingual: false,
    piiRedacted: false,
    turnCount: 2,
    userTurnCount: 1,
    durationMs: 300_000,
  };
}

function makeStore(): EnrichmentStore & { save: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(undefined),
    listByTenant: vi.fn().mockResolvedValue({ enrichments: [] }),
    delete: vi.fn().mockResolvedValue(true),
  };
}

function makeEnricher(result: ConversationEnrichment | undefined = makeEnrichment()): ConversationEnricher & { enrich: ReturnType<typeof vi.fn> } {
  return {
    enrich: vi.fn().mockResolvedValue(result),
  };
}

function makeEventEmitter(): ConversationEventEmitter & { emit: ReturnType<typeof vi.fn> } {
  return {
    emit: vi.fn(),
    emitBatch: vi.fn(),
  } as unknown as ConversationEventEmitter & { emit: ReturnType<typeof vi.fn> };
}

describe("EnrichmentRunner", () => {
  let store: ReturnType<typeof makeStore>;
  let enricher: ReturnType<typeof makeEnricher>;
  let eventEmitter: ReturnType<typeof makeEventEmitter>;

  beforeEach(() => {
    store = makeStore();
    enricher = makeEnricher();
    eventEmitter = makeEventEmitter();
  });

  it("calls enricher and stores result", async () => {
    const runner = new EnrichmentRunner({
      enricher,
      store,
      eventEmitter,
    });

    runner.runPostConversation(makeSession());

    // Wait for async execution
    await vi.waitFor(() => {
      expect(enricher.enrich).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenCalledTimes(1);
    });
  });

  it("emits CONVERSATION_ENRICHED event on success", async () => {
    const runner = new EnrichmentRunner({
      enricher,
      store,
      eventEmitter,
    });

    runner.runPostConversation(makeSession());

    await vi.waitFor(() => {
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      const emittedEvent = eventEmitter.emit.mock.calls[0][0];
      expect(emittedEvent.eventType).toBe("CONVERSATION_ENRICHED");
      expect(emittedEvent.tenantId).toBe("tenant-1");
      expect(emittedEvent.sessionId).toBe("sess-1");
    });
  });

  it("does not emit event when no eventEmitter is configured", async () => {
    const runner = new EnrichmentRunner({
      enricher,
      store,
    });

    runner.runPostConversation(makeSession());

    await vi.waitFor(() => {
      expect(store.save).toHaveBeenCalledTimes(1);
    });
    // No crash, no event emitted
  });

  it("does not store when enricher returns undefined", async () => {
    const undefinedEnricher: ConversationEnricher & { enrich: ReturnType<typeof vi.fn> } = {
      enrich: vi.fn().mockResolvedValue(undefined),
    };
    const undefinedStore = makeStore();
    const undefinedEmitter = makeEventEmitter();
    const runner = new EnrichmentRunner({
      enricher: undefinedEnricher,
      store: undefinedStore,
      eventEmitter: undefinedEmitter,
    });

    runner.runPostConversation(makeSession());

    await vi.waitFor(() => {
      expect(undefinedEnricher.enrich).toHaveBeenCalledTimes(1);
    });

    // Give extra time for any store.save to have been called
    await new Promise((r) => setTimeout(r, 100));
    expect(undefinedStore.save).not.toHaveBeenCalled();
    expect(undefinedEmitter.emit).not.toHaveBeenCalled();
  });

  it("handles enricher errors gracefully (no throw)", async () => {
    const failingEnricher: ConversationEnricher & { enrich: ReturnType<typeof vi.fn> } = {
      enrich: vi.fn().mockRejectedValue(new Error("LLM down")),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const runner = new EnrichmentRunner({
      enricher: failingEnricher,
      store,
      eventEmitter,
    });

    // Should not throw
    runner.runPostConversation(makeSession());

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });

    expect(store.save).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("handles enrichment timeout gracefully", async () => {
    const slowEnricher: ConversationEnricher & { enrich: ReturnType<typeof vi.fn> } = {
      enrich: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(makeEnrichment()), 5000)),
      ),
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const runner = new EnrichmentRunner({
      enricher: slowEnricher,
      store,
      eventEmitter,
      timeoutMs: 50, // Very short timeout
    });

    runner.runPostConversation(makeSession());

    await vi.waitFor(
      () => {
        expect(warnSpy).toHaveBeenCalled();
      },
      { timeout: 2000 },
    );

    expect(store.save).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
