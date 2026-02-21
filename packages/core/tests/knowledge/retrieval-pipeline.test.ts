import { describe, it, expect, vi } from "vitest";
import { RetrievalPipeline } from "../../src/knowledge/retrieval-pipeline.js";
import type { EmbeddingAdapter } from "../../src/engine/domain/embedding.js";
import type { VectorStore, VectorEntry, VectorQueryOptions, VectorResult } from "../../src/engine/domain/vector-store.js";
import type { Chunker, ChunkConfig, Document } from "../../src/engine/domain/chunker.js";

class MockChunker implements Chunker {
  chunk(document: Document, config: ChunkConfig) {
    const content = document.content;
    const size = config.chunkSize || 512;
    const chunks = [];
    for (let i = 0; i < content.length; i += size) {
      const chunkContent = content.slice(i, i + size);
      const index = Math.floor(i / size);
      chunks.push({
        id: `chunk-${index}`,
        content: chunkContent,
        metadata: { ...document.metadata, chunkIndex: index },
      });
    }
    return chunks;
  }
}

class MockEmbedder implements EmbeddingAdapter {
  name = "mock";
  dimensions = 3;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => [t.length % 3, t.length % 2, t.length % 5]);
  }
}

class MockVectorStore implements VectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  async upsert(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }
  async query(embedding: number[], options: VectorQueryOptions): Promise<VectorResult[]> {
    const results: VectorResult[] = Array.from(this.entries.values()).map((entry) => ({
      id: entry.id,
      content: entry.content,
      score: 1,
      metadata: entry.metadata,
    }));
    return results.slice(0, options.topK);
  }
  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.entries.delete(id);
    }
  }
}

describe("RetrievalPipeline", () => {
  it("ingests documents and returns chunk count", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 10, chunkOverlap: 2 },
    });

    const documents: Document[] = [
      { content: "Hello world test content", metadata: { source: "doc1" } },
    ];

    const count = await pipeline.ingest(documents);
    expect(count).toBeGreaterThan(0);
  });

  it("retrieves results for query", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 10, chunkOverlap: 2 },
    });

    await pipeline.ingest([{ content: "Test content for retrieval", metadata: { source: "test" } }]);

    const results = await pipeline.retrieve("test query");
    expect(results.length).toBeGreaterThan(0);
  });

  it("respects topK parameter", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 5, chunkOverlap: 1 },
    });

    await pipeline.ingest([
      { content: "A".repeat(50), metadata: { source: "test" } },
    ]);

    const results = await pipeline.retrieve("test", { topK: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("filters by source when specified", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 10, chunkOverlap: 2 },
    });

    await pipeline.ingest([
      { content: "Source one content", metadata: { source: "source1" } },
      { content: "Source two content", metadata: { source: "source2" } },
    ]);

    const results = await pipeline.retrieve("content", { source: "source1" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("returns empty array when no documents ingested", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 10, chunkOverlap: 2 },
    });

    const results = await pipeline.retrieve("test");
    expect(results).toEqual([]);
  });

  it("handles empty documents array", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 10, chunkOverlap: 2 },
    });

    const count = await pipeline.ingest([]);
    expect(count).toBe(0);
  });

  it("uses custom reranker when provided", async () => {
    const chunker = new MockChunker();
    const embedder = new MockEmbedder();
    const store = new MockVectorStore();
    const reranker = {
      rerank: vi.fn().mockResolvedValue([
        { id: "reranked-1", content: "reranked", score: 0.99, metadata: {} },
      ]),
    };

    const pipeline = new RetrievalPipeline({
      embedder,
      store,
      chunker,
      chunkConfig: { chunkSize: 10, chunkOverlap: 2 },
      reranker,
    });

    await pipeline.ingest([{ content: "Test", metadata: { source: "test" } }]);
    const results = await pipeline.retrieve("test");

    expect(reranker.rerank).toHaveBeenCalled();
    expect(results[0]!.id).toBe("reranked-1");
  });
});
