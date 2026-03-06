// KnowledgeConfig types -- YAML configuration for knowledge RAG

export interface KnowledgeEmbeddingConfig {
  readonly provider: "openai" | "ollama";
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

export interface KnowledgeStoreConfig {
  readonly backend: "memory" | "pgvector" | "sqlite-vec";
  readonly connectionString?: string;
}

export interface KnowledgeChunkingConfig {
  readonly strategy: "recursive" | "markdown";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
}

export interface KnowledgeSourceConfig {
  readonly name: string;
  readonly path: string;
  readonly watch?: boolean;
  readonly chunking?: KnowledgeChunkingConfig;
}

export interface KnowledgeConfig {
  readonly embedding: KnowledgeEmbeddingConfig;
  readonly store: KnowledgeStoreConfig;
  readonly chunking: KnowledgeChunkingConfig;
  readonly sources: readonly KnowledgeSourceConfig[];
  readonly allowedAgents?: readonly string[];
  readonly mode?: "auto" | "tool";
}

export interface KnowledgeValidationError {
  readonly field: string;
  readonly message: string;
}

export function validateKnowledgeConfig(config: KnowledgeConfig): KnowledgeValidationError[] {
  const errors: KnowledgeValidationError[] = [];

  if (!config.embedding || !config.embedding.provider) {
    errors.push({ field: "embedding.provider", message: "required" });
  } else if (!["openai", "ollama"].includes(config.embedding.provider)) {
    errors.push({ field: "embedding.provider", message: "must be 'openai' or 'ollama'" });
  }

  if (config.embedding.provider === "openai" && !config.embedding.apiKeyEnv) {
    errors.push({ field: "embedding.apiKeyEnv", message: "required when provider is 'openai'" });
  }

  if (!config.store || !config.store.backend) {
    errors.push({ field: "store.backend", message: "required" });
  } else if (!["memory", "pgvector", "sqlite-vec"].includes(config.store.backend)) {
    errors.push({ field: "store.backend", message: "must be 'memory', 'pgvector', or 'sqlite-vec'" });
  }

  if (["pgvector", "sqlite-vec"].includes(config.store.backend) && !config.store.connectionString) {
    errors.push({ field: "store.connectionString", message: `required when backend is '${config.store.backend}'` });
  }

  if (!config.chunking || !config.chunking.strategy) {
    errors.push({ field: "chunking.strategy", message: "required" });
  } else if (!["recursive", "markdown"].includes(config.chunking.strategy)) {
    errors.push({ field: "chunking.strategy", message: "must be 'recursive' or 'markdown'" });
  }

  if (config.chunking.chunkSize !== undefined && config.chunking.chunkSize <= 0) {
    errors.push({ field: "chunking.chunkSize", message: "must be greater than 0" });
  }

  if (config.chunking.chunkOverlap !== undefined && config.chunking.chunkOverlap < 0) {
    errors.push({ field: "chunking.chunkOverlap", message: "must be greater than or equal to 0" });
  }

  const effectiveChunkSize = config.chunking.chunkSize ?? 512;
  const effectiveChunkOverlap = config.chunking.chunkOverlap ?? 50;
  if (effectiveChunkOverlap >= effectiveChunkSize) {
    errors.push({ field: "chunking.chunkOverlap", message: "must be less than chunkSize" });
  }

  if (config.mode !== undefined && config.mode !== "auto" && config.mode !== "tool") {
    errors.push({ field: "mode", message: "must be 'auto' or 'tool'" });
  }

  if (!config.sources || !Array.isArray(config.sources) || config.sources.length === 0) {
    errors.push({ field: "sources", message: "must be a non-empty array" });
  } else {
    const sourceNames = new Set<string>();
    for (let i = 0; i < config.sources.length; i++) {
      const source = config.sources[i]!;
      if (!source.name || typeof source.name !== "string") {
        errors.push({ field: `sources[${i}].name`, message: "must be a non-empty string" });
      } else {
        if (sourceNames.has(source.name)) {
          errors.push({ field: `sources[${i}].name`, message: "duplicate source name" });
        }
        sourceNames.add(source.name);
      }

      if (!source.path || typeof source.path !== "string") {
        errors.push({ field: `sources[${i}].path`, message: "must be a non-empty string" });
      }
    }
  }

  return errors;
}
