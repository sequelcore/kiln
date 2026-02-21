// Ollama embedding adapter -- fetch-based, local model

import type { EmbeddingAdapter } from "../../engine/domain/embedding.js";

interface OllamaEmbeddingConfig {
  readonly model?: string;
  readonly baseUrl?: string;
}

interface OllamaEmbeddingRequest {
  model: string;
  input: string[];
}

interface OllamaEmbeddingResponse {
  embeddings: number[][];
  model: string;
}

export class OllamaEmbeddingAdapter implements EmbeddingAdapter {
  readonly name = "ollama";
  readonly dimensions: number;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(config: OllamaEmbeddingConfig = {}) {
    this.model = config.model ?? "nomic-embed-text";
    this.baseUrl = config.baseUrl ?? "http://localhost:11434";
    this.dimensions = 768;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const request: OllamaEmbeddingRequest = {
      model: this.model,
      input: texts,
    };

    const response = await fetch(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama embedding request failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = (await response.json()) as OllamaEmbeddingResponse;

    if (!data.embeddings || data.embeddings.length !== texts.length) {
      throw new Error(`Ollama returned ${data.embeddings?.length ?? 0} embeddings, expected ${texts.length}`);
    }

    return data.embeddings;
  }
}
