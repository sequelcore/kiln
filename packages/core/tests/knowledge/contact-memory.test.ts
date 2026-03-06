import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContactMemoryServiceImpl } from "../../src/knowledge/contact-memory.js";
import type { ProviderAdapter, AgentResponse } from "../../src/agents/index.js";
import type { VectorStore, VectorEntry, VectorResult, VectorQueryOptions } from "../../src/engine/domain/vector-store.js";
import type { EmbeddingAdapter } from "../../src/engine/domain/embedding.js";
import { textPart } from "../../src/engine/domain/content.js";

function mockProvider(response?: string): ProviderAdapter {
  const defaultResponse = JSON.stringify([
    { action: "ADD", content: "Customer prefers email communication", category: "preference", confidence: 0.9 },
    { action: "ADD", content: "Customer name is John", category: "entity", confidence: 1.0 },
  ]);
  return {
    name: "mock",
    createMessage: vi.fn().mockResolvedValue({
      parts: [textPart(response ?? defaultResponse)],
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: [],
      stopReason: "stop",
    } satisfies AgentResponse),
    streamMessage: vi.fn(),
  };
}

function mockEmbedder(): EmbeddingAdapter {
  return {
    name: "mock",
    dimensions: 3,
    embed: vi.fn().mockImplementation((texts: string[]) =>
      Promise.resolve(texts.map(() => [0.1, 0.2, 0.3])),
    ),
  };
}

function mockVectorStore(): VectorStore & {
  _entries: Map<string, VectorEntry>;
} {
  const entries = new Map<string, VectorEntry>();
  return {
    _entries: entries,
    upsert: vi.fn().mockImplementation(async (newEntries: VectorEntry[]) => {
      for (const entry of newEntries) entries.set(entry.id, entry);
    }),
    query: vi.fn().mockImplementation(async (_embedding: number[], options: VectorQueryOptions): Promise<VectorResult[]> => {
      const results: VectorResult[] = [];
      for (const entry of entries.values()) {
        if (options.filter) {
          const matches = Object.entries(options.filter).every(
            ([k, v]) => entry.metadata[k] === v,
          );
          if (!matches) continue;
        }
        results.push({
          id: entry.id,
          content: entry.content,
          score: 0.95,
          metadata: entry.metadata,
        });
        if (results.length >= options.topK) break;
      }
      return results;
    }),
    delete: vi.fn().mockImplementation(async (ids: string[]) => {
      for (const id of ids) entries.delete(id);
    }),
    deleteByMetadata: vi.fn().mockImplementation(async (filter: Record<string, unknown>) => {
      let count = 0;
      for (const [id, entry] of entries) {
        const matches = Object.entries(filter).every(([k, v]) => entry.metadata[k] === v);
        if (matches) {
          entries.delete(id);
          count++;
        }
      }
      return count;
    }),
  };
}

