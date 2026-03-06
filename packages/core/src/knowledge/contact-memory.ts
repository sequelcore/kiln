// Contact memory: per-user fact storage across conversations
// Extracts structured facts via LLM (Mem0 ADD/UPDATE/DELETE/NOOP pattern)
// Stores facts as vector entries with metadata for recall via similarity search

import type { VectorStore, VectorResult } from "../engine/domain/vector-store.js";
import type { EmbeddingAdapter } from "../engine/domain/embedding.js";
import type { ProviderAdapter } from "../agents/index.js";
import type { ContactFact, ExtractedFact, ContactMemoryService, FactCategory, FactAction } from "../engine/domain/contact-memory.js";
import { textParts, extractText } from "../engine/domain/content.js";
import { withRetry } from "../agents/infrastructure/retry.js";
import { KilnError } from "../engine/errors.js";

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const EXTRACTION_MAX_TOKENS = 2048;
const DEFAULT_RECALL_LIMIT = 20;
const CONTACT_FACT_TYPE = "contact_fact";

const EXTRACTION_SYSTEM_PROMPT = `You extract facts about the customer from conversations.

For each fact, output a JSON array of objects:
[{"action": "ADD", "content": "...", "category": "preference"|"entity"|"issue"|"general", "confidence": 0.0-1.0}]

Rules:
- Only extract facts about the CUSTOMER, not the agent
- ADD: new fact not previously known
- UPDATE: correction or update to a previously known fact (include "existingFactId" if provided in existing facts)
- DELETE: fact no longer true (include "existingFactId" if provided in existing facts)
- NOOP: fact already known and unchanged
- High confidence (0.7-1.0) for explicit statements, lower (0.3-0.6) for inferences
- No trivial or obvious facts
- Output ONLY the JSON array, nothing else`;

export interface ContactMemoryServiceConfig {
  readonly vectorStore: VectorStore;
  readonly embedder: EmbeddingAdapter;
  readonly provider: ProviderAdapter;
}

const VALID_ACTIONS = new Set<FactAction>(["ADD", "UPDATE", "DELETE", "NOOP"]);
const VALID_CATEGORIES = new Set<FactCategory>(["preference", "entity", "issue", "general"]);

function isValidExtractedFact(f: unknown): f is ExtractedFact {
  if (typeof f !== "object" || f === null) return false;
  const obj = f as Record<string, unknown>;
  return (
    typeof obj.action === "string" &&
    VALID_ACTIONS.has(obj.action as FactAction) &&
    typeof obj.content === "string" &&
    obj.content.length > 0 &&
    typeof obj.category === "string" &&
    VALID_CATEGORIES.has(obj.category as FactCategory) &&
    typeof obj.confidence === "number" &&
    obj.confidence >= 0 &&
    obj.confidence <= 1
  );
}

function vectorResultToContactFact(result: VectorResult): ContactFact | null {
  const m = result.metadata;
  if (m.type !== CONTACT_FACT_TYPE) return null;
  return {
    id: result.id,
    externalUserId: String(m.externalUserId ?? ""),
    tenantId: String(m.tenantId ?? ""),
    content: result.content,
    category: (m.category as FactCategory) ?? "general",
    confidence: typeof m.confidence === "number" ? m.confidence : 0,
    validAt: String(m.validAt ?? ""),
    expiredAt: m.expiredAt ? String(m.expiredAt) : undefined,
    createdAt: String(m.createdAt ?? ""),
  };
}

export class ContactMemoryServiceImpl implements ContactMemoryService {
  private readonly vectorStore: VectorStore;
  private readonly embedder: EmbeddingAdapter;
  private readonly provider: ProviderAdapter;

  constructor(config: ContactMemoryServiceConfig) {
    this.vectorStore = config.vectorStore;
    this.embedder = config.embedder;
    this.provider = config.provider;
  }

