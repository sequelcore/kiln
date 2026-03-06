import { describe, it, expect, vi } from "vitest";
import { ContextualEnricher } from "../../src/knowledge/contextual-enricher.js";
import type { ProviderAdapter, AgentResponse } from "../../src/agents/index.js";
import type { Document, Chunk } from "../../src/engine/domain/chunker.js";
import { textPart } from "../../src/engine/domain/content.js";

function mockProvider(contextText = "This chunk discusses testing."): ProviderAdapter {
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: [textPart(contextText)],
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "stop",
    } satisfies AgentResponse),
    streamMessage: vi.fn(),
  };
}

function makeChunks(count: number): Chunk[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `chunk-${i}`,
    content: `Chunk ${i} content`,
    metadata: { chunkIndex: i, source: "test" },
  }));
}

const testDoc: Document = {
  content: "This is a test document about software engineering best practices.",
  metadata: { source: "test.md" },
};

describe("ContextualEnricher", () => {
  it("enriches chunks with context prefix", async () => {
    const provider = mockProvider();
    const enricher = new ContextualEnricher({ provider });
    const chunks = makeChunks(2);

    const enriched = await enricher.enrich(testDoc, chunks);

    expect(enriched).toHaveLength(2);
    expect(enriched[0]!.content).toBe(
      "<context>\nThis chunk discusses testing.\n</context>\nChunk 0 content",
    );
    expect(enriched[1]!.content).toBe(
      "<context>\nThis chunk discusses testing.\n</context>\nChunk 1 content",
    );
  });

  it("returns empty array for empty chunks", async () => {
    const provider = mockProvider();
    const enricher = new ContextualEnricher({ provider });

    const enriched = await enricher.enrich(testDoc, []);

    expect(enriched).toEqual([]);
    expect(provider.createMessage).not.toHaveBeenCalled();
  });

  it("preserves chunk id and metadata", async () => {
    const provider = mockProvider();
    const enricher = new ContextualEnricher({ provider });
    const chunks = makeChunks(1);

    const enriched = await enricher.enrich(testDoc, chunks);

    expect(enriched[0]!.id).toBe("chunk-0");
    expect(enriched[0]!.metadata).toEqual({ chunkIndex: 0, source: "test" });
  });

  it("passes document content as system prompt", async () => {
    const provider = mockProvider();
    const enricher = new ContextualEnricher({ provider });
    const chunks = makeChunks(1);

    await enricher.enrich(testDoc, chunks);

    expect(provider.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        system: testDoc.content,
        maxTokens: 200,
      }),
    );
  });

  it("truncates long documents", async () => {
    const provider = mockProvider();
    const enricher = new ContextualEnricher({ provider, maxDocumentChars: 20 });
    const longDoc: Document = {
      content: "A".repeat(100),
      metadata: {},
    };
    const chunks = makeChunks(1);

    await enricher.enrich(longDoc, chunks);

    expect(provider.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "A".repeat(20),
      }),
    );
  });

  it("fails open when LLM call throws", async () => {
    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockRejectedValue(new Error("API error")),
      streamMessage: vi.fn(),
    };
    const enricher = new ContextualEnricher({ provider });
    const chunks = makeChunks(2);

    const enriched = await enricher.enrich(testDoc, chunks);

    expect(enriched).toHaveLength(2);
    // Original content unchanged on failure
    expect(enriched[0]!.content).toBe("Chunk 0 content");
    expect(enriched[1]!.content).toBe("Chunk 1 content");
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const provider: ProviderAdapter = {
      name: "mock",
      createMessage: vi.fn().mockImplementation(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return {
          parts: [textPart("context")],
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          toolCalls: [],
          stopReason: "stop",
        } satisfies AgentResponse;
      }),
      streamMessage: vi.fn(),
    };

    const enricher = new ContextualEnricher({ provider, concurrency: 2 });
    const chunks = makeChunks(6);

    await enricher.enrich(testDoc, chunks);

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(provider.createMessage).toHaveBeenCalledTimes(6);
  });

  it("handles single chunk", async () => {
    const provider = mockProvider("Single chunk context.");
    const enricher = new ContextualEnricher({ provider });
    const chunks = makeChunks(1);

    const enriched = await enricher.enrich(testDoc, chunks);

    expect(enriched).toHaveLength(1);
    expect(enriched[0]!.content).toContain("<context>");
    expect(enriched[0]!.content).toContain("Single chunk context.");
    expect(enriched[0]!.content).toContain("Chunk 0 content");
  });

  it("trims whitespace from LLM response", async () => {
    const provider = mockProvider("  context with whitespace  \n");
    const enricher = new ContextualEnricher({ provider });
    const chunks = makeChunks(1);

    const enriched = await enricher.enrich(testDoc, chunks);

    expect(enriched[0]!.content).toBe(
      "<context>\ncontext with whitespace\n</context>\nChunk 0 content",
    );
  });
});
