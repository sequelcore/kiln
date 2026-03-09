// KnowledgeConfig types -- YAML configuration for knowledge RAG

export interface KnowledgeEmbeddingConfig {
  readonly provider: "openai" | "ollama";
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

export interface KnowledgeStoreConfig {
  readonly backend: "memory" | "pgvector";
  readonly connectionString?: string;
  readonly connectionStringEnv?: string;
}

export interface ContextualConfig {
  readonly enabled: boolean;
  readonly provider: "anthropic" | "openai" | "deepseek" | "ollama";
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
  readonly concurrency?: number;
}

export interface KnowledgeChunkingConfig {
  readonly strategy: "recursive" | "markdown";
  readonly chunkSize?: number;
  readonly chunkOverlap?: number;
  readonly contextual?: ContextualConfig;
}

export interface KnowledgeSourceConfig {
  readonly name: string;
  readonly path: string;
  readonly type?: "file" | "url" | "pdf";
  readonly watch?: boolean;
  readonly chunking?: KnowledgeChunkingConfig;
}

export interface KnowledgeRerankerConfig {
  readonly provider: "cohere";
  readonly model?: string;
  readonly apiKeyEnv: string;
}

export interface ContactMemoryConfig {
  readonly enabled: boolean;
  readonly provider: "anthropic" | "openai" | "deepseek" | "ollama";
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly baseUrl?: string;
}

export interface KnowledgeConfig {
  readonly embedding: KnowledgeEmbeddingConfig;
  readonly store: KnowledgeStoreConfig;
  readonly chunking: KnowledgeChunkingConfig;
  readonly sources: readonly KnowledgeSourceConfig[];
  readonly reranker?: KnowledgeRerankerConfig;
  readonly allowedAgents?: readonly string[];
  readonly mode?: "auto" | "tool";
  readonly contactMemory?: ContactMemoryConfig;
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
  } else if (!["memory", "pgvector"].includes(config.store.backend)) {
    errors.push({ field: "store.backend", message: "must be 'memory' or 'pgvector'" });
  }

  if (config.store.backend === "pgvector" && !config.store.connectionString && !config.store.connectionStringEnv) {
    errors.push({ field: "store.connectionString", message: `required when backend is '${config.store.backend}' (use connectionString or connectionStringEnv)` });
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

  if (config.chunking.contextual?.enabled) {
    const ctx = config.chunking.contextual;
    if (!ctx.provider) {
      errors.push({ field: "chunking.contextual.provider", message: "required when contextual enrichment is enabled" });
    } else if (!["anthropic", "openai", "deepseek", "ollama"].includes(ctx.provider)) {
      errors.push({ field: "chunking.contextual.provider", message: "must be 'anthropic', 'openai', 'deepseek', or 'ollama'" });
    }
    if (ctx.provider !== "ollama" && !ctx.apiKeyEnv) {
      errors.push({ field: "chunking.contextual.apiKeyEnv", message: `required when provider is '${ctx.provider}'` });
    }
    if (ctx.concurrency !== undefined && ctx.concurrency <= 0) {
      errors.push({ field: "chunking.contextual.concurrency", message: "must be greater than 0" });
    }
  }

  if (config.contactMemory?.enabled) {
    const cm = config.contactMemory;
    if (!cm.provider) {
      errors.push({ field: "contactMemory.provider", message: "required when contact memory is enabled" });
    } else if (!["anthropic", "openai", "deepseek", "ollama"].includes(cm.provider)) {
      errors.push({ field: "contactMemory.provider", message: "must be 'anthropic', 'openai', 'deepseek', or 'ollama'" });
    }
    if (cm.provider !== "ollama" && !cm.apiKeyEnv) {
      errors.push({ field: "contactMemory.apiKeyEnv", message: `required when provider is '${cm.provider}'` });
    }
  }

  if (config.reranker) {
    if (config.reranker.provider !== "cohere") {
      errors.push({ field: "reranker.provider", message: "must be 'cohere'" });
    }
    if (!config.reranker.apiKeyEnv || typeof config.reranker.apiKeyEnv !== "string") {
      errors.push({ field: "reranker.apiKeyEnv", message: "required" });
    }
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
