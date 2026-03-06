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
