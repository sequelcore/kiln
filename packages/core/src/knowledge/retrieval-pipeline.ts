// RetrievalPipeline -- orchestrates ingest (chunk -> embed -> store) and retrieve (embed -> search -> return)

import type { Document } from "../engine/domain/chunker.js";
import type { EmbeddingAdapter } from "../engine/domain/embedding.js";
import type { VectorStore, VectorResult, VectorQueryOptions } from "../engine/domain/vector-store.js";
import type { Chunker, ChunkConfig, ChunkEnricher } from "../engine/domain/chunker.js";
import type { Reranker } from "./reranker.js";
import type { EventBus } from "../events/event-bus.js";
import type { KnowledgeGapEvent } from "../events/index.js";

export interface RetrievalPipelineConfig {
  readonly embedder: EmbeddingAdapter;
  readonly store: VectorStore;
  readonly chunker: Chunker;
  readonly chunkConfig: ChunkConfig;
  readonly reranker?: Reranker;
  readonly enricher?: ChunkEnricher;
  readonly eventBus?: EventBus;
  readonly gapThreshold?: number;
}

export class RetrievalPipeline {
  private readonly embedder: EmbeddingAdapter;
  private readonly store: VectorStore;
  private readonly chunker: Chunker;
  private readonly chunkConfig: ChunkConfig;
  private readonly reranker?: Reranker;
  private readonly enricher?: ChunkEnricher;
  private readonly eventBus?: EventBus;
  private readonly gapThreshold: number;

  constructor(config: RetrievalPipelineConfig) {
    this.embedder = config.embedder;
    this.store = config.store;
    this.chunker = config.chunker;
    this.chunkConfig = config.chunkConfig;
    this.reranker = config.reranker;
    this.enricher = config.enricher;
    this.eventBus = config.eventBus;
    this.gapThreshold = config.gapThreshold ?? 0.3;
  }

  async ingest(documents: Document[]): Promise<number> {
    const allChunks: Array<{ id: string; content: string; metadata: Record<string, unknown> }> = [];

    for (const doc of documents) {
      let chunks = this.chunker.chunk(doc, this.chunkConfig);

      if (this.enricher) {
        chunks = await this.enricher.enrich(doc, chunks);
      }

      for (const chunk of chunks) {
        allChunks.push({
          id: chunk.id,
          content: chunk.content,
          metadata: chunk.metadata,
        });
      }
    }

    if (allChunks.length === 0) {
      return 0;
    }

    const texts = allChunks.map((c) => c.content);
    const embeddings = await this.embedder.embed(texts);

    const entries = allChunks.map((chunk, index) => ({
      id: chunk.id,
      content: chunk.content,
      embedding: embeddings[index]!,
      metadata: chunk.metadata,
    }));

    await this.store.upsert(entries);

    return entries.length;
  }

  async retrieve(
    query: string,
    options?: { topK?: number; source?: string },
  ): Promise<VectorResult[]> {
    const topK = options?.topK ?? 5;
    const fetchK = this.reranker ? topK * 4 : topK;

    const queryEmbedding = await this.embedder.embed([query]);
    const queryVector = queryEmbedding[0]!;

    const queryOptions: VectorQueryOptions = {
      topK: fetchK,
      ...(options?.source ? { filter: { source: options.source } } : {}),
    };

    let results = await this.store.query(queryVector, queryOptions);

    if (this.eventBus) {
      const topScore = results.length > 0 ? results[0]!.score : 0;
      if (topScore < this.gapThreshold || results.length === 0) {
        const gapEvent: KnowledgeGapEvent = {
          type: "knowledge_gap",
          query,
          topScore,
          threshold: this.gapThreshold,
          retrievedCount: results.length,
          timestamp: new Date(),
          sessionId: "retrieval",
        };
        this.eventBus.emit(gapEvent);
      }
    }

    if (this.reranker && results.length > 0) {
      results = await this.reranker.rerank(query, results);
      results = results.slice(0, topK);
    }

    return results;
  }
}
