import { describe, it, expect, vi, beforeEach } from "vitest";
import { createContactMemoryAdminRoutes } from "../../src/gateway/contact-memory-admin-routes.js";
import type { ContactMemoryAdminRoutesConfig } from "../../src/gateway/contact-memory-admin-routes.js";
import type { ContactFact, ContactMemoryService } from "@kilnai/core";

function makeFact(overrides: Partial<ContactFact> = {}): ContactFact {
  return {
    id: "fact-1",
    externalUserId: "user-123",
    tenantId: "tenant-abc",
    content: "Customer prefers email",
    category: "preference",
    confidence: 0.9,
    validAt: "2026-01-01T00:00:00Z",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function mockContactMemoryService(): ContactMemoryService {
  return {
    extractAndStore: vi.fn().mockResolvedValue([]),
    recall: vi.fn().mockResolvedValue([]),
    forget: vi.fn().mockResolvedValue(undefined),
    forgetAll: vi.fn().mockResolvedValue(undefined),
  };
}

describe("createContactMemoryAdminRoutes", () => {
  let service: ContactMemoryService;
  let config: ContactMemoryAdminRoutesConfig;

  beforeEach(() => {
    service = mockContactMemoryService();
    config = { contactMemoryService: service, appName: "test-app" };
  });

  describe("GET /facts/:userId", () => {
    it("returns facts for a user", async () => {
      const facts = [makeFact(), makeFact({ id: "fact-2", content: "Customer name is John" })];
      (service.recall as ReturnType<typeof vi.fn>).mockResolvedValue(facts);

      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-123?tenantId=tenant-abc");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { facts: ContactFact[] };
      expect(body.facts).toHaveLength(2);
      expect(service.recall).toHaveBeenCalledWith("user-123", "tenant-abc", { limit: 100 });
    });

    it("returns empty array when no facts exist", async () => {
      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-999?tenantId=tenant-abc");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { facts: ContactFact[] };
      expect(body.facts).toHaveLength(0);
    });

    it("returns 400 when tenantId is missing", async () => {
      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-123");

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain("tenantId");
    });
  });

  describe("DELETE /facts/:userId/:factId", () => {
    it("forgets a single fact", async () => {
      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-123/fact-1?tenantId=tenant-abc", { method: "DELETE" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);
      expect(service.forget).toHaveBeenCalledWith("fact-1", "tenant-abc");
    });

    it("returns 400 when tenantId is missing", async () => {
      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-123/fact-1", { method: "DELETE" });

      expect(res.status).toBe(400);
    });
  });

  describe("DELETE /facts/:userId (GDPR forgetAll)", () => {
    it("erases all facts for a user", async () => {
      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-123?tenantId=tenant-abc", { method: "DELETE" });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);
      expect(service.forgetAll).toHaveBeenCalledWith("user-123", "tenant-abc");
    });

    it("returns 400 when tenantId is missing", async () => {
      const app = createContactMemoryAdminRoutes(config);
      const res = await app.request("/facts/user-123", { method: "DELETE" });

      expect(res.status).toBe(400);
    });
  });

  describe("admin token enforcement", () => {
    it("returns 401 without token when adminToken configured", async () => {
      const authedConfig: ContactMemoryAdminRoutesConfig = { ...config, adminToken: "secret-123" };
      const app = createContactMemoryAdminRoutes(authedConfig);

      const res = await app.request("/facts/user-123?tenantId=tenant-abc");
      expect(res.status).toBe(401);
    });

    it("returns 200 with valid token", async () => {
      const authedConfig: ContactMemoryAdminRoutesConfig = { ...config, adminToken: "secret-123" };
      const app = createContactMemoryAdminRoutes(authedConfig);

      const res = await app.request("/facts/user-123?tenantId=tenant-abc", {
        headers: { Authorization: "Bearer secret-123" },
      });
      expect(res.status).toBe(200);
    });

    it("no auth required when adminToken not configured", async () => {
      const app = createContactMemoryAdminRoutes(config);

      const res = await app.request("/facts/user-123?tenantId=tenant-abc");
      expect(res.status).toBe(200);
    });
  });
});
