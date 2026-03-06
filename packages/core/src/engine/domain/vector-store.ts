// Engine primitive: VectorStore -- provider-agnostic interface for vector storage and similarity search

/** A single entry in the vector store. */
export interface VectorEntry {
  readonly id: string;
  readonly content: string;
  readonly embedding: number[];
  readonly metadata: Record<string, unknown>;
}

/** A query result from the vector store. */
export interface VectorResult {
  readonly id: string;
  readonly content: string;
  readonly score: number;
  readonly metadata: Record<string, unknown>;
}

/** Query options for vector similarity search. */
export interface VectorQueryOptions {
  readonly topK: number;
  readonly minScore?: number;
  readonly filter?: Record<string, unknown>;
}

/** Provider-agnostic vector store interface. */
export interface VectorStore {
  upsert(entries: VectorEntry[]): Promise<void>;
  query(embedding: number[], options: VectorQueryOptions): Promise<VectorResult[]>;
  delete(ids: string[]): Promise<void>;
  deleteByMetadata(filter: Record<string, unknown>): Promise<number>;
}
