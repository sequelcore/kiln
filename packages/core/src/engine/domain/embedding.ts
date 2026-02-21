// Engine primitive: EmbeddingAdapter -- provider-agnostic interface for text embeddings
// Same pattern as ProviderAdapter, but for embedding generation

/** Provider-agnostic embedding adapter. Same pattern as ProviderAdapter. */
export interface EmbeddingAdapter {
  readonly name: string;
  /** Number of dimensions in the output embeddings. */
  readonly dimensions: number;
  /** Embed one or more text strings into vectors. */
  embed(texts: string[]): Promise<number[][]>;
}
