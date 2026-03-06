// SourceManager -- orchestrates extract -> hash -> ingest lifecycle for knowledge sources

import { randomUUID } from "node:crypto";
import { KilnError } from "../engine/errors.js";
import { computeContentHash } from "../package/security.js";
import type { KnowledgeSource, KnowledgeSourceType, ContentExtractor, SourceStore } from "../engine/domain/knowledge-source.js";
import type { RetrievalPipeline } from "./retrieval-pipeline.js";
import type { VectorStore } from "../engine/domain/vector-store.js";

export interface SourceManagerConfig {
  readonly sourceStore: SourceStore;
  readonly extractor: ContentExtractor;
  readonly pipeline: RetrievalPipeline;
  readonly vectorStore: VectorStore;
}

export class SourceManager {
  private readonly sourceStore: SourceStore;
  private readonly extractor: ContentExtractor;
  private readonly pipeline: RetrievalPipeline;
  private readonly vectorStore: VectorStore;

  constructor(config: SourceManagerConfig) {
    this.sourceStore = config.sourceStore;
    this.extractor = config.extractor;
    this.pipeline = config.pipeline;
    this.vectorStore = config.vectorStore;
  }

  async addSource(params: {
    appName: string;
    name: string;
    type: KnowledgeSourceType;
    uri: string;
  }): Promise<KnowledgeSource> {
    // Check for duplicate name
    const existing = this.sourceStore.list(params.appName);
    if (existing.some((s) => s.name === params.name)) {
      throw new KilnError("SOURCE_ALREADY_EXISTS", `Source "${params.name}" already exists for app "${params.appName}"`, {
        context: { appName: params.appName, name: params.name },
      });
    }

    const now = new Date().toISOString();
    const source: KnowledgeSource = {
      sourceId: randomUUID(),
      appName: params.appName,
      name: params.name,
      type: params.type,
      uri: params.uri,
      status: "pending",
      chunkCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.sourceStore.save(source);
    return source;
  }

  async removeSource(appName: string, sourceId: string): Promise<boolean> {
    const source = this.sourceStore.get(appName, sourceId);
    if (!source) return false;

    // Clean up chunks from vector store
    await this.vectorStore.deleteByMetadata({ source: sourceId });
    return this.sourceStore.remove(appName, sourceId);
  }

  async ingest(source: KnowledgeSource): Promise<KnowledgeSource> {
    // Set status to indexing
    let updated: KnowledgeSource = {
      ...source,
      status: "indexing",
      updatedAt: new Date().toISOString(),
    };
    this.sourceStore.save(updated);

    try {
      // Extract content
      const extracted = await this.extractor.extract(source.uri, source.type);

      // Compute content hash
      const contentHash = computeContentHash(extracted.content);

      // Skip if content hasn't changed
      if (source.contentHash === contentHash) {
        updated = { ...updated, status: "indexed", updatedAt: new Date().toISOString() };
        this.sourceStore.save(updated);
        return updated;
      }

      // Delete existing chunks
      await this.vectorStore.deleteByMetadata({ source: source.sourceId });

      // Ingest new content
      const chunkCount = await this.pipeline.ingest([{
        content: extracted.content,
        metadata: { ...extracted.metadata, source: source.sourceId },
      }]);

      const now = new Date().toISOString();
      updated = {
        ...updated,
        status: "indexed",
        contentHash,
        chunkCount,
        lastIndexedAt: now,
        updatedAt: now,
        error: undefined,
      };
      this.sourceStore.save(updated);
      return updated;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      updated = {
        ...updated,
        status: "failed",
        error: errorMessage,
        updatedAt: new Date().toISOString(),
      };
      this.sourceStore.save(updated);
      return updated;
    }
  }

  async ingestAll(appName: string): Promise<readonly KnowledgeSource[]> {
    const sources = this.sourceStore.list(appName);
    const results: KnowledgeSource[] = [];
    for (const source of sources) {
      results.push(await this.ingest(source));
    }
    return results;
  }

  async reindex(appName: string, sourceId: string): Promise<KnowledgeSource> {
    const source = this.sourceStore.get(appName, sourceId);
    if (!source) {
      throw new KilnError("SOURCE_NOT_FOUND", `Source not found: ${sourceId}`, {
        context: { appName, sourceId },
      });
    }

    // Force reindex by clearing content hash
    const cleared: KnowledgeSource = { ...source, contentHash: undefined };
    return this.ingest(cleared);
  }

  list(appName: string): readonly KnowledgeSource[] {
    return this.sourceStore.list(appName);
  }

  get(appName: string, sourceId: string): KnowledgeSource | undefined {
    return this.sourceStore.get(appName, sourceId);
  }
}
