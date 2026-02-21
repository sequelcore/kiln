// RetrievalPipeline -- orchestrates ingest (chunk -> embed -> store) and retrieve (embed -> search -> return)

import type { Document } from "../engine/domain/chunker.js";
import type { EmbeddingAdapter } from "../engine/domain/embedding.js";
import type { VectorStore, VectorResult, VectorQueryOptions } from "../engine/domain/vector-store.js";
import type { Chunker, ChunkConfig } from "../engine/domain/chunker.js";
import type { Reranker } from "./reranker.js";

export interface RetrievalPipelineConfig {
  readonly embedder: EmbeddingAdapter;
  readonly store: VectorStore;
  readonly chunker: Chunker;
  readonly chunkConfig: ChunkConfig;
  readonly reranker?: Reranker;
}

export class RetrievalPipeline {
  private readonly embedder: EmbeddingAdapter;
  private readonly store: VectorStore;
  private readonly chunker: Chunker;
  private readonly chunkConfig: ChunkConfig;
  private readonly reranker?: Reranker;

  constructor(config: RetrievalPipelineConfig) {
    this.embedder = config.embedder;
    this.store = config.store;
    this.chunker = config.chunker;
    this.chunkConfig = config.chunkConfig;
    this.reranker = config.reranker;
  }

  async ingest(documents: Document[]): Promise<number> {
    const allChunks: Array<{ content: string; metadata: Record<string, unknown> }> = [];

    for (const doc of documents) {
      const chunks = this.chunker.chunk(doc, this.chunkConfig);
      for (const chunk of chunks) {
        allChunks.push({
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
      id: this.generateEntryId(chunk.metadata),
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

    const queryEmbedding = await this.embedder.embed([query]);
    const queryVector = queryEmbedding[0]!;

    const queryOptions: VectorQueryOptions = {
      topK,
      ...(options?.source ? { filter: { source: options.source } } : {}),
    };

    let results = await this.store.query(queryVector, queryOptions);

    if (this.reranker && results.length > 0) {
      results = await this.reranker.rerank(query, results);
    }

    return results;
  }

  private generateEntryId(metadata: Record<string, unknown>): string {
    const source = (metadata.source as string) || "unknown";
    const chunkIndex = (metadata.chunkIndex as number) || 0;
    return `${source}:${chunkIndex}`;
  }
}
