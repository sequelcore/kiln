// Knowledge capability auto-injection -- creates the knowledge_search capability

import type { Capability } from "../engine/domain/capability.js";
import type { RetrievalPipeline } from "./retrieval-pipeline.js";

export function createKnowledgeCapability(): Capability {
  return {
    name: "knowledge_search",
    description: "Search the knowledge base for relevant information. Returns chunks ranked by relevance.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query" },
        source: { type: "string", description: "Optional: restrict to a specific knowledge source by name" },
        topK: { type: "number", description: "Optional: max results to return (default: 5)" },
      },
      required: ["query"],
    },
    tags: ["knowledge", "search", "rag"],
    annotations: {
      readOnly: true,
      idempotent: true,
      cacheTtl: 60,
    },
  };
}

export async function executeKnowledgeSearch(
  pipeline: RetrievalPipeline,
  input: { query: string; source?: string; topK?: number },
): Promise<{ results: { content: string; score: number; metadata: Record<string, unknown> }[] }> {
  const results = await pipeline.retrieve(input.query, {
    topK: input.topK ?? 5,
    source: input.source,
  });
  return {
    results: results.map((r) => ({
      content: r.content,
      score: r.score,
      metadata: r.metadata,
    })),
  };
}