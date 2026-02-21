import { describe, it, expect } from "vitest";
import { MarkdownChunker } from "../../src/knowledge/markdown-chunker.js";
import type { Document, ChunkConfig } from "../../src/engine/domain/chunker.js";

describe("MarkdownChunker", () => {
  const defaultConfig: ChunkConfig = { chunkSize: 100, chunkOverlap: 20 };

  it("returns empty array for empty document", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "", metadata: {} };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result).toEqual([]);
  });

  it("returns single chunk for document smaller than chunkSize", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title\n\nSome content", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result).toHaveLength(1);
  });

  it("splits by heading hierarchy", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Heading 1\n\nContent 1\n\n## Heading 2\n\nContent 2", metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 20, chunkOverlap: 5 });
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result[0]!.content).toContain("Heading 1");
  });

  it("preserves heading context as metadata", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Main Title\n\n## Section\n\nContent", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.metadata.heading).toBeDefined();
  });

  it("handles nested headings", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# H1\n## H2\n### H3\nContent", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("preserves code blocks", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title\n\n```javascript\nconst x = 1;\n```", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.content).toContain("const x = 1;");
  });

  it("handles code blocks without language", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title\n\n```\nsome code\n```", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.content).toContain("some code");
  });

  it("produces deterministic chunk IDs", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title\n\nContent", metadata: { source: "test" } };
    const result1 = chunker.chunk(doc, defaultConfig);
    const result2 = chunker.chunk(doc, defaultConfig);
    expect(result1.map((c: { id: string }) => c.id)).toEqual(result2.map((c: { id: string }) => c.id));
  });

  it("handles document with no headings (uses fallback)", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "No headings here just plain text", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("applies chunkOverlap in fallback", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "A".repeat(500), metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 100, chunkOverlap: 20 });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("handles indented code blocks", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title\n\n    const x = 1;", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.content).toContain("const x = 1");
  });

  it("includes level in metadata", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "## Section\n\nContent", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.metadata.level).toBe(2);
  });

  it("handles multiple headings in sequence", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# One\n\n" + "Content one ".repeat(50) + "\n\n# Two\n\n" + "Content two ".repeat(50), metadata: { source: "test" } };
    const result = chunker.chunk(doc, { chunkSize: 50, chunkOverlap: 10 });
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("handles heading at start of document", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title", metadata: { source: "test" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result).toHaveLength(1);
    expect(result[0]!.content).toContain("Title");
  });

  it("preserves metadata in chunks", () => {
    const chunker = new MarkdownChunker();
    const doc: Document = { content: "# Title\n\nContent", metadata: { source: "my-source", custom: "value" } };
    const result = chunker.chunk(doc, defaultConfig);
    expect(result[0]!.metadata.source).toBe("my-source");
    expect(result[0]!.metadata.custom).toBe("value");
  });
});
