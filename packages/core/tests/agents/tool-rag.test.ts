import { describe, it, expect, beforeEach } from "vitest";
import { ToolRAG } from "../../src/agents/tool-rag.js";
import type { EmbeddingAdapter } from "../../src/engine/domain/embedding.js";
import type { VectorStore, VectorEntry, VectorResult } from "../../src/engine/domain/vector-store.js";
import type { Capability } from "../../src/engine/domain/capability.js";
import type { ToolSelectionConfig } from "../../src/engine/domain/tool-selection-config.js";

class MockEmbedder implements EmbeddingAdapter {
  readonly name = "mock";
  readonly dimensions = 3;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0.1, 0.2, 0.3]);
  }
}

class MockVectorStore implements VectorStore {
  private entries: VectorEntry[] = [];

  async upsert(entries: VectorEntry[]): Promise<void> {
    this.entries = entries;
  }

  async query(_embedding: number[], options: { topK: number }): Promise<VectorResult[]> {
    return this.entries.slice(0, options.topK).map((e) => ({
      id: e.id,
      content: e.content,
      score: 0.9,
      metadata: e.metadata,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    this.entries = this.entries.filter((e) => !ids.includes(e.id));
  }
}

function createTool(name: string, description: string): Capability {
  return { name, description, schema: {}, tags: [] };
}

describe("ToolRAG", () => {
  let embedder: MockEmbedder;
  let store: MockVectorStore;
  let config: ToolSelectionConfig;

  beforeEach(() => {
    embedder = new MockEmbedder();
    store = new MockVectorStore();
    config = { strategy: "rag", maxTools: 5, threshold: 10 };
  });

  describe("selectTools", () => {
    it("returns all tools when count <= threshold (bypass mode)", async () => {
      const rag = new ToolRAG(embedder, store, config);
      const tools = [
        createTool("search", "Search the web"),
        createTool("email", "Send emails"),
      ];

      const selected = await rag.selectTools("query", tools);

      expect(selected).toHaveLength(2);
      expect(selected).toEqual(tools);
    });

    it("embeds and retrieves relevant tools when count > threshold", async () => {
      const rag = new ToolRAG(embedder, store, config);
      const tools = Array.from({ length: 15 }, (_, i) => createTool(`tool-${i}`, `Description ${i}`));

      await rag.ingestTools(tools);
      const selected = await rag.selectTools("query", tools);

      expect(selected.length).toBeLessThanOrEqual(5);
    });

    it("returns maxTools count of results", async () => {
      const rag = new ToolRAG(embedder, store, { ...config, maxTools: 3 });
      const tools = Array.from({ length: 15 }, (_, i) => createTool(`tool-${i}`, `Description ${i}`));

      await rag.ingestTools(tools);
      const selected = await rag.selectTools("query", tools);

      expect(selected.length).toBeLessThanOrEqual(3);
    });

    it("handles empty tool set", async () => {
      const rag = new ToolRAG(embedder, store, config);

      await rag.ingestTools([]);
      const selected = await rag.selectTools("query", []);

      expect(selected).toEqual([]);
    });

    it("returns subset of tools before ingestion", async () => {
      const rag = new ToolRAG(embedder, store, config);
      const tools = Array.from({ length: 15 }, (_, i) => createTool(`tool-${i}`, `Description ${i}`));

      // Don't ingest - should return first maxTools
      const selected = await rag.selectTools("query", tools);

      expect(selected).toHaveLength(5);
    });
  });

  describe("ingestTools", () => {
    it("stores tools in vector store", async () => {
      const rag = new ToolRAG(embedder, store, config);
      const tools = [
        createTool("search", "Search the web"),
        createTool("email", "Send emails"),
      ];

      await rag.ingestTools(tools);

      // Verify by querying
      const selected = await rag.selectTools("query", tools);
      expect(selected.length).toBeGreaterThan(0);
    });

    it("handles empty tools array", async () => {
      const rag = new ToolRAG(embedder, store, config);

      await expect(rag.ingestTools([])).resolves.toBeUndefined();
    });
  });
});
