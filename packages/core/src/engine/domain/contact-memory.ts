// Engine domain: Contact Memory -- per-user fact storage across conversations
// Facts extracted via LLM after session expiry, recalled at next conversation start

export type FactCategory = "preference" | "entity" | "issue" | "general";
export type FactAction = "ADD" | "UPDATE" | "DELETE" | "NOOP";

export interface ContactFact {
  readonly id: string;
  readonly externalUserId: string;
  readonly tenantId: string;
  readonly content: string;
  readonly category: FactCategory;
  readonly confidence: number; // 0.0 - 1.0
  readonly validAt: string; // ISO 8601
  readonly expiredAt?: string; // NULL = still valid
  readonly createdAt: string;
}

export interface ExtractedFact {
  readonly action: FactAction;
  readonly content: string;
  readonly category: FactCategory;
  readonly confidence: number;
  readonly existingFactId?: string; // For UPDATE/DELETE
}

export interface ContactMemoryService {
  extractAndStore(
    conversationHistory: string,
    externalUserId: string,
    tenantId: string,
  ): Promise<readonly ContactFact[]>;

  recall(
    externalUserId: string,
    tenantId: string,
    options?: { query?: string; limit?: number },
  ): Promise<readonly ContactFact[]>;

  forget(factId: string, tenantId: string): Promise<void>;
  forgetAll(externalUserId: string, tenantId: string): Promise<void>;
}
