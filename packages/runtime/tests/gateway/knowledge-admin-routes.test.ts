import { describe, it, expect, vi, beforeEach } from "vitest";
import { createKnowledgeAdminRoutes } from "../../src/gateway/knowledge-admin-routes.js";
import type { KnowledgeAdminRoutesConfig } from "../../src/gateway/knowledge-admin-routes.js";
import { KilnError, type KnowledgeSource } from "@kilnai/core/engine";

function makeSource(overrides: Partial<KnowledgeSource> = {}): KnowledgeSource {
  return {
    sourceId: "src-1",
    appName: "test-app",
    name: "Test Source",
    type: "file",
    uri: "/tmp/test.txt",
    status: "indexed",
    chunkCount: 5,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockSourceManager() {
  const sources = new Map<string, KnowledgeSource>();
  return {
    list: vi.fn((appName: string) => [...sources.values()].filter((s) => s.appName === appName)),
    get: vi.fn((_appName: string, sourceId: string) => sources.get(sourceId)),
    addSource: vi.fn(async (params: { appName: string; name: string; type: string; uri: string }) => {
      if ([...sources.values()].some((s) => s.name === params.name && s.appName === params.appName)) {
        throw new KilnError("SOURCE_ALREADY_EXISTS", `Source "${params.name}" already exists`);
      }
      const source = makeSource({ sourceId: `src-${sources.size + 1}`, ...params } as Partial<KnowledgeSource>);
      sources.set(source.sourceId, source);
      return source;
    }),
    removeSource: vi.fn(async (_appName: string, sourceId: string) => {
      if (!sources.has(sourceId)) return false;
      sources.delete(sourceId);
      return true;
    }),
    reindex: vi.fn(async (_appName: string, sourceId: string) => {
      const source = sources.get(sourceId);
      if (!source) throw new KilnError("SOURCE_NOT_FOUND", `Source not found: ${sourceId}`);
      return { ...source, status: "indexed" as const, lastIndexedAt: new Date().toISOString() };
    }),
    ingest: vi.fn(),
    ingestAll: vi.fn(),
    ingestContent: vi.fn(async (_appName: string, sourceId: string, _content: string) => {
      const source = sources.get(sourceId);
      if (!source) throw new KilnError("SOURCE_NOT_FOUND", `Source not found: ${sourceId}`);
      return { ...source, status: "indexed" as const, lastIndexedAt: new Date().toISOString() };
    }),
  };
}

describe("createKnowledgeAdminRoutes", () => {
  let manager: ReturnType<typeof mockSourceManager>;
  let config: KnowledgeAdminRoutesConfig;

  beforeEach(() => {
    manager = mockSourceManager();
    config = { sourceManager: manager as never, appName: "test-app" };
  });

  describe("GET /sources", () => {
    it("returns empty array initially", async () => {
      const app = createKnowledgeAdminRoutes(config);
      const res = await app.request("/sources");

      expect(res.status).toBe(200);
      const body = (await res.json()) as { sources: KnowledgeSource[] };
      expect(body.sources).toEqual([]);
    });

    it("returns sources after creation", async () => {
      const app = createKnowledgeAdminRoutes(config);

      await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Doc", type: "file", uri: "/tmp/doc.txt" }),
      });

      const res = await app.request("/sources");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { sources: KnowledgeSource[] };
      expect(body.sources).toHaveLength(1);
    });
  });

  describe("POST /sources", () => {
    it("creates source (201)", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "FAQ", type: "url", uri: "https://example.com/faq" }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as KnowledgeSource;
      expect(body.name).toBe("FAQ");
      expect(body.type).toBe("url");
    });

    it("returns 400 for missing fields", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Incomplete" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid type", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Bad", type: "excel", uri: "/tmp/bad.xlsx" }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 409 for duplicate name", async () => {
      const app = createKnowledgeAdminRoutes(config);

      await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Dup", type: "file", uri: "/a" }),
      });

      const res = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Dup", type: "file", uri: "/b" }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe("GET /sources/:sourceId", () => {
    it("returns source by id", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const createRes = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Get Test", type: "file", uri: "/tmp/test.txt" }),
      });
      const created = (await createRes.json()) as KnowledgeSource;

      const res = await app.request(`/sources/${created.sourceId}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as KnowledgeSource;
      expect(body.name).toBe("Get Test");
    });

    it("returns 404 for unknown source", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources/nonexistent");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /sources/:sourceId/reindex", () => {
    it("reindexes a source", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const createRes = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Reindex Test", type: "file", uri: "/tmp/test.txt" }),
      });
      const created = (await createRes.json()) as KnowledgeSource;

      const res = await app.request(`/sources/${created.sourceId}/reindex`, { method: "POST" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as KnowledgeSource;
      expect(body.status).toBe("indexed");
    });

    it("returns 404 for unknown source", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources/nonexistent/reindex", { method: "POST" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /sources/:sourceId", () => {
    it("removes source", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const createRes = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Delete Me", type: "file", uri: "/tmp/test.txt" }),
      });
      const created = (await createRes.json()) as KnowledgeSource;

      const res = await app.request(`/sources/${created.sourceId}`, { method: "DELETE" });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { removed: boolean };
      expect(body.removed).toBe(true);

      const getRes = await app.request(`/sources/${created.sourceId}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 404 for unknown source", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources/nonexistent", { method: "DELETE" });
      expect(res.status).toBe(404);
    });
  });

  describe("POST /sources with headers", () => {
    it("passes headers to addSource", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Authed",
          type: "url",
          uri: "https://example.com/api",
          headers: { Authorization: "Bearer tok-123" },
        }),
      });

      expect(res.status).toBe(201);
      expect(manager.addSource).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: { Authorization: "Bearer tok-123" },
        }),
      );
    });
  });

  describe("POST /sources/:sourceId/content", () => {
    it("ingests JSON content body", async () => {
      const app = createKnowledgeAdminRoutes(config);

      // Create a source first
      const createRes = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Content Test", type: "file", uri: "/tmp/test.txt" }),
      });
      const created = (await createRes.json()) as { sourceId: string };

      const res = await app.request(`/sources/${created.sourceId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello World" }),
      });

      expect(res.status).toBe(200);
      expect(manager.ingestContent).toHaveBeenCalledWith("test-app", created.sourceId, "Hello World");
    });

    it("ingests raw text body", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const createRes = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Raw Test", type: "file", uri: "/tmp/test.txt" }),
      });
      const created = (await createRes.json()) as { sourceId: string };

      const res = await app.request(`/sources/${created.sourceId}/content`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "Raw text content here",
      });

      expect(res.status).toBe(200);
      expect(manager.ingestContent).toHaveBeenCalledWith("test-app", created.sourceId, "Raw text content here");
    });

    it("returns 400 for missing content in JSON body", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const createRes = await app.request("/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Empty", type: "file", uri: "/tmp/test.txt" }),
      });
      const created = (await createRes.json()) as { sourceId: string };

      const res = await app.request(`/sources/${created.sourceId}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notContent: true }),
      });

      expect(res.status).toBe(400);
    });

    it("returns 404 for unknown source", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources/nonexistent/content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Hello" }),
      });

      expect(res.status).toBe(404);
    });
  });

  describe("admin token enforcement", () => {
    it("returns 401 without token when adminToken configured", async () => {
      const authedConfig: KnowledgeAdminRoutesConfig = { ...config, adminToken: "secret-123" };
      const app = createKnowledgeAdminRoutes(authedConfig);

      const res = await app.request("/sources");
      expect(res.status).toBe(401);
    });

    it("returns 200 with valid token", async () => {
      const authedConfig: KnowledgeAdminRoutesConfig = { ...config, adminToken: "secret-123" };
      const app = createKnowledgeAdminRoutes(authedConfig);

      const res = await app.request("/sources", {
        headers: { Authorization: "Bearer secret-123" },
      });
      expect(res.status).toBe(200);
    });

    it("no auth required when adminToken not configured", async () => {
      const app = createKnowledgeAdminRoutes(config);

      const res = await app.request("/sources");
      expect(res.status).toBe(200);
    });
  });
});
