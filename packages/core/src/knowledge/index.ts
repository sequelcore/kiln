// Knowledge bounded context -- RAG primitives

export { RecursiveTextChunker } from "./recursive-chunker.js";
export { MarkdownChunker } from "./markdown-chunker.js";
export { OpenAIEmbeddingAdapter } from "./infrastructure/openai-embedding.js";
export { OllamaEmbeddingAdapter } from "./infrastructure/ollama-embedding.js";
export { InMemoryVectorStore, cosineSimilarity } from "./infrastructure/memory-vector-store.js";
export { PgVectorStore, createPgVectorStore } from "./infrastructure/pgvector-store.js";
export type { PgVectorStoreConfig } from "./infrastructure/pgvector-store.js";
export { RetrievalPipeline } from "./retrieval-pipeline.js";
export type { RetrievalPipelineConfig } from "./retrieval-pipeline.js";
export { type Reranker } from "./reranker.js";
export { createKnowledgeCapability, executeKnowledgeSearch } from "./knowledge-capability.js";
export { ContextualEnricher } from "./contextual-enricher.js";
export type { ContextualEnricherConfig } from "./contextual-enricher.js";

// Source management (Phase 4c)
export { FileExtractor } from "./infrastructure/file-extractor.js";
export { UrlExtractor } from "./infrastructure/url-extractor.js";
export { PdfExtractor } from "./infrastructure/pdf-extractor.js";
export { CompositeExtractor } from "./infrastructure/composite-extractor.js";
export { InMemorySourceStore } from "./infrastructure/memory-source-store.js";
export { JsonSourceStore } from "./infrastructure/json-source-store.js";
export { SourceManager } from "./source-manager.js";
export type { SourceManagerConfig } from "./source-manager.js";
