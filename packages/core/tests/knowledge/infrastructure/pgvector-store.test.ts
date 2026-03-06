import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgVectorStore } from "../../../src/knowledge/infrastructure/pgvector-store.js";
import type { VectorEntry } from "../../../src/engine/domain/vector-store.js";

const mockSql = {
  unsafe: vi.fn().mockResolvedValue([]),
  begin: vi.fn().mockImplementation(async (fn: (sql: typeof mockSql) => Promise<void>) => fn(mockSql)),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock("postgres", () => ({
  default: () => mockSql,
}));

function createStore(tableName?: string, dimensions?: number): PgVectorStore {
  return new PgVectorStore(mockSql, {
    connectionString: "postgres://localhost:5432/test",
    tableName,
    dimensions,
  });
}

describe("PgVectorStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.unsafe.mockResolvedValue([]);
    mockSql.begin.mockImplementation(async (fn: (sql: typeof mockSql) => Promise<void>) => fn(mockSql));
  });

  describe("initialize", () => {
    it("creates extension, table, and three indexes", async () => {
      const store = createStore();
      await store.initialize();

      expect(mockSql.unsafe).toHaveBeenCalledTimes(5);

      const calls = mockSql.unsafe.mock.calls.map((c: unknown[]) => (c[0] as string).replace(/\s+/g, " ").trim());

      expect(calls[0]).toContain("CREATE EXTENSION IF NOT EXISTS vector");
      expect(calls[1]).toContain("CREATE TABLE IF NOT EXISTS kiln_knowledge_chunks");
      expect(calls[1]).toContain("halfvec(1536)");
      expect(calls[1]).toContain("tsvector GENERATED ALWAYS AS");
      expect(calls[2]).toContain("USING hnsw");
      expect(calls[2]).toContain("halfvec_cosine_ops");
      expect(calls[2]).toContain("m = 16");
      expect(calls[2]).toContain("ef_construction = 128");
      expect(calls[3]).toContain("USING gin (metadata)");
      expect(calls[4]).toContain("USING gin (tsv)");
    });

    it("uses custom table name and dimensions", async () => {
      const store = createStore("custom_table", 768);
      await store.initialize();

      const calls = mockSql.unsafe.mock.calls.map((c: unknown[]) => (c[0] as string).replace(/\s+/g, " ").trim());

      expect(calls[1]).toContain("CREATE TABLE IF NOT EXISTS custom_table");
      expect(calls[1]).toContain("halfvec(768)");
    });
  });

  describe("upsert", () => {
    it("generates INSERT ... ON CONFLICT for each entry", async () => {
      const store = createStore();
      const entries: VectorEntry[] = [
        { id: "1", content: "hello", embedding: [1.0, 2.0, 3.0], metadata: { source: "test" } },
        { id: "2", content: "world", embedding: [4.0, 5.0, 6.0], metadata: {} },
      ];

      await store.upsert(entries);

      expect(mockSql.begin).toHaveBeenCalledTimes(1);
      // Two inserts inside the transaction
      expect(mockSql.unsafe).toHaveBeenCalledTimes(2);

      const firstCall = mockSql.unsafe.mock.calls[0]!;
      const sql = (firstCall[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("INSERT INTO kiln_knowledge_chunks");
      expect(sql).toContain("ON CONFLICT (id) DO UPDATE");

      const params = firstCall[1] as unknown[];
      expect(params[0]).toBe("1");
      expect(params[1]).toBe("hello");
      expect(params[2]).toBe("[1,2,3]");
      expect(params[3]).toBe('{"source":"test"}');
    });
  });

  describe("query", () => {
    it("generates SELECT with cosine distance", async () => {
      mockSql.unsafe.mockResolvedValueOnce([
        { id: "1", content: "hello", score: 0.95, metadata: { source: "test" } },
      ]);

      const store = createStore();
      const results = await store.query([1.0, 0.0, 0.0], { topK: 5 });

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("1 - (embedding <=> $1::halfvec) AS score");
      expect(sql).toContain("ORDER BY embedding <=> $1::halfvec");
      expect(sql).toContain("LIMIT $2");

      const params = call[1] as unknown[];
      expect(params[0]).toBe("[1,0,0]");
      expect(params[1]).toBe(5);

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("1");
      expect(results[0]!.score).toBe(0.95);
    });

    it("applies JSONB containment filter", async () => {
      mockSql.unsafe.mockResolvedValueOnce([]);

      const store = createStore();
      await store.query([1, 0, 0], { topK: 5, filter: { source: "docs" } });

      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("metadata @> $3::jsonb");

      const params = call[1] as unknown[];
      expect(params[2]).toBe('{"source":"docs"}');
    });

    it("applies minScore threshold", async () => {
      mockSql.unsafe.mockResolvedValueOnce([]);

      const store = createStore();
      await store.query([1, 0, 0], { topK: 5, minScore: 0.8 });

      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("1 - (embedding <=> $1::halfvec) >= $3");

      const params = call[1] as unknown[];
      expect(params[2]).toBe(0.8);
    });

    it("applies both filter and minScore", async () => {
      mockSql.unsafe.mockResolvedValueOnce([]);

      const store = createStore();
      await store.query([1, 0, 0], { topK: 5, filter: { source: "docs" }, minScore: 0.7 });

      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("metadata @> $3::jsonb");
      expect(sql).toContain(">= $4");

      const params = call[1] as unknown[];
      expect(params[2]).toBe('{"source":"docs"}');
      expect(params[3]).toBe(0.7);
    });

    it("parses string metadata from rows", async () => {
      mockSql.unsafe.mockResolvedValueOnce([
        { id: "1", content: "test", score: 0.9, metadata: '{"key":"val"}' },
      ]);

      const store = createStore();
      const results = await store.query([1, 0, 0], { topK: 1 });

      expect(results[0]!.metadata).toEqual({ key: "val" });
    });
  });

  describe("delete", () => {
    it("generates DELETE with ANY", async () => {
      const store = createStore();
      await store.delete(["id1", "id2"]);

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("DELETE FROM kiln_knowledge_chunks WHERE id = ANY($1)");

      const params = call[1] as unknown[];
      expect(params[0]).toEqual(["id1", "id2"]);
    });
  });

  describe("deleteByMetadata", () => {
    it("generates DELETE with JSONB containment and returns count", async () => {
      mockSql.unsafe.mockResolvedValueOnce([{ id: "1" }, { id: "2" }]);

      const store = createStore();
      const count = await store.deleteByMetadata({ source: "docs" });

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      expect(sql).toContain("DELETE FROM kiln_knowledge_chunks WHERE metadata @> $1::jsonb RETURNING id");

      const params = call[1] as unknown[];
      expect(params[0]).toBe('{"source":"docs"}');

      expect(count).toBe(2);
    });

    it("returns 0 when nothing matches", async () => {
      mockSql.unsafe.mockResolvedValueOnce([]);

      const store = createStore();
      const count = await store.deleteByMetadata({ source: "nonexistent" });
      expect(count).toBe(0);
    });
  });

  describe("hybridQuery", () => {
    it("generates CTE-based RRF query", async () => {
      mockSql.unsafe.mockResolvedValueOnce([
        { id: "1", content: "hello", metadata: {}, score: 0.03 },
      ]);

      const store = createStore();
      const results = await store.hybridQuery([1, 0, 0], "hello world", { topK: 5 });

      expect(mockSql.unsafe).toHaveBeenCalledTimes(1);
      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();

      expect(sql).toContain("WITH vector_search AS");
      expect(sql).toContain("text_search AS");
      expect(sql).toContain("FULL OUTER JOIN text_search t ON v.id = t.id");
      expect(sql).toContain("1.0 / (60 + v.rank)");
      expect(sql).toContain("1.0 / (60 + t.rank)");
      expect(sql).toContain("plainto_tsquery('english', $2)");
      expect(sql).toContain("ORDER BY score DESC");

      const params = call[1] as unknown[];
      expect(params[0]).toBe("[1,0,0]");
      expect(params[1]).toBe("hello world");
      expect(params[2]).toBe(10); // topK * 2
      expect(params[3]).toBe(5);  // topK

      expect(results).toHaveLength(1);
      expect(results[0]!.id).toBe("1");
    });

    it("applies metadata filter to both CTEs", async () => {
      mockSql.unsafe.mockResolvedValueOnce([]);

      const store = createStore();
      await store.hybridQuery([1, 0, 0], "test", { topK: 3, filter: { source: "docs" } });

      const call = mockSql.unsafe.mock.calls[0]!;
      const sql = (call[0] as string).replace(/\s+/g, " ").trim();
      // Filter appears twice: once in vector_search, once in text_search
      const filterMatches = sql.match(/metadata @>/g);
      expect(filterMatches).toHaveLength(2);

      const params = call[1] as unknown[];
      expect(params[4]).toBe('{"source":"docs"}');
    });
  });

  describe("close", () => {
    it("calls sql.end()", async () => {
      const store = createStore();
      await store.close();
      expect(mockSql.end).toHaveBeenCalledTimes(1);
    });
  });

  describe("createPgVectorStore", () => {
    it("creates store via dynamic import", async () => {
      const { createPgVectorStore } = await import("../../../src/knowledge/infrastructure/pgvector-store.js");
      const store = await createPgVectorStore({ connectionString: "postgres://localhost/test" });
      expect(store).toBeInstanceOf(PgVectorStore);
    });
  });
});
