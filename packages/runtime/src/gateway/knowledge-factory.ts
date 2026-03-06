// Knowledge pipeline factory -- resolves KnowledgeConfig to concrete pipeline

import type { KnowledgeConfig, VectorStore, ChunkEnricher, ContactMemoryConfig, EmbeddingAdapter, ContactMemoryService } from "@kilnai/core";
import {
  OpenAIEmbeddingAdapter,
  OllamaEmbeddingAdapter,
  InMemoryVectorStore,
  RecursiveTextChunker,
  MarkdownChunker,
  RetrievalPipeline,
  KilnError,
  createPgVectorStore,
  ContextualEnricher,
  AnthropicAdapter,
  OpenAIAdapter,
  DeepSeekAdapter,
  OllamaAdapter,
  SourceManager,
  FileExtractor,
  UrlExtractor,
  PdfExtractor,
  CompositeExtractor,
  InMemorySourceStore,
  JsonSourceStore,
  ContactMemoryServiceImpl,
} from "@kilnai/core";

export interface KnowledgePipelineResult {
  readonly pipeline: RetrievalPipeline;
  readonly store: VectorStore;
  readonly embedder: EmbeddingAdapter;
  readonly close: () => Promise<void>;
}

export async function createKnowledgePipeline(config: KnowledgeConfig): Promise<KnowledgePipelineResult> {
  // Fail-fast: validate API key for non-ollama providers
  if (config.embedding.provider !== "ollama" && config.embedding.apiKeyEnv) {
    const apiKey = process.env[config.embedding.apiKeyEnv] ?? "";
    if (!apiKey) {
      throw new KilnError("CONFIG_MISSING_ENV", `Embedding provider "${config.embedding.provider}" requires API key from env var "${config.embedding.apiKeyEnv}"`, {
        context: { provider: config.embedding.provider, apiKeyEnv: config.embedding.apiKeyEnv },
      });
    }
  }

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

  // Resolve contextual enricher (optional)
  let enricher: ChunkEnricher | undefined;
  if (config.chunking.contextual?.enabled) {
    const ctx = config.chunking.contextual;
    const apiKey = ctx.apiKeyEnv ? process.env[ctx.apiKeyEnv] ?? "" : "";

    const provider = ctx.provider === "anthropic"
      ? new AnthropicAdapter({ apiKey, defaultModel: ctx.model })
      : ctx.provider === "openai"
        ? new OpenAIAdapter({ apiKey, defaultModel: ctx.model })
        : ctx.provider === "deepseek"
          ? new DeepSeekAdapter({ apiKey, defaultModel: ctx.model })
          : new OllamaAdapter({ baseUrl: ctx.baseUrl, defaultModel: ctx.model });

    enricher = new ContextualEnricher({
      provider,
      concurrency: ctx.concurrency,
    });
  }

  const pipeline = new RetrievalPipeline({
    embedder,
    store,
    chunker,
    chunkConfig: {
      chunkSize: config.chunking.chunkSize ?? 512,
      chunkOverlap: config.chunking.chunkOverlap ?? 50,
    },
    enricher,
  });

  return { pipeline, store, embedder, close: closeFn };
}

export function createContactMemoryService(config: {
  contactMemoryConfig: ContactMemoryConfig;
  vectorStore: VectorStore;
  embedder: EmbeddingAdapter;
}): ContactMemoryService {
  const apiKey = config.contactMemoryConfig.apiKeyEnv
    ? process.env[config.contactMemoryConfig.apiKeyEnv] ?? ""
    : "";

  const provider =
    config.contactMemoryConfig.provider === "anthropic"
      ? new AnthropicAdapter({ apiKey, defaultModel: config.contactMemoryConfig.model })
      : config.contactMemoryConfig.provider === "openai"
        ? new OpenAIAdapter({ apiKey, defaultModel: config.contactMemoryConfig.model })
        : config.contactMemoryConfig.provider === "deepseek"
          ? new DeepSeekAdapter({ apiKey, defaultModel: config.contactMemoryConfig.model })
          : new OllamaAdapter({
              baseUrl: config.contactMemoryConfig.baseUrl,
              defaultModel: config.contactMemoryConfig.model,
            });

  return new ContactMemoryServiceImpl({
    vectorStore: config.vectorStore,
    embedder: config.embedder,
    provider,
  });
}

export interface SourceManagerResult {
  readonly sourceManager: SourceManager;
}

export function createSourceManager(
  pipeline: RetrievalPipeline,
  store: VectorStore,
  storageDir?: string,
): SourceManagerResult {
  const extractor = new CompositeExtractor([
    new FileExtractor(),
    new UrlExtractor(),
    new PdfExtractor(),
  ]);

  const sourceStore = storageDir
    ? new JsonSourceStore(storageDir)
    : new InMemorySourceStore();

  const sourceManager = new SourceManager({
    sourceStore,
    extractor,
    pipeline,
    vectorStore: store,
  });

  return { sourceManager };
}
