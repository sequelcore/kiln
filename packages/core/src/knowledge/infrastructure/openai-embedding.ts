// OpenAI embedding adapter -- fetch-based, no external SDK dependency

import type { EmbeddingAdapter } from "../../engine/domain/embedding.js";

interface OpenAIEmbeddingConfig {
  readonly apiKey: string;
  readonly model?: string;
}

interface OpenAIEmbeddingResponse {
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = "openai";
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = "https://api.openai.com/v1";

  constructor(config: OpenAIEmbeddingConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "text-embedding-3-small";
    this.dimensions = this.getDimensionsForModel(this.model);
  }

  private getDimensionsForModel(model: string): number {
    if (model === "text-embedding-3-large") {
      return 3072;
    }
    return 1536;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const response = await this.fetchWithRetry(
      `${this.baseUrl}/embeddings`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          input: texts,
          model: this.model,
        }),
      },
    );

    const data = (await response.json()) as OpenAIEmbeddingResponse;

    const sortedEmbeddings = new Map<number, number[]>();
    for (const item of data.data) {
      sortedEmbeddings.set(item.index, item.embedding);
    }

    const result: number[][] = [];
    for (let i = 0; i < texts.length; i++) {
      const embedding = sortedEmbeddings.get(i);
      if (!embedding) {
        throw new Error(`Missing embedding for index ${i}`);
      }
      result.push(embedding);
    }

    return result;
  }

  private async fetchWithRetry(url: string, options: RequestInit, retries = 3): Promise<Response> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const response = await fetch(url, options);

      if (response.ok) {
        return response;
      }

      if (response.status === 429 || response.status >= 500) {
        const delay = Math.pow(2, attempt) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      const errorText = await response.text();
      throw new Error(`OpenAI embedding request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    throw new Error(`OpenAI embedding request failed after ${retries} retries`);
  }
}
