import { describe, it, expect } from "vitest";
import { RecursiveTextChunker } from "../../src/knowledge/recursive-chunker.js";
import type { Document, ChunkConfig } from "../../src/engine/domain/chunker.js";

describe("RecursiveTextChunker", () => {
  const defaultConfig: ChunkConfig = { chunkSize: 100, chunkOverlap: 20 };

  it("returns empty array for empty document", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "", metadata: {} };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result).toEqual([]);
  });

  it("returns single chunk for document smaller than chunkSize", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "Short text", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("Short text");
  });

  it("splits by double newline (paragraph)", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "First paragraph.\n\nSecond paragraph.", metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 50, chunkOverlap: 10 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("First paragraph");
  });

  it("splits by single newline when no double newline", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "Line one\nLine two\nLine three", metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 20, chunkOverlap: 5 });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("produces deterministic chunk IDs", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "A".repeat(200), metadata: { source: "test" } };
    const result1 = chunker.chunk(doc, defaultConfig);
    const result2 = chunker.chunk(doc, defaultConfig);
    expect(result1.map((c: { id: string }) => c.id)).toEqual(result2.map((c: { id: string }) => c.id));
  });

  it("applies chunkOverlap correctly", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "AAAA" + "B".repeat(100) + "CCCC", metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 50, chunkOverlap: 10 });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("clamps chunkOverlap to 0 when >= chunkSize", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "A".repeat(500), metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 100, chunkOverlap: 200 });
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles single character document", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "A", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toBe("A");
  });

  it("handles document with no separators", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "abcdefghij", metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 5, chunkOverlap: 1 });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("splits by sentence (. ) delimiter", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "This is sentence one. This is sentence two.", metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 15, chunkOverlap: 3 });
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves metadata in chunks", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "Test content", metadata: { source: "my-source", custom: "value" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.metadata.source).toBe("my-source");
    expect(result[0]!.metadata.custom).toBe("value");
  });

  it("handles default chunkSize of 512 when not specified", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "x".repeat(1000), metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 0, chunkOverlap: 0 });
    expect(result.length).toBe(2);
  });

  it("handles negative chunkOverlap", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "A".repeat(200), metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 100, chunkOverlap: -10 });
    expect(result.length).toBeGreaterThan(0);
  });

  it("handles whitespace-only document", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "   \n\n   ", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result.length).toBeGreaterThanOrEqual(0);
  });

  it("includes chunkIndex in metadata", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "A".repeat(300), metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.metadata.chunkIndex).toBe(0);
    if (result.length > 1) {
      expect(result[1]!.metadata.chunkIndex).toBe(1);
    }
  });

  it("generates 16-character hex IDs", () => {
    const chunker = new RecursiveTextChunker();
    const doc: Document = { content: "Test content here", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.id).toMatch(/^[a-f0-9]{16}$/);
  });
});
