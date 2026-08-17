import { describe, it, expect, vi } from "vitest";
import { RetrievalPipeline } from "../../src/knowledge/retrieval-pipeline.js";
import { EventBus } from "../../src/events/event-bus.js";
import type { KnowledgeGapEvent } from "../../src/events/index.js";
import type { EmbeddingAdapter } from "../../src/engine/domain/embedding.js";
import type { VectorStore, VectorResult } from "../../src/engine/domain/vector-store.js";
import type { Chunker, ChunkConfig, Document } from "../../src/engine/domain/chunker.js";

class MockChunker implements Chunker {
  chunk(document: Document, _config: ChunkConfig) {
    return [{ id: "chunk-0", content: document.content, metadata: document.metadata }];
  }
}

class MockEmbedder implements EmbeddingAdapter {
  name = "mock";
  dimensions = 3;
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

function createMockStore(results: VectorResult[]): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue(results),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByMetadata: vi.fn().mockResolvedValue(0),
  };
}

describe("RetrievalPipeline knowledge_gap events", () => {
  it("emits knowledge_gap when top score is below default threshold", async () => {
    const eventBus = new EventBus();
    const handler = vi.fn();
    eventBus.on("knowledge_gap", handler);

    const store = createMockStore([
      { id: "r1", content: "low relevance", score: 0.15, metadata: {} },
    ]);

    const pipeline = new RetrievalPipeline({
      embedder: new MockEmbedder(),
      store,
      chunker: new MockChunker(),
      chunkConfig: { chunkSize: 512, chunkOverlap: 0 },
      eventBus,
    });

    await pipeline.retrieve("some query");

    expect(handler).toHaveBeenCalledOnce();
    const event: KnowledgeGapEvent = handler.mock.calls[0]![0];
    expect(event.type).toBe("knowledge_gap");
    expect(event.query).toBe("some query");
    expect(event.topScore).toBe(0.15);
    expect(event.threshold).toBe(0.3);
    expect(event.retrievedCount).toBe(1);
    expect(event.sessionId).toBe("retrieval");
  });

  it("emits knowledge_gap when no results are returned", async () => {
    const eventBus = new EventBus();
    const handler = vi.fn();
    eventBus.on("knowledge_gap", handler);

    const store = createMockStore([]);

    const pipeline = new RetrievalPipeline({
      embedder: new MockEmbedder(),
      store,
      chunker: new MockChunker(),
      chunkConfig: { chunkSize: 512, chunkOverlap: 0 },
      eventBus,
    });

    await pipeline.retrieve("unknown topic");

    expect(handler).toHaveBeenCalledOnce();
    const event: KnowledgeGapEvent = handler.mock.calls[0]![0];
    expect(event.topScore).toBe(0);
    expect(event.retrievedCount).toBe(0);
  });

  it("does not emit knowledge_gap when score is above threshold", async () => {
    const eventBus = new EventBus();
    const handler = vi.fn();
    eventBus.on("knowledge_gap", handler);

    const store = createMockStore([
      { id: "r1", content: "high relevance", score: 0.85, metadata: {} },
    ]);

    const pipeline = new RetrievalPipeline({
      embedder: new MockEmbedder(),
      store,
      chunker: new MockChunker(),
      chunkConfig: { chunkSize: 512, chunkOverlap: 0 },
      eventBus,
    });

    await pipeline.retrieve("matching query");

    expect(handler).not.toHaveBeenCalled();
  });

  it("respects custom gapThreshold", async () => {
    const eventBus = new EventBus();
    const handler = vi.fn();
    eventBus.on("knowledge_gap", handler);

    const store = createMockStore([
      { id: "r1", content: "medium relevance", score: 0.4, metadata: {} },
    ]);

    const pipeline = new RetrievalPipeline({
      embedder: new MockEmbedder(),
      store,
      chunker: new MockChunker(),
      chunkConfig: { chunkSize: 512, chunkOverlap: 0 },
      eventBus,
      gapThreshold: 0.5,
    });

    await pipeline.retrieve("borderline query");

    expect(handler).toHaveBeenCalledOnce();
    const event: KnowledgeGapEvent = handler.mock.calls[0]![0];
    expect(event.threshold).toBe(0.5);
    expect(event.topScore).toBe(0.4);
  });

  it("does not emit when no eventBus is provided", async () => {
    const store = createMockStore([
      { id: "r1", content: "low", score: 0.1, metadata: {} },
    ]);

    const pipeline = new RetrievalPipeline({
      embedder: new MockEmbedder(),
      store,
      chunker: new MockChunker(),
      chunkConfig: { chunkSize: 512, chunkOverlap: 0 },
    });

    // Should not throw -- no eventBus means gap detection is skipped
    const results = await pipeline.retrieve("query");
    expect(results).toHaveLength(1);
  });
});
