import { describe, it, expect } from "vitest";
import { InMemoryVectorStore, cosineSimilarity } from "../../src/knowledge/infrastructure/memory-vector-store.js";
import type { VectorEntry, VectorQueryOptions } from "../../src/engine/domain/vector-store.js";

describe("InMemoryVectorStore", () => {
  it("upsert and query single entry", async () => {
    const store = new InMemoryVectorStore();
    const entry: VectorEntry = {
      id: "1",
      content: "test content",
      embedding: [1, 0, 0],
      metadata: { source: "test" },
    };
    await store.upsert([entry]);

    const results = await store.query([1, 0, 0], { topK: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe("test content");
  });

  it("upsert multiple entries", async () => {
    const store = new InMemoryVectorStore();
    const entries: VectorEntry[] = [
      { id: "1", content: "cat", embedding: [1, 0, 0], metadata: {} },
      { id: "2", content: "dog", embedding: [0, 1, 0], metadata: {} },
    ];
    await store.upsert(entries);

    const results = await store.query([1, 0, 0], { topK: 2 });
    expect(results).toHaveLength(2);
  });

  it("returns results sorted by score descending", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      { id: "1", content: "similar", embedding: [1, 0, 0], metadata: {} },
      { id: "2", content: "dissimilar", embedding: [0, 0, 1], metadata: {} },
      { id: "3", content: "very similar", embedding: [0.9, 0.1, 0], metadata: {} },
    ]);

    const results = await store.query([1, 0, 0], { topK: 3 });
    expect(results[0]!.id).toBe("1");
    expect(results[1]!.id).toBe("3");
  });

  it("respects topK limit", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      { id: "1", content: "a", embedding: [1, 0, 0], metadata: {} },
      { id: "2", content: "b", embedding: [0, 1, 0], metadata: {} },
      { id: "3", content: "c", embedding: [0, 0, 1], metadata: {} },
    ]);

    const results = await store.query([1, 0, 0], { topK: 2 });
    expect(results).toHaveLength(2);
  });

  it("filters by minScore", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      { id: "1", content: "similar", embedding: [1, 0, 0], metadata: {} },
      { id: "2", content: "dissimilar", embedding: [0.1, 0, 0], metadata: {} },
    ]);

    const results = await store.query([1, 0, 0], { topK: 2, minScore: 0.5 });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1");
  });

  it("filters by metadata", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([
      { id: "1", content: "doc1", embedding: [1, 0, 0], metadata: { source: "docs" } },
      { id: "2", content: "doc2", embedding: [0, 1, 0], metadata: { source: "api" } },
    ]);

    const results = await store.query([1, 0, 0], { topK: 10, filter: { source: "docs" } });
    expect(results).toHaveLength(1);
    expect(results[0]!.id).toBe("1");
  });

  it("delete removes entries", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([{ id: "1", content: "test", embedding: [1, 0, 0], metadata: {} }]);
    await store.delete(["1"]);

    const results = await store.query([1, 0, 0], { topK: 1 });
    expect(results).toHaveLength(0);
  });

  it("query empty store returns empty", async () => {
    const store = new InMemoryVectorStore();
    const results = await store.query([1, 0, 0], { topK: 5 });
    expect(results).toHaveLength(0);
  });

  it("returns metadata in results", async () => {
    const store = new InMemoryVectorStore();
    await store.upsert([{ id: "1", content: "test", embedding: [1, 0, 0], metadata: { custom: "value" } }]);

    const results = await store.query([1, 0, 0], { topK: 1 });
    expect(results[0]!.metadata.custom).toBe("value");
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBe(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0, 0], [-1, 0, 0])).toBe(-1);
  });

  it("handles multi-dimensional vectors", () => {
    const a = [1, 2, 3];
    const b = [2, 4, 6];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it("throws for dimension mismatch", () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow();
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });

  it("handles negative values", () => {
    expect(cosineSimilarity([-1, -2], [-2, -4])).toBeCloseTo(1, 5);
  });

  it("handles empty arrays", () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it("handles single dimension", () => {
    expect(cosineSimilarity([1], [1])).toBe(1);
    expect(cosineSimilarity([1], [0])).toBe(0);
  });

  it("handles non-normalized vectors", () => {
    const a = [3, 4];
    const b = [6, 8];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });
});
