// Reranker interface -- optional result re-ranking for retrieval

import type { VectorResult } from "../engine/domain/vector-store.js";

export interface Reranker {
  rerank(query: string, results: VectorResult[]): Promise<VectorResult[]>;
}
