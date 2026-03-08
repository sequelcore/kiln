// AgentRAG: embeds agent descriptions and retrieves the best-matching agent per query

import type { EmbeddingAdapter } from "../engine/domain/embedding.js";
import type { VectorStore, VectorEntry } from "../engine/domain/vector-store.js";
import { KilnError } from "../engine/errors.js";

export interface AgentDescription {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly goal: string;
}

export interface AgentRagResult {
  readonly agentId: string;
  readonly score: number;
}

export class AgentRAG {
  private readonly embedder: EmbeddingAdapter;
  private readonly store: VectorStore;
  private ingested = false;

  constructor(embedder: EmbeddingAdapter, store: VectorStore) {
    this.embedder = embedder;
    this.store = store;
  }

  async ingestAgents(agents: readonly AgentDescription[]): Promise<void> {
    this.ingested = false;

    if (agents.length === 0) {
      this.ingested = true;
      return;
    }

    const texts: string[] = [];
    for (const agent of agents) {
      texts.push(`${agent.name}: ${agent.role}. ${agent.goal}`);
    }

    try {
      const embeddings = await this.embedder.embed(texts);
      const entries: VectorEntry[] = [];

      for (let i = 0; i < agents.length; i++) {
        const agent = agents[i]!;
        const embedding = embeddings[i];
        if (!embedding) continue;
        entries.push({
          id: `agent:${agent.id}`,
          content: texts[i]!,
          embedding,
          metadata: { agentId: agent.id },
        });
      }

      await this.store.upsert(entries);
      this.ingested = true;
    } catch (err) {
      throw new KilnError("AGENT_RAG_FAILED", `Failed to ingest agents: ${err}`, {
        context: { agentCount: agents.length },
        cause: err,
      });
    }
  }

  async selectAgent(
    query: string,
    agents: readonly AgentDescription[],
  ): Promise<AgentRagResult | undefined> {
    if (!this.ingested) {
      return undefined;
    }

    try {
      const embeddings = await this.embedder.embed([query]);
      const queryEmbedding = embeddings[0];
      if (!queryEmbedding) {
        return undefined;
      }

      const results = await this.store.query(queryEmbedding, { topK: 1 });

      if (results.length === 0) {
        return undefined;
      }

      const result = results[0]!;
      const agentId = result.metadata.agentId as string | undefined;
      if (!agentId) {
        return undefined;
      }

      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        return undefined;
      }

      return { agentId, score: result.score };
    } catch (err) {
      throw new KilnError("AGENT_RAG_FAILED", `Failed to select agent: ${err}`, {
        context: { queryLength: query.length },
        cause: err,
      });
    }
  }
}
