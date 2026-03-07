// Cohere reranker adapter -- fetch-based, no external SDK dependency

import type { VectorResult } from "../../engine/domain/vector-store.js";
import type { Reranker } from "../reranker.js";
import { KilnError } from "../../engine/errors.js";
import { withRetry } from "../../agents/infrastructure/retry.js";

export interface CohereRerankerConfig {
  readonly apiKey: string;
  readonly model?: string;
}

interface CohereRerankResponse {
  results: Array<{
    index: number;
    relevance_score: number;
  }>;
}

export class CohereReranker implements Reranker {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: CohereRerankerConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "rerank-v3.5";
  }

  async rerank(query: string, results: VectorResult[]): Promise<VectorResult[]> {
    if (results.length === 0) {
      return [];
    }

    const data = await withRetry(
      async () => {
        const response = await fetch("https://api.cohere.com/v2/rerank", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            query,
            documents: results.map((r) => r.content),
            top_n: results.length,
          }),
        });

        if (!response.ok) {
          const status = response.status;
          if (status === 429 || status >= 500) {
            const err = new Error(`Cohere rerank returned ${status}`);
            (err as unknown as Record<string, number>).status = status;
            throw err;
          }
          const body = await response.text();
          throw new KilnError("PROVIDER_UNAVAILABLE", `Cohere rerank error ${status}: ${body}`, {
            context: { provider: "cohere", status },
            retryable: false,
          });
        }

        return response.json() as Promise<CohereRerankResponse>;
      },
      {
        maxRetries: 3,
        baseDelayMs: 1000,
        isRetryable: (error: unknown) =>
          !(error instanceof KilnError) &&
          error instanceof Error &&
          "status" in error,
      },
    );

    return data.results.map((r) => {
      const original = results[r.index]!;
      return {
        id: original.id,
        content: original.content,
        score: r.relevance_score,
        metadata: original.metadata,
      };
    });
  }
}
