import { describe, it, expect, vi, beforeEach } from "vitest";
import { createEnrichmentAdminRoutes } from "../../src/gateway/enrichment-admin-routes.js";
import type { EnrichmentAdminRoutesConfig } from "../../src/gateway/enrichment-admin-routes.js";
import type { ConversationEnrichment, EnrichmentStore } from "@kilnai/core";

function makeEnrichment(overrides: Partial<ConversationEnrichment> = {}): ConversationEnrichment {
  return {
    sessionId: "sess-1",
    tenantId: "tenant-1",
    enrichedAt: new Date().toISOString(),
    summary: "Test conversation summary",
    topics: [{ label: "billing", confidence: 0.9, prominence: 0.8 }],
    topicDrift: false,
    resolution: { status: "resolved", confidence: 0.95, evidence: "Issue was resolved" },
    effortScore: 2.5,
    effortComponents: {
      userTurns: 3,
      clarificationRequests: 1,
      toolErrors: 0,
      agentHandoffs: 0,
      escalated: false,
    },
    csatPrediction: { score: 4.2, confidence: 0.8, basis: ["fast resolution"] },
    sentimentArc: [{ turnIndex: 0, polarity: "negative", score: -0.5 }],
    sentimentArcPattern: "improving",
    overallSentiment: { polarity: "positive", score: 0.6, confidence: 0.85 },
    agentPerformance: [],
    multilingual: false,
    piiRedacted: false,
    turnCount: 6,
    userTurnCount: 3,
    durationMs: 120000,
    ...overrides,
  };
}

function mockEnrichmentStore(): EnrichmentStore {
  const store = new Map<string, ConversationEnrichment>();
  return {
    save: vi.fn(async (enrichment: ConversationEnrichment) => {
      store.set(enrichment.sessionId, enrichment);
    }),
    get: vi.fn(async (sessionId: string) => store.get(sessionId)),
    listByTenant: vi.fn(async (tenantId: string, limit = 50, cursor?: string) => {
      const all = [...store.values()]
        .filter((e) => e.tenantId === tenantId)
        .sort((a, b) => b.enrichedAt.localeCompare(a.enrichedAt));
      const startIdx = cursor ? all.findIndex((e) => e.enrichedAt < cursor) : 0;
      const slice = all.slice(startIdx < 0 ? 0 : startIdx, (startIdx < 0 ? 0 : startIdx) + limit);
      return { enrichments: slice, nextCursor: undefined };
    }),
    delete: vi.fn(async (sessionId: string) => {
      if (!store.has(sessionId)) return false;
      store.delete(sessionId);
      return true;
    }),
  };
}

describe("createEnrichmentAdminRoutes", () => {
  let enrichmentStore: ReturnType<typeof mockEnrichmentStore>;
  let config: EnrichmentAdminRoutesConfig;

  beforeEach(() => {
    enrichmentStore = mockEnrichmentStore();
    config = { enrichmentStore, appName: "test-app" };
  });

  describe("GET /enrichment/:sessionId", () => {
    it("returns enrichment JSON", async () => {
      const enrichment = makeEnrichment({ sessionId: "sess-42" });
      await enrichmentStore.save(enrichment);

      const app = createEnrichmentAdminRoutes(config);
      const res = await app.request("/enrichment/sess-42");

      expect(res.status).toBe(200);
      const body = (await res.json()) as ConversationEnrichment;
      expect(body.sessionId).toBe("sess-42");
      expect(body.summary).toBe("Test conversation summary");
    });

    it("returns 404 for missing session", async () => {
      const app = createEnrichmentAdminRoutes(config);
      const res = await app.request("/enrichment/nonexistent");

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Enrichment not found");
    });
  });

  describe("GET /enrichment", () => {
    it("lists enrichments with pagination", async () => {
      await enrichmentStore.save(makeEnrichment({ sessionId: "sess-1", tenantId: "t1" }));
      await enrichmentStore.save(makeEnrichment({ sessionId: "sess-2", tenantId: "t1" }));
      await enrichmentStore.save(makeEnrichment({ sessionId: "sess-3", tenantId: "t2" }));

      const app = createEnrichmentAdminRoutes(config);
      const res = await app.request("/enrichment?tenantId=t1&limit=10");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { enrichments: ConversationEnrichment[] };
      expect(body.enrichments).toHaveLength(2);
    });

    it("returns 400 when tenantId is missing", async () => {
      const app = createEnrichmentAdminRoutes(config);
      const res = await app.request("/enrichment");

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Missing required query parameter: tenantId");
    });
  });

  describe("DELETE /enrichment/:sessionId", () => {
    it("deletes and returns 200", async () => {
      await enrichmentStore.save(makeEnrichment({ sessionId: "sess-del" }));

      const app = createEnrichmentAdminRoutes(config);
      const res = await app.request("/enrichment/sess-del", { method: "DELETE" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { deleted: boolean };
      expect(body.deleted).toBe(true);

      // Verify deleted
      const getRes = await app.request("/enrichment/sess-del");
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for missing session", async () => {
      const app = createEnrichmentAdminRoutes(config);
      const res = await app.request("/enrichment/nonexistent", { method: "DELETE" });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe("Enrichment not found");
    });
  });

  describe("admin token enforcement", () => {
    it("returns 401 without token when adminToken configured", async () => {
      const authedConfig: EnrichmentAdminRoutesConfig = { ...config, adminToken: "secret-abc" };
      const app = createEnrichmentAdminRoutes(authedConfig);

      const res = await app.request("/enrichment?tenantId=t1");
      expect(res.status).toBe(401);
    });

    it("returns 200 with valid token", async () => {
      const authedConfig: EnrichmentAdminRoutesConfig = { ...config, adminToken: "secret-abc" };
      const app = createEnrichmentAdminRoutes(authedConfig);

      const res = await app.request("/enrichment?tenantId=t1", {
        headers: { Authorization: "Bearer secret-abc" },
      });
      expect(res.status).toBe(200);
    });

    it("no auth required when adminToken not configured", async () => {
      const app = createEnrichmentAdminRoutes(config);

      const res = await app.request("/enrichment?tenantId=t1");
      expect(res.status).toBe(200);
    });
  });
});