describe("ContactMemoryServiceImpl", () => {
  let provider: ProviderAdapter;
  let embedder: EmbeddingAdapter;
  let store: ReturnType<typeof mockVectorStore>;
  let service: ContactMemoryServiceImpl;

  beforeEach(() => {
    provider = mockProvider();
    embedder = mockEmbedder();
    store = mockVectorStore();
    service = new ContactMemoryServiceImpl({
      vectorStore: store,
      embedder,
      provider,
    });
  });

  describe("extractAndStore", () => {
    it("extracts facts from conversation and stores them", async () => {
      const facts = await service.extractAndStore(
        "User: I prefer email. My name is John.",
        "user-123",
        "tenant-abc",
      );

      expect(facts).toHaveLength(2);
      expect(facts[0]!.content).toBe("Customer prefers email communication");
      expect(facts[0]!.category).toBe("preference");
      expect(facts[0]!.confidence).toBe(0.9);
      expect(facts[0]!.externalUserId).toBe("user-123");
      expect(facts[0]!.tenantId).toBe("tenant-abc");
      expect(facts[1]!.content).toBe("Customer name is John");

      expect(store.upsert).toHaveBeenCalledTimes(2);
      expect(embedder.embed).toHaveBeenCalled();
    });

    it("returns empty array for empty conversation", async () => {
      const facts = await service.extractAndStore("", "user-123", "tenant-abc");
      expect(facts).toHaveLength(0);
      expect(provider.createMessage).not.toHaveBeenCalled();
    });

    it("returns empty array for whitespace-only conversation", async () => {
      const facts = await service.extractAndStore("   ", "user-123", "tenant-abc");
      expect(facts).toHaveLength(0);
    });

    it("fails open when LLM call throws", async () => {
      const failProvider: ProviderAdapter = {
        name: "mock",
        createMessage: vi.fn().mockRejectedValue(new Error("API error")),
        streamMessage: vi.fn(),
      };
      const failService = new ContactMemoryServiceImpl({
        vectorStore: store,
        embedder,
        provider: failProvider,
      });

      const facts = await failService.extractAndStore(
        "User: hello",
        "user-123",
        "tenant-abc",
      );

      expect(facts).toHaveLength(0);
    });

    it("fails open when JSON parse fails", async () => {
      const badProvider = mockProvider("not valid json at all");
      const badService = new ContactMemoryServiceImpl({
        vectorStore: store,
        embedder,
        provider: badProvider,
      });

      const facts = await badService.extractAndStore(
        "User: hello",
        "user-123",
        "tenant-abc",
      );

      expect(facts).toHaveLength(0);
    });

    it("filters out invalid facts from LLM response", async () => {
      const mixed = JSON.stringify([
        { action: "ADD", content: "Valid fact", category: "general", confidence: 0.8 },
        { action: "INVALID", content: "Bad action", category: "general", confidence: 0.5 },
        { action: "ADD", content: "", category: "general", confidence: 0.5 }, // empty content
        { action: "ADD", content: "No category", category: "nonexistent", confidence: 0.5 },
      ]);
      const mixedProvider = mockProvider(mixed);
      const mixedService = new ContactMemoryServiceImpl({
        vectorStore: store,
        embedder,
        provider: mixedProvider,
      });

      const facts = await mixedService.extractAndStore(
        "User: hello",
        "user-123",
        "tenant-abc",
      );

      expect(facts).toHaveLength(1);
      expect(facts[0]!.content).toBe("Valid fact");
    });

    it("handles UPDATE action -- expires old fact", async () => {
      // First add a fact
      await service.extractAndStore(
        "User: I prefer email",
        "user-123",
        "tenant-abc",
      );
      expect(store._entries.size).toBe(2);

      // Now update
      const updateResponse = JSON.stringify([
        { action: "UPDATE", content: "Customer prefers phone communication", category: "preference", confidence: 0.95 },
      ]);
      const updateProvider = mockProvider(updateResponse);
      const updateService = new ContactMemoryServiceImpl({
        vectorStore: store,
        embedder,
        provider: updateProvider,
      });

      const updatedFacts = await updateService.extractAndStore(
        "User: Actually I prefer phone now",
        "user-123",
        "tenant-abc",
      );

      expect(updatedFacts).toHaveLength(1);
      expect(updatedFacts[0]!.content).toBe("Customer prefers phone communication");
      // Old fact should be expired (deleted) and new one added
      expect(store.delete).toHaveBeenCalled();
    });

    it("handles DELETE action -- expires fact", async () => {
      // Add a fact first
      await service.extractAndStore(
        "User: I have issue X",
        "user-123",
        "tenant-abc",
      );

      const deleteResponse = JSON.stringify([
        { action: "DELETE", content: "Customer prefers email communication", category: "preference", confidence: 1.0 },
      ]);
      const deleteProvider = mockProvider(deleteResponse);
      const deleteService = new ContactMemoryServiceImpl({
        vectorStore: store,
        embedder,
        provider: deleteProvider,
      });

      const deletedFacts = await deleteService.extractAndStore(
        "User: That issue is resolved",
        "user-123",
        "tenant-abc",
      );

      expect(deletedFacts).toHaveLength(0); // DELETE doesn't return stored facts
      expect(store.delete).toHaveBeenCalled();
    });

    it("skips NOOP actions", async () => {
      const noopResponse = JSON.stringify([
        { action: "NOOP", content: "Already known fact", category: "general", confidence: 1.0 },
      ]);
      const noopProvider = mockProvider(noopResponse);
      const noopService = new ContactMemoryServiceImpl({
        vectorStore: store,
        embedder,
        provider: noopProvider,
      });

      const facts = await noopService.extractAndStore(
        "User: same old info",
        "user-123",
        "tenant-abc",
      );

      expect(facts).toHaveLength(0);
      expect(store.upsert).not.toHaveBeenCalled();
    });

    it("passes existing facts to LLM for context", async () => {
      // Pre-populate a fact
      await store.upsert([{
        id: "existing-1",
        content: "Customer lives in Mexico",
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          externalUserId: "user-123",
          tenantId: "tenant-abc",
          category: "entity",
          confidence: 0.9,
          validAt: "2026-01-01T00:00:00Z",
          createdAt: "2026-01-01T00:00:00Z",
          type: "contact_fact",
        },
      }]);

      await service.extractAndStore(
        "User: hello again",
        "user-123",
        "tenant-abc",
      );

      // Verify LLM was called with existing facts in context
      const callArgs = (provider.createMessage as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(callArgs.messages[0].parts[0].text).toContain("Existing facts");
      expect(callArgs.messages[0].parts[0].text).toContain("Customer lives in Mexico");
    });
  });

  describe("recall", () => {
    it("recalls facts for a user", async () => {
      // Store some facts
      await store.upsert([
        {
          id: "fact-1",
          content: "Customer likes pizza",
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            externalUserId: "user-123",
            tenantId: "tenant-abc",
            category: "preference",
            confidence: 0.8,
            validAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            type: "contact_fact",
          },
        },
      ]);

      const facts = await service.recall("user-123", "tenant-abc");

      expect(facts).toHaveLength(1);
      expect(facts[0]!.content).toBe("Customer likes pizza");
      expect(facts[0]!.category).toBe("preference");
    });

    it("filters out expired facts", async () => {
      await store.upsert([
        {
          id: "active-fact",
          content: "Active fact",
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            externalUserId: "user-123",
            tenantId: "tenant-abc",
            category: "general",
            confidence: 0.8,
            validAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            type: "contact_fact",
          },
        },
        {
          id: "expired-fact",
          content: "Expired fact",
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            externalUserId: "user-123",
            tenantId: "tenant-abc",
            category: "general",
            confidence: 0.8,
            validAt: "2026-01-01T00:00:00Z",
            expiredAt: "2026-03-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            type: "contact_fact",
          },
        },
      ]);

      const facts = await service.recall("user-123", "tenant-abc");

      expect(facts).toHaveLength(1);
      expect(facts[0]!.content).toBe("Active fact");
    });

    it("accepts a custom query for similarity ranking", async () => {
      await store.upsert([
        {
          id: "fact-1",
          content: "Customer prefers dark mode",
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            externalUserId: "user-123",
            tenantId: "tenant-abc",
            category: "preference",
            confidence: 0.9,
            validAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            type: "contact_fact",
          },
        },
      ]);

      const facts = await service.recall("user-123", "tenant-abc", { query: "theme preference" });

      expect(facts).toHaveLength(1);
      expect(embedder.embed).toHaveBeenCalledWith(["theme preference"]);
    });

    it("respects limit option", async () => {
      for (let i = 0; i < 5; i++) {
        await store.upsert([{
          id: `fact-${i}`,
          content: `Fact ${i}`,
          embedding: [0.1, 0.2, 0.3],
          metadata: {
            externalUserId: "user-123",
            tenantId: "tenant-abc",
            category: "general",
            confidence: 0.8,
            validAt: "2026-01-01T00:00:00Z",
            createdAt: "2026-01-01T00:00:00Z",
            type: "contact_fact",
          },
        }]);
      }

      const facts = await service.recall("user-123", "tenant-abc", { limit: 2 });

      expect(facts.length).toBeLessThanOrEqual(2);
    });

    it("returns empty array when no facts exist", async () => {
      const facts = await service.recall("user-999", "tenant-abc");
      expect(facts).toHaveLength(0);
    });
  });

  describe("forget", () => {
    it("deletes a single fact by ID", async () => {
      await store.upsert([{
        id: "fact-to-delete",
        content: "Some fact",
        embedding: [0.1, 0.2, 0.3],
        metadata: {
          externalUserId: "user-123",
          tenantId: "tenant-abc",
          type: "contact_fact",
        },
      }]);

      await service.forget("fact-to-delete", "tenant-abc");

      expect(store.delete).toHaveBeenCalledWith(["fact-to-delete"]);
      expect(store._entries.size).toBe(0);
    });
  });

  describe("forgetAll (GDPR)", () => {
    it("deletes all facts for a user", async () => {
      await store.upsert([
        {
          id: "fact-1",
          content: "Fact 1",
          embedding: [0.1, 0.2, 0.3],
          metadata: { externalUserId: "user-123", tenantId: "tenant-abc", type: "contact_fact" },
        },
        {
          id: "fact-2",
          content: "Fact 2",
          embedding: [0.1, 0.2, 0.3],
          metadata: { externalUserId: "user-123", tenantId: "tenant-abc", type: "contact_fact" },
        },
      ]);

      await service.forgetAll("user-123", "tenant-abc");

      expect(store.deleteByMetadata).toHaveBeenCalledWith({
        externalUserId: "user-123",
        tenantId: "tenant-abc",
        type: "contact_fact",
      });
      expect(store._entries.size).toBe(0);
    });
  });
});
