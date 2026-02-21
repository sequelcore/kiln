import { describe, it, expect } from "vitest";
import { validateKnowledgeConfig } from "../../../src/engine/domain/knowledge-config.js";
import type { KnowledgeConfig } from "../../../src/engine/domain/knowledge-config.js";

describe("validateKnowledgeConfig", () => {
  const validConfig: KnowledgeConfig = {
    embedding: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
    store: { backend: "memory" },
    chunking: { strategy: "recursive", chunkSize: 512, chunkOverlap: 50 },
    sources: [{ name: "docs", path: "./docs" }],
  };

  it("returns no errors for valid config", () => {
    const errors = validateKnowledgeConfig(validConfig);
    expect(errors).toHaveLength(0);
  });

  it("requires embedding.provider", () => {
    const config = { ...validConfig, embedding: { provider: undefined as never, apiKeyEnv: "KEY" } };
    const errors = validateKnowledgeConfig(config as KnowledgeConfig);
    expect(errors.find((e) => e.field === "embedding.provider")).toBeDefined();
  });

  it("requires openai provider to have apiKeyEnv", () => {
    const config = { ...validConfig, embedding: { provider: "openai" as const } };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "embedding.apiKeyEnv")).toBeDefined();
  });

  it("allows ollama without apiKeyEnv", () => {
    const config: KnowledgeConfig = {
      embedding: { provider: "ollama" },
      store: { backend: "memory" },
      chunking: { strategy: "recursive" },
      sources: [{ name: "docs", path: "./docs" }],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "embedding.apiKeyEnv")).toBeUndefined();
  });

  it("requires store.backend", () => {
    const config = { ...validConfig, store: { backend: undefined as never } };
    const errors = validateKnowledgeConfig(config as KnowledgeConfig);
    expect(errors.find((e) => e.field === "store.backend")).toBeDefined();
  });

  it("requires connectionString for pgvector", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      store: { backend: "pgvector" },
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "store.connectionString")).toBeDefined();
  });

  it("requires connectionString for sqlite-vec", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      store: { backend: "sqlite-vec" },
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "store.connectionString")).toBeDefined();
  });

  it("requires chunking.strategy", () => {
    const config = { ...validConfig, chunking: { strategy: undefined as never } };
    const errors = validateKnowledgeConfig(config as KnowledgeConfig);
    expect(errors.find((e) => e.field === "chunking.strategy")).toBeDefined();
  });

  it("rejects invalid chunking strategy", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      chunking: { strategy: "invalid" as never },
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "chunking.strategy")).toBeDefined();
  });

  it("rejects chunkSize <= 0", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      chunking: { strategy: "recursive", chunkSize: 0 },
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "chunking.chunkSize")).toBeDefined();
  });

  it("rejects negative chunkOverlap", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      chunking: { strategy: "recursive", chunkOverlap: -1 },
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "chunking.chunkOverlap")).toBeDefined();
  });

  it("rejects chunkOverlap >= chunkSize", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      chunking: { strategy: "recursive", chunkSize: 100, chunkOverlap: 100 },
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "chunking.chunkOverlap")).toBeDefined();
  });

  it("rejects empty sources array", () => {
    const config = { ...validConfig, sources: [] };
    const errors = validateKnowledgeConfig(config as KnowledgeConfig);
    expect(errors.find((e) => e.field === "sources")).toBeDefined();
  });

  it("requires source name", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      sources: [{ name: "", path: "./docs" }],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "sources[0].name")).toBeDefined();
  });

  it("requires source path", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      sources: [{ name: "docs", path: "" }],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "sources[0].path")).toBeDefined();
  });

  it("rejects duplicate source names", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      sources: [
        { name: "docs", path: "./docs" },
        { name: "docs", path: "./more-docs" },
      ],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors.find((e) => e.field === "sources[1].name")).toBeDefined();
  });

  it("allows valid allowedAgents", () => {
    const config: KnowledgeConfig = {
      ...validConfig,
      allowedAgents: ["agent1", "agent2"],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors).toHaveLength(0);
  });

  it("allows default chunkSize", () => {
    const config: KnowledgeConfig = {
      embedding: { provider: "openai", apiKeyEnv: "KEY" },
      store: { backend: "memory" },
      chunking: { strategy: "recursive" },
      sources: [{ name: "docs", path: "./docs" }],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors).toHaveLength(0);
  });

  it("allows default chunkOverlap", () => {
    const config: KnowledgeConfig = {
      embedding: { provider: "openai", apiKeyEnv: "KEY" },
      store: { backend: "memory" },
      chunking: { strategy: "recursive", chunkSize: 512 },
      sources: [{ name: "docs", path: "./docs" }],
    };
    const errors = validateKnowledgeConfig(config);
    expect(errors).toHaveLength(0);
  });
});
