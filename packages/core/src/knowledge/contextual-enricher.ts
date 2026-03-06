// Contextual retrieval enrichment -- Anthropic pattern
// Prepends document-level context to each chunk before embedding via LLM

import type { Document, Chunk, ChunkEnricher } from "../engine/domain/chunker.js";
import type { ProviderAdapter } from "../agents/index.js";
import { textParts, extractText } from "../engine/domain/content.js";
import { withRetry } from "../agents/infrastructure/retry.js";
import { KilnError } from "../engine/errors.js";

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_DOCUMENT_CHARS = 100_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const ENRICHMENT_MAX_TOKENS = 200;

const ENRICHMENT_PROMPT_TEMPLATE = `Here is a chunk from the document:
<chunk>
{chunk}
</chunk>

Give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. Answer only with the succinct context and nothing else.`;

export interface ContextualEnricherConfig {
  readonly provider: ProviderAdapter;
  readonly concurrency?: number;
  readonly maxDocumentChars?: number;
}

export class ContextualEnricher implements ChunkEnricher {
  private readonly provider: ProviderAdapter;
  private readonly concurrency: number;
  private readonly maxDocumentChars: number;

  constructor(config: ContextualEnricherConfig) {
    this.provider = config.provider;
    this.concurrency = config.concurrency ?? DEFAULT_CONCURRENCY;
    this.maxDocumentChars = config.maxDocumentChars ?? DEFAULT_MAX_DOCUMENT_CHARS;
  }

  async enrich(document: Document, chunks: Chunk[]): Promise<Chunk[]> {
    if (chunks.length === 0) return [];

    const docContent = document.content.length > this.maxDocumentChars
      ? document.content.slice(0, this.maxDocumentChars)
      : document.content;

    const results: Chunk[] = new Array(chunks.length);
    let cursor = 0;

    const processChunk = async (index: number): Promise<void> => {
      const chunk = chunks[index]!;
      try {
        const context = await this.generateContext(docContent, chunk.content);
        results[index] = {
          ...chunk,
          content: `<context>\n${context}\n</context>\n${chunk.content}`,
        };
      } catch {
        // Fail-open: return original chunk unchanged
        results[index] = chunk;
      }
    };

    // Simple semaphore-based concurrency control
    const tasks: Promise<void>[] = [];
    while (cursor < chunks.length) {
      const batch = Math.min(this.concurrency, chunks.length - cursor);
      const batchTasks: Promise<void>[] = [];
      for (let i = 0; i < batch; i++) {
        batchTasks.push(processChunk(cursor + i));
      }
      tasks.push(...batchTasks);
      await Promise.all(batchTasks);
      cursor += batch;
    }

    return results;
  }

  private async generateContext(documentContent: string, chunkContent: string): Promise<string> {
    const userPrompt = ENRICHMENT_PROMPT_TEMPLATE.replace("{chunk}", chunkContent);

    const response = await withRetry(
      () =>
        this.provider.createMessage({
          system: documentContent,
          messages: [{ role: "user", parts: textParts(userPrompt) }],
          maxTokens: ENRICHMENT_MAX_TOKENS,
        }),
      {
        maxRetries: MAX_RETRIES,
        baseDelayMs: BASE_DELAY_MS,
        isRetryable: (error: unknown) => {
          if (error instanceof KilnError) return error.retryable;
          if (error instanceof Error && "status" in error) {
            const status = (error as { status: number }).status;
            return status === 429 || status >= 500;
          }
          return false;
        },
      },
    );

    return extractText(response.parts).trim();
  }
}
