// InMemoryVectorStore -- simple Map-based vector storage with cosine similarity

import type { VectorEntry, VectorResult, VectorQueryOptions, VectorStore } from "../../engine/domain/vector-store.js";

export class InMemoryVectorStore implements VectorStore {
  private readonly entries = new Map<string, VectorEntry>();

  async upsert(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.entries.set(entry.id, entry);
    }
  }

  async query(embedding: number[], options: VectorQueryOptions): Promise<VectorResult[]> {
    const { topK, minScore, filter } = options;

    const results: VectorResult[] = [];

    for (const entry of this.entries.values()) {
      if (filter && !this.matchesFilter(entry.metadata, filter)) {
        continue;
      }

      const score = cosineSimilarity(embedding, entry.embedding);

      if (minScore !== undefined && score < minScore) {
        continue;
      }

      results.push({
        id: entry.id,
        content: entry.content,
        score,
        metadata: entry.metadata,
      });
    }

    results.sort((a, b) => b.score - a.score);

    return results.slice(0, topK);
  }

  async delete(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.entries.delete(id);
    }
  }

  private matchesFilter(metadata: Record<string, unknown>, filter: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(filter)) {
      if (metadata[key] !== value) {
        return false;
      }
    }
    return true;
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimensions must match: ${a.length} vs ${b.length}`);
  }

  if (a.length === 0) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);

  if (denominator === 0) {
    return 0;
  }

  return dotProduct / denominator;
}
