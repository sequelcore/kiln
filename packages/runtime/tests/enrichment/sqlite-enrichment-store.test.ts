import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteEnrichmentStore } from "../../src/enrichment/sqlite-enrichment-store.js";
import type { ConversationEnrichment } from "@kilnai/core/enrichment";

function makeEnrichment(overrides?: Partial<ConversationEnrichment>): ConversationEnrichment {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    enrichedAt: "2026-01-01T00:00:00.000Z",
    summary: "Test summary",
    topics: [{ label: "billing", confidence: 0.9, prominence: 1.0 }],
    topicDrift: false,
    resolution: { status: "resolved", confidence: 0.9, evidence: "Issue fixed" },
    effortScore: 8.5,
    effortComponents: {
      userTurns: 3,
      clarificationRequests: 0,
      toolErrors: 0,
      agentHandoffs: 0,
      escalated: false,
    },
    csatPrediction: { score: 4.0, confidence: 0.7, basis: ["Quick resolution"] },
    sentimentArc: [{ turnIndex: 0, polarity: "neutral", score: 0 }],
    sentimentArcPattern: "neutral_throughout",
    overallSentiment: { polarity: "positive", score: 0.5, confidence: 0.8 },
    agentPerformance: [],
    multilingual: false,
    piiRedacted: false,
    turnCount: 6,
    userTurnCount: 3,
    durationMs: 180_000,
    ...overrides,
  };
}

describe("SqliteEnrichmentStore", () => {
  let store: SqliteEnrichmentStore;

  beforeEach(() => {
    store = new SqliteEnrichmentStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("saves and retrieves an enrichment", async () => {
    const enrichment = makeEnrichment();
    await store.save(enrichment);

    const result = await store.get("sess-1");
    expect(result).toBeDefined();
    expect(result!.sessionId).toBe("sess-1");
    expect(result!.summary).toBe("Test summary");
    expect(result!.topics).toHaveLength(1);
    expect(result!.effortScore).toBe(8.5);
  });

  it("returns undefined for missing session", async () => {
    const result = await store.get("nonexistent");
    expect(result).toBeUndefined();
  });

  it("upserts on save (replaces existing)", async () => {
    await store.save(makeEnrichment({ summary: "Original" }));
    await store.save(makeEnrichment({ summary: "Updated" }));

    const result = await store.get("sess-1");
    expect(result!.summary).toBe("Updated");
  });

  it("listByTenant returns enrichments in descending order", async () => {
    await store.save(makeEnrichment({ sessionId: "s1", enrichedAt: "2026-01-01T00:00:00.000Z" }));
    await store.save(makeEnrichment({ sessionId: "s2", enrichedAt: "2026-01-02T00:00:00.000Z" }));
    await store.save(makeEnrichment({ sessionId: "s3", enrichedAt: "2026-01-03T00:00:00.000Z" }));

    const { enrichments } = await store.listByTenant("tenant-1");
    expect(enrichments).toHaveLength(3);
    expect(enrichments[0].sessionId).toBe("s3");
    expect(enrichments[1].sessionId).toBe("s2");
    expect(enrichments[2].sessionId).toBe("s1");
  });

  it("listByTenant supports cursor pagination", async () => {
    await store.save(makeEnrichment({ sessionId: "s1", enrichedAt: "2026-01-01T00:00:00.000Z" }));
    await store.save(makeEnrichment({ sessionId: "s2", enrichedAt: "2026-01-02T00:00:00.000Z" }));
    await store.save(makeEnrichment({ sessionId: "s3", enrichedAt: "2026-01-03T00:00:00.000Z" }));

    const page1 = await store.listByTenant("tenant-1", 2);
    expect(page1.enrichments).toHaveLength(2);
    expect(page1.nextCursor).toBeDefined();

    const page2 = await store.listByTenant("tenant-1", 2, page1.nextCursor);
    expect(page2.enrichments).toHaveLength(1);
    expect(page2.nextCursor).toBeUndefined();
    expect(page2.enrichments[0].sessionId).toBe("s1");
  });

  it("listByTenant returns empty for unknown tenant", async () => {
    await store.save(makeEnrichment());
    const { enrichments } = await store.listByTenant("unknown-tenant");
    expect(enrichments).toHaveLength(0);
  });

  it("delete removes enrichment and returns true", async () => {
    await store.save(makeEnrichment());
    const deleted = await store.delete("sess-1");
    expect(deleted).toBe(true);

    const result = await store.get("sess-1");
    expect(result).toBeUndefined();
  });

  it("delete returns false for missing session", async () => {
    const deleted = await store.delete("nonexistent");
    expect(deleted).toBe(false);
  });

  it("close does not throw", () => {
    expect(() => store.close()).not.toThrow();
  });
});
