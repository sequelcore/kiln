// Knowledge source domain types -- source lifecycle management for knowledge RAG

export type KnowledgeSourceType = "file" | "url" | "pdf";
export type KnowledgeSourceStatus = "pending" | "indexing" | "indexed" | "failed";

export interface KnowledgeSource {
  readonly sourceId: string;
  readonly appName: string;
  readonly name: string;
  readonly type: KnowledgeSourceType;
  readonly uri: string;
  readonly status: KnowledgeSourceStatus;
  readonly contentHash?: string;
  readonly chunkCount: number;
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lastIndexedAt?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ExtractedContent {
  readonly content: string;
  readonly metadata: Record<string, unknown>;
}

export interface ExtractionOptions {
  readonly headers?: Readonly<Record<string, string>>;
}

export interface ContentExtractor {
  readonly supportedTypes: readonly KnowledgeSourceType[];
  extract(uri: string, type: KnowledgeSourceType, options?: ExtractionOptions): Promise<ExtractedContent>;
}

export interface SourceStore {
  get(appName: string, sourceId: string): KnowledgeSource | undefined;
  list(appName: string): readonly KnowledgeSource[];
  save(source: KnowledgeSource): void;
  remove(appName: string, sourceId: string): boolean;
}
