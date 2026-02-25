import { describe, it, expect, beforeEach } from "vitest";
import { ToolRAG } from "../../src/agents/tool-rag.js";
import type { EmbeddingAdapter } from "../../src/engine/domain/embedding.js";
import type { VectorStore, VectorEntry, VectorResult } from "../../src/engine/domain/vector-store.js";
import type { Capability } from "../../src/engine/domain/capability.js";
import type { ToolSelectionConfig } from "../../src/engine/domain/tool-selection-config.js";

/**
 * Deterministic hash-based embedder: produces a unique 3D unit vector for each
 * input string so that cosine similarity actually differentiates results.
 */
class MockEmbedder implements EmbeddingAdapter {
  readonly name = "mock";
  readonly dimensions = 3;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => {
      let h = 0;
      for (let i = 0; i < text.length; i++) {
        h = ((h << 5) - h + text.charCodeAt(i)) | 0;
      }
      const a = ((h & 0xff) / 255) * Math.PI * 2;
      const b = (((h >> 8) & 0xff) / 255) * Math.PI;
      return [Math.sin(b) * Math.cos(a), Math.sin(b) * Math.sin(a), Math.cos(b)];
    });
  }
}

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    magA += a[i]! * a[i]!;
    magB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Vector store that actually computes cosine similarity when querying,
 * so relevance ranking is meaningful.
 */
class MockVectorStore implements VectorStore {
  private entries: VectorEntry[] = [];

  async upsert(entries: VectorEntry[]): Promise<void> {
    this.entries = entries;
  }

  async query(embedding: number[], options: { topK: number }): Promise<VectorResult[]> {
    const scored = this.entries.map((e) => ({
      id: e.id,
      content: e.content,
      score: cosineSimilarity(embedding, e.embedding),
      metadata: e.metadata,
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, options.topK);
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
      expect(selected.length).toBeGreaterThan(0);
      // Every selected tool must come from the original tool set
      for (const tool of selected) {
        expect(tools.some((t) => t.name === tool.name)).toBe(true);
      }
    });

    it("ranks tools by relevance -- most similar tool appears first", async () => {
      const rag = new ToolRAG(embedder, store, config);
      // Create tools with very different descriptions
      const tools = [
        createTool("web_search", "Search the internet for information"),
        createTool("send_email", "Compose and send an email message"),
        createTool("read_file", "Read contents of a local file"),
        createTool("write_file", "Write data to a local file"),
        createTool("run_tests", "Execute unit test suite"),
        createTool("deploy_app", "Deploy application to production"),
        createTool("lint_code", "Check code style and formatting"),
        createTool("git_commit", "Create a git commit with changes"),
        createTool("db_query", "Run a database SQL query"),
        createTool("http_request", "Make an HTTP API request"),
        createTool("parse_json", "Parse a JSON document"),
      ];

      await rag.ingestTools(tools);

      // ToolRAG ingests as "name: description", so querying with the exact
      // ingested text should yield a perfect cosine match for that tool.
      const selected = await rag.selectTools("web_search: Search the internet for information", tools);

      expect(selected.length).toBeLessThanOrEqual(5);
      expect(selected.length).toBeGreaterThan(0);
      // The top result should be web_search since the query matches its embedding exactly
      expect(selected[0]!.name).toBe("web_search");
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
      // Should be the first 5 tools in order (fallback slice)
      expect(selected.map((t) => t.name)).toEqual(["tool-0", "tool-1", "tool-2", "tool-3", "tool-4"]);
    });
  });

  describe("ingestTools", () => {
    it("stores tools in vector store and makes them retrievable", async () => {
      const rag = new ToolRAG(embedder, store, config);
      const tools = Array.from({ length: 15 }, (_, i) =>
        createTool(`tool-${i}`, `Description ${i}`),
      );

      await rag.ingestTools(tools);

      // Verify ingested tools are retrievable and are actual tools from the set
      const selected = await rag.selectTools("Description 3", tools);
      expect(selected.length).toBeGreaterThan(0);
      for (const tool of selected) {
        expect(tools.some((t) => t.name === tool.name)).toBe(true);
      }
    });

    it("handles empty tools array", async () => {
      const rag = new ToolRAG(embedder, store, config);

      await expect(rag.ingestTools([])).resolves.toBeUndefined();
    });
  });

  describe("mock embedder produces distinct vectors", () => {
    it("returns different embeddings for different inputs", async () => {
      const vectors = await embedder.embed(["hello", "world", "hello"]);
      // "hello" and "world" should produce different vectors
      expect(vectors[0]).not.toEqual(vectors[1]);
      // Same input should produce the same vector
      expect(vectors[0]).toEqual(vectors[2]);
    });
  });
});
