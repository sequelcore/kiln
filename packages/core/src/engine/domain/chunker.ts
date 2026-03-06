// Engine primitive: Chunker -- document splitting strategies for RAG

/** A document to be chunked. */
export interface Document {
  readonly content: string;
  readonly metadata: Record<string, unknown>;
}

/** A chunk produced from a document. */
export interface Chunk {
  readonly id: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly embedding?: number[];
}

/** Chunking configuration. */
export interface ChunkConfig {
  readonly chunkSize: number;
  readonly chunkOverlap: number;
}

/** Converts documents into chunks. */
export interface Chunker {
  chunk(document: Document, config: ChunkConfig): Chunk[];
}

/** Optional post-chunking enrichment. Adds contextual prefixes to chunks using an LLM. */
export interface ChunkEnricher {
  enrich(document: Document, chunks: Chunk[]): Promise<Chunk[]>;
}