  async extractAndStore(
    conversationHistory: string,
    externalUserId: string,
    tenantId: string,
  ): Promise<readonly ContactFact[]> {
    if (!conversationHistory.trim()) return [];

    // Recall existing facts to provide context for UPDATE/DELETE
    const existingFacts = await this.recall(externalUserId, tenantId);
    let userMessage = `Conversation:\n${conversationHistory}`;
    if (existingFacts.length > 0) {
      const existingContext = existingFacts
        .map((f) => `[id:${f.id}] ${f.content} (${f.category})`)
        .join("\n");
      userMessage = `Existing facts about this customer:\n${existingContext}\n\n${userMessage}`;
    }

    // LLM extraction -- fail-open
    let extractedFacts: ExtractedFact[];
    try {
      const response = await withRetry(
        () =>
          this.provider.createMessage({
            system: EXTRACTION_SYSTEM_PROMPT,
            messages: [{ role: "user", parts: textParts(userMessage) }],
            maxTokens: EXTRACTION_MAX_TOKENS,
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

      const responseText = extractText(response.parts).trim();
      const parsed = JSON.parse(responseText);
      if (!Array.isArray(parsed)) return [];
      extractedFacts = parsed.filter(isValidExtractedFact);
    } catch {
      // Fail-open: extraction errors are non-fatal
      return [];
    }

    if (extractedFacts.length === 0) return [];

    const now = new Date().toISOString();
    const storedFacts: ContactFact[] = [];

    for (const fact of extractedFacts) {
      switch (fact.action) {
        case "ADD": {
          const contactFact = await this.addFact(fact, externalUserId, tenantId, now);
          storedFacts.push(contactFact);
          break;
        }
        case "UPDATE": {
          // Expire old fact, then add new version
          if (fact.existingFactId) {
            await this.expireFact(fact.existingFactId);
          } else {
            await this.expireByContent(fact.content, externalUserId, tenantId);
          }
          const updated = await this.addFact(fact, externalUserId, tenantId, now);
          storedFacts.push(updated);
          break;
        }
        case "DELETE": {
          if (fact.existingFactId) {
            await this.expireFact(fact.existingFactId);
          } else {
            await this.expireByContent(fact.content, externalUserId, tenantId);
          }
          break;
        }
        // NOOP: skip
      }
    }

    return storedFacts;
  }

  async recall(
    externalUserId: string,
    tenantId: string,
    options?: { query?: string; limit?: number },
  ): Promise<readonly ContactFact[]> {
    const limit = options?.limit ?? DEFAULT_RECALL_LIMIT;

    // If query is provided, use vector similarity to rank results
    const queryText = options?.query ?? `facts about user ${externalUserId}`;
    const [embedding] = await this.embedder.embed([queryText]);
    if (!embedding) return [];

    const results = await this.vectorStore.query(embedding, {
      topK: limit * 2, // Fetch extra to filter expired
      filter: { externalUserId, tenantId, type: CONTACT_FACT_TYPE },
    });

    // Filter out expired facts and convert to ContactFact
    const facts: ContactFact[] = [];
    for (const result of results) {
      if (result.metadata.expiredAt) continue;
      const fact = vectorResultToContactFact(result);
      if (fact) facts.push(fact);
      if (facts.length >= limit) break;
    }

    return facts;
  }

  // tenantId reserved for future per-tenant isolation at the store level
  async forget(factId: string, _tenantId: string): Promise<void> {
    await this.vectorStore.delete([factId]);
  }

  async forgetAll(externalUserId: string, tenantId: string): Promise<void> {
    await this.vectorStore.deleteByMetadata({
      externalUserId,
      tenantId,
      type: CONTACT_FACT_TYPE,
    });
  }

  private async addFact(
    fact: ExtractedFact,
    externalUserId: string,
    tenantId: string,
    now: string,
  ): Promise<ContactFact> {
    const id = crypto.randomUUID();
    const [embedding] = await this.embedder.embed([fact.content]);
    if (!embedding) {
      throw new KilnError("CONTACT_MEMORY_EXTRACTION_FAILED", "Failed to embed fact content", {
        context: { content: fact.content },
      });
    }

    await this.vectorStore.upsert([
      {
        id,
        content: fact.content,
        embedding,
        metadata: {
          externalUserId,
          tenantId,
          category: fact.category,
          confidence: fact.confidence,
          validAt: now,
          createdAt: now,
          type: CONTACT_FACT_TYPE,
        },
      },
    ]);

    return {
      id,
      externalUserId,
      tenantId,
      content: fact.content,
      category: fact.category,
      confidence: fact.confidence,
      validAt: now,
      createdAt: now,
    };
  }

  private async expireFact(factId: string): Promise<void> {
    // VectorStore doesn't have a get-by-id + update metadata flow,
    // so we delete the entry. The fact is logically expired (removed from active queries).
    await this.vectorStore.delete([factId]);
  }

  private async expireByContent(
    content: string,
    externalUserId: string,
    tenantId: string,
  ): Promise<void> {
    const [embedding] = await this.embedder.embed([content]);
    if (!embedding) return;

    const results = await this.vectorStore.query(embedding, {
      topK: 1,
      minScore: 0.8,
      filter: { externalUserId, tenantId, type: CONTACT_FACT_TYPE },
    });

    if (results.length > 0 && !results[0]!.metadata.expiredAt) {
      await this.vectorStore.delete([results[0]!.id]);
    }
  }
}
