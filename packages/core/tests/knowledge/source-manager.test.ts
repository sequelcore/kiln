import { describe, it, expect, vi, beforeEach } from "vitest";
import { SourceManager } from "../../src/knowledge/source-manager.js";
import { InMemorySourceStore } from "../../src/knowledge/infrastructure/memory-source-store.js";
import { KilnError } from "../../src/engine/errors.js";
import type { ContentExtractor, KnowledgeSource } from "../../src/engine/domain/knowledge-source.js";
import type { RetrievalPipeline } from "../../src/knowledge/retrieval-pipeline.js";
import type { VectorStore } from "../../src/engine/domain/vector-store.js";

function mockExtractor(): ContentExtractor {
  return {
    supportedTypes: ["file", "url", "pdf"],
    extract: vi.fn().mockResolvedValue({
      content: "extracted content",
      metadata: { source: "test-uri" },
    }),
  };
}

function mockPipeline(): RetrievalPipeline {
  return {
    ingest: vi.fn().mockResolvedValue(5),
    retrieve: vi.fn().mockResolvedValue([]),
  } as unknown as RetrievalPipeline;
}

function mockVectorStore(): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByMetadata: vi.fn().mockResolvedValue(3),
  };
}

describe("SourceManager", () => {
  let sourceStore: InMemorySourceStore;
  let extractor: ContentExtractor;
  let pipeline: ReturnType<typeof mockPipeline>;
  let vectorStore: ReturnType<typeof mockVectorStore>;
  let manager: SourceManager;

  beforeEach(() => {
    sourceStore = new InMemorySourceStore();
    extractor = mockExtractor();
    pipeline = mockPipeline();
    vectorStore = mockVectorStore();
    manager = new SourceManager({ sourceStore, extractor, pipeline, vectorStore });
  });

  describe("addSource", () => {
    it("creates a new source with pending status", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "My Source",
        type: "file",
        uri: "/tmp/test.txt",
      });

      expect(source.sourceId).toBeDefined();
      expect(source.appName).toBe("test-app");
      expect(source.name).toBe("My Source");
      expect(source.type).toBe("file");
      expect(source.uri).toBe("/tmp/test.txt");
      expect(source.status).toBe("pending");
      expect(source.chunkCount).toBe(0);
    });

    it("throws SOURCE_ALREADY_EXISTS for duplicate name", async () => {
      await manager.addSource({ appName: "test-app", name: "Dup", type: "file", uri: "/a" });

      await expect(
        manager.addSource({ appName: "test-app", name: "Dup", type: "url", uri: "/b" }),
      ).rejects.toThrow(KilnError);

      try {
        await manager.addSource({ appName: "test-app", name: "Dup", type: "url", uri: "/b" });
      } catch (err) {
        expect((err as KilnError).code).toBe("SOURCE_ALREADY_EXISTS");
      }
    });

    it("allows same name across different apps", async () => {
      await manager.addSource({ appName: "app-a", name: "Same", type: "file", uri: "/a" });
      const source = await manager.addSource({ appName: "app-b", name: "Same", type: "file", uri: "/b" });

      expect(source.appName).toBe("app-b");
    });
  });

  describe("ingest", () => {
    it("extracts, hashes, and ingests content", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Ingest Test",
        type: "file",
        uri: "/tmp/test.txt",
      });

      const result = await manager.ingest(source);

      expect(result.status).toBe("indexed");
      expect(result.contentHash).toBeDefined();
      expect(result.chunkCount).toBe(5);
      expect(result.lastIndexedAt).toBeDefined();
      expect(extractor.extract).toHaveBeenCalledWith("/tmp/test.txt", "file", { headers: undefined });
      expect(pipeline.ingest).toHaveBeenCalled();
    });

    it("skips ingestion when content hash matches", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Hash Test",
        type: "file",
        uri: "/tmp/test.txt",
      });

      // First ingest
      const first = await manager.ingest(source);
      expect(first.status).toBe("indexed");

      // Second ingest with same content -- should skip
      const second = await manager.ingest(first);
      expect(second.status).toBe("indexed");

      // pipeline.ingest should only be called once
      expect(pipeline.ingest).toHaveBeenCalledTimes(1);
    });

    it("deletes old chunks before re-ingesting", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Delete Test",
        type: "file",
        uri: "/tmp/test.txt",
      });

      await manager.ingest(source);

      expect(vectorStore.deleteByMetadata).toHaveBeenCalledWith({ source: source.sourceId });
    });

    it("sets status to failed on extraction error", async () => {
      (extractor.extract as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("read error"));

      const source = await manager.addSource({
        appName: "test-app",
        name: "Fail Test",
        type: "file",
        uri: "/tmp/missing.txt",
      });

      const result = await manager.ingest(source);

      expect(result.status).toBe("failed");
      expect(result.error).toBe("read error");
    });
  });

  describe("ingestAll", () => {
    it("ingests all sources for an app", async () => {
      await manager.addSource({ appName: "test-app", name: "S1", type: "file", uri: "/a" });
      await manager.addSource({ appName: "test-app", name: "S2", type: "url", uri: "/b" });

      const results = await manager.ingestAll("test-app");

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.status === "indexed")).toBe(true);
    });
  });

  describe("reindex", () => {
    it("forces re-ingestion by clearing content hash", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Reindex Test",
        type: "file",
        uri: "/tmp/test.txt",
      });

      // First ingest
      await manager.ingest(source);
      expect(pipeline.ingest).toHaveBeenCalledTimes(1);

      // Reindex should ingest again even with same content
      const result = await manager.reindex("test-app", source.sourceId);
      expect(result.status).toBe("indexed");
      expect(pipeline.ingest).toHaveBeenCalledTimes(2);
    });

    it("throws SOURCE_NOT_FOUND for unknown source", async () => {
      await expect(manager.reindex("test-app", "nonexistent")).rejects.toThrow(KilnError);

      try {
        await manager.reindex("test-app", "nonexistent");
      } catch (err) {
        expect((err as KilnError).code).toBe("SOURCE_NOT_FOUND");
      }
    });
  });

  describe("removeSource", () => {
    it("removes source and cleans up chunks", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Remove Test",
        type: "file",
        uri: "/tmp/test.txt",
      });

      const removed = await manager.removeSource("test-app", source.sourceId);

      expect(removed).toBe(true);
      expect(manager.get("test-app", source.sourceId)).toBeUndefined();
      expect(vectorStore.deleteByMetadata).toHaveBeenCalledWith({ source: source.sourceId });
    });

    it("returns false for nonexistent source", async () => {
      expect(await manager.removeSource("test-app", "nonexistent")).toBe(false);
    });
  });

  describe("addSource with headers", () => {
    it("persists headers on the created source", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Authed Source",
        type: "url",
        uri: "https://example.com/api",
        headers: { Authorization: "Bearer tok-123" },
      });

      expect(source.headers).toEqual({ Authorization: "Bearer tok-123" });
      const retrieved = manager.get("test-app", source.sourceId);
      expect(retrieved?.headers).toEqual({ Authorization: "Bearer tok-123" });
    });
  });

  describe("ingest with headers", () => {
    it("passes source.headers to extractor", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Header Ingest",
        type: "url",
        uri: "https://example.com",
        headers: { "X-API-Key": "key-456" },
      });

      await manager.ingest(source);

      expect(extractor.extract).toHaveBeenCalledWith("https://example.com", "url", {
        headers: { "X-API-Key": "key-456" },
      });
    });
  });

  describe("ingestContent", () => {
    it("indexes provided content directly", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Direct Content",
        type: "file",
        uri: "/tmp/test.txt",
      });

      const result = await manager.ingestContent("test-app", source.sourceId, "direct content here");

      expect(result.status).toBe("indexed");
      expect(result.contentHash).toBeDefined();
      expect(result.chunkCount).toBe(5);
      expect(result.lastIndexedAt).toBeDefined();
      expect(pipeline.ingest).toHaveBeenCalled();
      // Should NOT call extractor -- content is provided directly
      expect(extractor.extract).not.toHaveBeenCalled();
    });

    it("skips re-ingestion when content hash matches", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Hash Skip",
        type: "file",
        uri: "/tmp/test.txt",
      });

      const first = await manager.ingestContent("test-app", source.sourceId, "same content");
      const second = await manager.ingestContent("test-app", first.sourceId, "same content");

      expect(second.status).toBe("indexed");
      expect(pipeline.ingest).toHaveBeenCalledTimes(1);
    });

    it("sets status to failed on pipeline error", async () => {
      (pipeline.ingest as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("pipeline boom"));

      const source = await manager.addSource({
        appName: "test-app",
        name: "Fail Content",
        type: "file",
        uri: "/tmp/test.txt",
      });

      const result = await manager.ingestContent("test-app", source.sourceId, "some content");

      expect(result.status).toBe("failed");
      expect(result.error).toBe("pipeline boom");
    });

    it("throws SOURCE_NOT_FOUND for unknown source", async () => {
      await expect(
        manager.ingestContent("test-app", "nonexistent", "content"),
      ).rejects.toThrow(KilnError);

      try {
        await manager.ingestContent("test-app", "nonexistent", "content");
      } catch (err) {
        expect((err as KilnError).code).toBe("SOURCE_NOT_FOUND");
      }
    });
  });

  describe("list / get", () => {
    it("lists sources for an app", async () => {
      await manager.addSource({ appName: "test-app", name: "S1", type: "file", uri: "/a" });
      await manager.addSource({ appName: "test-app", name: "S2", type: "url", uri: "/b" });

      expect(manager.list("test-app")).toHaveLength(2);
    });

    it("gets a source by id", async () => {
      const source = await manager.addSource({
        appName: "test-app",
        name: "Get Test",
        type: "file",
        uri: "/tmp/test.txt",
      });

      expect(manager.get("test-app", source.sourceId)?.name).toBe("Get Test");
    });
  });
});
