// ToolRAG: embeds tool descriptions and retrieves top-K relevant tools per query

import type { Capability } from "../engine/domain/capability.js";
import type { EmbeddingAdapter } from "../engine/domain/embedding.js";
import type { VectorStore, VectorEntry } from "../engine/domain/vector-store.js";
import type { ToolSelectionConfig } from "../engine/domain/tool-selection-config.js";
import { KilnError } from "../engine/errors.js";

export class ToolRAG {
  private readonly embedder: EmbeddingAdapter;
  private readonly store: VectorStore;
  private readonly config: Required<ToolSelectionConfig>;
  private toolNameToCapability = new Map<string, Capability>();
  private ingested = false;

  constructor(embedder: EmbeddingAdapter, store: VectorStore, config: ToolSelectionConfig) {
    this.embedder = embedder;
    this.store = store;
    this.config = {
      strategy: config.strategy,
      maxTools: config.maxTools ?? 15,
      threshold: config.threshold ?? 30,
    };
  }

  async ingestTools(tools: readonly Capability[]): Promise<void> {
    if (tools.length === 0) {
      this.ingested = true;
      return;
    }

    const texts: string[] = [];
    const entries: VectorEntry[] = [];

    for (const tool of tools) {
      const text = `${tool.name}: ${tool.description}`;
      texts.push(text);
      this.toolNameToCapability.set(tool.name, tool);
    }

    try {
      const embeddings = await this.embedder.embed(texts);

      for (let i = 0; i < tools.length; i++) {
        const tool = tools[i]!;
        const embedding = embeddings[i];
        if (!embedding) continue;
        entries.push({
          id: `tool:${tool.name}`,
          content: texts[i]!,
          embedding,
          metadata: { toolName: tool.name },
        });
      }

      await this.store.upsert(entries);
      this.ingested = true;
    } catch (err) {
      throw new KilnError("TOOL_RAG_FAILED", `Failed to ingest tools: ${err}`, {
        context: { toolCount: tools.length },
        cause: err,
      });
    }
  }

  async selectTools(query: string, allTools: readonly Capability[]): Promise<readonly Capability[]> {
    if (allTools.length <= this.config.threshold) {
      return allTools;
    }

    if (!this.ingested) {
      return allTools.slice(0, this.config.maxTools);
    }

    try {
      const embeddings = await this.embedder.embed([query]);
      const queryEmbedding = embeddings[0];
      if (!queryEmbedding) {
        return allTools.slice(0, this.config.maxTools);
      }

      const results = await this.store.query(queryEmbedding, {
        topK: this.config.maxTools,
      });

      const selectedTools: Capability[] = [];
      for (const result of results) {
        const toolName = result.metadata.toolName as string | undefined;
        if (toolName) {
          const tool = this.toolNameToCapability.get(toolName);
          if (tool) {
            selectedTools.push(tool);
          }
        }
      }

      return selectedTools;
    } catch (err) {
      throw new KilnError("TOOL_RAG_FAILED", `Failed to select tools: ${err}`, {
        context: { queryLength: query.length },
        cause: err,
      });
    }
  }
}
