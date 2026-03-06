// Knowledge pipeline factory -- resolves KnowledgeConfig to concrete pipeline

import type { KnowledgeConfig, VectorStore } from "@kilnai/core";
import {
  OpenAIEmbeddingAdapter,
  OllamaEmbeddingAdapter,
  InMemoryVectorStore,
  RecursiveTextChunker,
  MarkdownChunker,
  RetrievalPipeline,
  KilnError,
  createPgVectorStore,
} from "@kilnai/core";

export interface KnowledgePipelineResult {
  readonly pipeline: RetrievalPipeline;
  readonly store: VectorStore;
  readonly close: () => Promise<void>;
}

export async function createKnowledgePipeline(config: KnowledgeConfig): Promise<KnowledgePipelineResult> {
  // Resolve embedding adapter
  const embedder = config.embedding.provider === "openai"
    ? new OpenAIEmbeddingAdapter({
        apiKey: config.embedding.apiKeyEnv ? process.env[config.embedding.apiKeyEnv] ?? "" : "",
        model: config.embedding.model,
      })
    : new OllamaEmbeddingAdapter({
        model: config.embedding.model,
        baseUrl: config.embedding.baseUrl,
      });

  // Resolve vector store
  let store: VectorStore;
  let closeFn: () => Promise<void> = async () => {};

  if (config.store.backend === "pgvector") {
    if (!config.store.connectionString) {
      throw new KilnError("CONFIG_INVALID", "pgvector backend requires connectionString", {
        context: { backend: "pgvector" },
      });
    }
    const pgStore = await createPgVectorStore({ connectionString: config.store.connectionString });
    await pgStore.initialize();
    store = pgStore;
    closeFn = () => pgStore.close();
  } else {
    store = new InMemoryVectorStore();
  }

  // Resolve chunker
  const chunker = config.chunking.strategy === "markdown"
    ? new MarkdownChunker()
    : new RecursiveTextChunker();

  const pipeline = new RetrievalPipeline({
    embedder,
    store,
    chunker,
    chunkConfig: {
      chunkSize: config.chunking.chunkSize ?? 512,
      chunkOverlap: config.chunking.chunkOverlap ?? 50,
    },
  });

  return { pipeline, store, close: closeFn };
}
