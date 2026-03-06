import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKnowledgePipeline, createContactMemoryService } from "../../src/gateway/knowledge-factory.js";
import type { KnowledgeConfig, ContactMemoryConfig, VectorStore, EmbeddingAdapter } from "@kilnai/core";

// Mock createPgVectorStore to avoid actual postgres dependency
vi.mock("@kilnai/core", async () => {
  const actual = await vi.importActual<typeof import("@kilnai/core")>("@kilnai/core");
  return {
    ...actual,
    createPgVectorStore: vi.fn().mockResolvedValue({
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      upsert: vi.fn(),
      query: vi.fn(),
      delete: vi.fn(),
      deleteByMetadata: vi.fn(),
    }),
  };
});

function baseConfig(overrides?: Partial<KnowledgeConfig>): KnowledgeConfig {
  return {
    embedding: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY", model: "text-embedding-3-small" },
    store: { backend: "memory" },
    chunking: { strategy: "recursive", chunkSize: 512, chunkOverlap: 50 },
    sources: [{ name: "docs", path: "./docs" }],
    ...overrides,
  };
}

describe("createKnowledgePipeline", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, OPENAI_API_KEY: "sk-test" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates pipeline with memory store and recursive chunker", async () => {
    const result = await createKnowledgePipeline(baseConfig());
    expect(result.pipeline).toBeDefined();
    expect(result.store).toBeDefined();
    expect(result.close).toBeInstanceOf(Function);
  });

  it("creates pipeline with markdown chunker", async () => {
    const result = await createKnowledgePipeline(baseConfig({
      chunking: { strategy: "markdown", chunkSize: 1000, chunkOverlap: 100 },
    }));
    expect(result.pipeline).toBeDefined();
  });

  it("creates pipeline with pgvector store", async () => {
    const { createPgVectorStore } = await import("@kilnai/core");
    const result = await createKnowledgePipeline(baseConfig({
      store: { backend: "pgvector", connectionString: "postgres://localhost/test" },
    }));

    expect(createPgVectorStore).toHaveBeenCalledWith({ connectionString: "postgres://localhost/test" });
    expect(result.close).toBeInstanceOf(Function);
  });

  it("throws when pgvector has no connectionString", async () => {
    await expect(
      createKnowledgePipeline(baseConfig({
        store: { backend: "pgvector" },
      })),
    ).rejects.toThrow("connectionString");
  });

  it("throws CONFIG_MISSING_ENV for empty API key", async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      createKnowledgePipeline(baseConfig()),
    ).rejects.toThrow("requires API key from env var");
  });

  it("close is noop for memory store", async () => {
    const result = await createKnowledgePipeline(baseConfig());
    await expect(result.close()).resolves.toBeUndefined();
  });

  it("creates pipeline with contextual enricher when enabled", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const result = await createKnowledgePipeline(baseConfig({
      chunking: {
        strategy: "recursive",
        chunkSize: 512,
        chunkOverlap: 50,
        contextual: {
          enabled: true,
          provider: "anthropic",
          model: "claude-haiku-4-5-20251001",
          apiKeyEnv: "ANTHROPIC_API_KEY",
          concurrency: 3,
        },
      },
    }));
    expect(result.pipeline).toBeDefined();
  });

  it("creates pipeline without enricher when contextual is disabled", async () => {
    const result = await createKnowledgePipeline(baseConfig({
      chunking: {
        strategy: "recursive",
        chunkSize: 512,
        chunkOverlap: 50,
        contextual: {
          enabled: false,
          provider: "anthropic",
        },
      },
    }));
    expect(result.pipeline).toBeDefined();
  });

  it("exposes embedder on pipeline result", async () => {
    const result = await createKnowledgePipeline(baseConfig());
    expect(result.embedder).toBeDefined();
    expect(result.embedder.name).toBeDefined();
  });
});

describe("createContactMemoryService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ANTHROPIC_API_KEY: "sk-ant-test" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function mockVectorStore(): VectorStore {
    return {
      upsert: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      delete: vi.fn(),
      deleteByMetadata: vi.fn().mockResolvedValue(0),
    };
  }

  function mockEmbedder(): EmbeddingAdapter {
    return {
      name: "mock",
      dimensions: 3,
      embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
    };
  }

  it("creates contact memory service with anthropic provider", () => {
    const config: ContactMemoryConfig = {
      enabled: true,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    };
    const service = createContactMemoryService({
      contactMemoryConfig: config,
      vectorStore: mockVectorStore(),
      embedder: mockEmbedder(),
    });
    expect(service).toBeDefined();
    expect(service.recall).toBeInstanceOf(Function);
    expect(service.extractAndStore).toBeInstanceOf(Function);
    expect(service.forget).toBeInstanceOf(Function);
    expect(service.forgetAll).toBeInstanceOf(Function);
  });

  it("creates contact memory service with openai provider", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const config: ContactMemoryConfig = {
      enabled: true,
      provider: "openai",
      apiKeyEnv: "OPENAI_API_KEY",
    };
    const service = createContactMemoryService({
      contactMemoryConfig: config,
      vectorStore: mockVectorStore(),
      embedder: mockEmbedder(),
    });
    expect(service).toBeDefined();
  });

  it("creates contact memory service with ollama provider", () => {
    const config: ContactMemoryConfig = {
      enabled: true,
      provider: "ollama",
      model: "llama3",
      baseUrl: "http://localhost:11434",
    };
    const service = createContactMemoryService({
      contactMemoryConfig: config,
      vectorStore: mockVectorStore(),
      embedder: mockEmbedder(),
    });
    expect(service).toBeDefined();
  });
});
