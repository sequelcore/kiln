import { describe, it, expect, vi } from "vitest";
import { AgentRAG } from "../../src/agents/agent-rag.js";
import type { AgentDescription } from "../../src/agents/agent-rag.js";
import type { EmbeddingAdapter } from "../../src/engine/domain/embedding.js";
import type { VectorStore } from "../../src/engine/domain/vector-store.js";
import { KilnError } from "../../src/engine/errors.js";

function mockEmbedder(): EmbeddingAdapter {
  return {
    name: "test",
    dimensions: 3,
    embed: vi.fn().mockResolvedValue([[0.1, 0.2, 0.3]]),
  };
}

function mockStore(): VectorStore {
  return {
    upsert: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(undefined),
    deleteByMetadata: vi.fn().mockResolvedValue(0),
  };
}

function createAgent(id: string, name: string, role: string, goal: string): AgentDescription {
  return { id, name, role, goal };
}

describe("AgentRAG", () => {
  const agents: AgentDescription[] = [
    createAgent("sales", "Sales Bot", "Sales representative", "Close deals and answer pricing questions"),
    createAgent("support", "Support Bot", "Customer support agent", "Resolve technical issues quickly"),
    createAgent("billing", "Billing Bot", "Billing specialist", "Handle invoices and payment queries"),
  ];

  it("ingestAgents stores embeddings in vector store", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();
    (embedder.embed as ReturnType<typeof vi.fn>).mockResolvedValue([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ]);

    const rag = new AgentRAG(embedder, store);
    await rag.ingestAgents(agents);

    expect(embedder.embed).toHaveBeenCalledWith([
      "Sales Bot: Sales representative. Close deals and answer pricing questions",
      "Support Bot: Customer support agent. Resolve technical issues quickly",
      "Billing Bot: Billing specialist. Handle invoices and payment queries",
    ]);
    expect(store.upsert).toHaveBeenCalledWith([
      {
        id: "agent:sales",
        content: "Sales Bot: Sales representative. Close deals and answer pricing questions",
        embedding: [0.1, 0.2, 0.3],
        metadata: { agentId: "sales" },
      },
      {
        id: "agent:support",
        content: "Support Bot: Customer support agent. Resolve technical issues quickly",
        embedding: [0.4, 0.5, 0.6],
        metadata: { agentId: "support" },
      },
      {
        id: "agent:billing",
        content: "Billing Bot: Billing specialist. Handle invoices and payment queries",
        embedding: [0.7, 0.8, 0.9],
        metadata: { agentId: "billing" },
      },
    ]);
  });

  it("selectAgent returns highest scoring agent", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();
    (store.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "agent:sales", content: "Sales Bot: Sales representative. Close deals", score: 0.92, metadata: { agentId: "sales" } },
    ]);

    const rag = new AgentRAG(embedder, store);
    await rag.ingestAgents(agents);

    const result = await rag.selectAgent("I want to know the price", agents);

    expect(result).toEqual({ agentId: "sales", score: 0.92 });
    expect(store.query).toHaveBeenCalledWith([0.1, 0.2, 0.3], { topK: 1 });
  });

  it("selectAgent returns undefined when no agents ingested", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();

    const rag = new AgentRAG(embedder, store);
    const result = await rag.selectAgent("hello", agents);

    expect(result).toBeUndefined();
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("selectAgent with empty query still returns result", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();
    (store.query as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "agent:support", content: "...", score: 0.5, metadata: { agentId: "support" } },
    ]);

    const rag = new AgentRAG(embedder, store);
    await rag.ingestAgents(agents);

    const result = await rag.selectAgent("", agents);

    expect(result).toEqual({ agentId: "support", score: 0.5 });
    expect(embedder.embed).toHaveBeenCalledWith([""]);
  });

  it("ingestAgents with empty array is no-op", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();

    const rag = new AgentRAG(embedder, store);
    await rag.ingestAgents([]);

    expect(embedder.embed).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();

    // selectAgent returns undefined since store has no entries
    (store.query as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const result = await rag.selectAgent("test", []);
    expect(result).toBeUndefined();
  });

  it("re-ingest clears previous state", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();
    (embedder.embed as ReturnType<typeof vi.fn>).mockResolvedValue([[0.1, 0.2, 0.3]]);

    const rag = new AgentRAG(embedder, store);
    const single = [createAgent("a1", "Agent One", "Role one", "Goal one")];

    await rag.ingestAgents(single);
    await rag.ingestAgents(single);

    expect(store.upsert).toHaveBeenCalledTimes(2);
  });

  it("embedder failure throws AGENT_RAG_FAILED", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();
    (embedder.embed as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("embed failed"));

    const rag = new AgentRAG(embedder, store);

    await expect(rag.ingestAgents(agents)).rejects.toThrow(KilnError);
    await expect(rag.ingestAgents(agents)).rejects.toMatchObject({
      code: "AGENT_RAG_FAILED",
    });
  });

  it("store query failure throws AGENT_RAG_FAILED", async () => {
    const embedder = mockEmbedder();
    const store = mockStore();
    (store.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("query failed"));

    const rag = new AgentRAG(embedder, store);
    await rag.ingestAgents(agents);

    await expect(rag.selectAgent("test", agents)).rejects.toThrow(KilnError);
    await expect(rag.selectAgent("test", agents)).rejects.toMatchObject({
      code: "AGENT_RAG_FAILED",
    });
  });
});
