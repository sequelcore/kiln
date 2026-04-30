import { KilnError } from "../engine/errors.js";
import { applyDecayCurve, DEFAULT_DECAY_CONFIG, shouldPrune } from "./decay-curves.js";
import type { MemoryEntry, MemoryLayer, MemorySearchResult, MemoryStore } from "./index.js";
import {
  SqliteMemoryRepository,
  type CreateMemoryRecordInput,
  type MemoryRecord,
  type MemoryRecordQuery,
  type MemoryRepository,
} from "./index.js";

const CHARS_PER_TOKEN_ESTIMATE = 4;
const DEFAULT_SCOPE_ID = "default";

export interface SqliteMemoryStoreOptions {
  readonly dbPath: string;
  readonly layer: MemoryLayer;
  readonly tenantId?: string;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly repository: MemoryRepository;
  private readonly layer: MemoryLayer;
  private readonly tenantId: string | undefined;
  private readonly decayScores = new Map<string, number>();
  private readonly accessCounts = new Map<string, number>();
  private readonly revisionCounts = new Map<string, number>();

  constructor(options: SqliteMemoryStoreOptions) {
    if (options.tenantId && /[%_]/.test(options.tenantId)) {
      throw new Error("tenantId must not contain SQL wildcard characters (% or _)");
    }

    this.repository = new SqliteMemoryRepository({ dbPath: options.dbPath });
    this.layer = options.layer;
    this.tenantId = options.tenantId;
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount" | "revisionCount" | "lastSeenAt">,
  ): Promise<string> {
    const existing = entry.topicKey
      ? this.findByTopicKey(entry.topicKey)
      : undefined;
    const id = existing?.id;

    const record = this.repository.saveRecord(this.toCreateRecordInput(entry, id));
    const revisionCount = (existing ? this.revisionCounts.get(existing.id) ?? existing.revisionCount ?? 1 : 0) + 1;
    this.revisionCounts.set(record.id, revisionCount);
    this.decayScores.set(record.id, 1);
    this.accessCounts.set(record.id, this.accessCounts.get(record.id) ?? 0);
    return record.id;
  }

  async search(query: string, limit?: number): Promise<readonly MemorySearchResult[]> {
    const maxResults = limit ?? 10;
    if (query.includes("/")) {
      const entry = this.findByTopicKey(query);
      return entry ? [{ entry, score: 1000, snippet: "" }].slice(0, maxResults) : [];
    }

    const results = this.repository.searchRecords({
      query,
      scope: this.scopeForStore(),
      limit: maxResults,
    });
    return results.map((result) => ({
      entry: this.toEntry(result.record),
      score: Math.abs(result.score ?? 0) * (this.decayScores.get(result.record.id) ?? 1),
      snippet: result.snippet,
    }));
  }

  async recall(query: string, tokenBudget: number): Promise<string> {
    const results = await this.search(query, 50);
    const parts: string[] = [];
    let tokensUsed = 0;

    for (const result of results) {
      const tokenEstimate = Math.ceil(result.entry.content.length / CHARS_PER_TOKEN_ESTIMATE);
      if (tokensUsed + tokenEstimate > tokenBudget) break;
      parts.push(result.entry.content);
      tokensUsed += tokenEstimate;
    }

    return parts.join("\n\n");
  }

  async forget(id: string): Promise<void> {
    const entry = this.repository.getRecord(id);
    if (!entry) return;
    if (!this.isOwnScope(entry.scope)) {
      throw new KilnError("TENANT_ISOLATION_VIOLATED", `Cannot delete memory entry ${id}: scope isolation violation`, {
        context: { entryId: id },
        retryable: false,
      });
    }
    this.repository.deleteRecord(id, entry.scope);
    this.decayScores.delete(id);
    this.accessCounts.delete(id);
    this.revisionCounts.delete(id);
  }

  reinforce(id: string): void {
    this.accessCounts.set(id, (this.accessCounts.get(id) ?? 0) + 1);
    this.decayScores.set(id, 1);
  }

  applyDecay(factor?: number): void {
    const entries = this.listEntries({ limit: 500 });
    for (const entry of entries) {
      const nextScore = applyDecayCurve(
        this.decayScores.get(entry.id) ?? 1,
        { ...DEFAULT_DECAY_CONFIG, factor: factor ?? DEFAULT_DECAY_CONFIG.factor },
      );
      if (shouldPrune(nextScore, DEFAULT_DECAY_CONFIG.pruneThreshold)) {
        this.repository.deleteRecord(entry.id, this.scopeForStore());
        this.decayScores.delete(entry.id);
        this.accessCounts.delete(entry.id);
        this.revisionCounts.delete(entry.id);
      } else {
        this.decayScores.set(entry.id, nextScore);
      }
    }
  }

  listEntries(options: { limit?: number; tags?: string } = {}): readonly MemoryEntry[] {
    const tags = options.tags?.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
    const query: MemoryRecordQuery = {
      scope: this.scopeForStore(),
      tags,
      limit: Math.min(options.limit ?? 100, 500),
    };
    const records = this.repository.listRecords(query);
    return records.map((record) => this.toEntry(record));
  }

  hasEntry(id: string): boolean {
    const record = this.repository.getRecord(id);
    return record !== undefined && this.isOwnScope(record.scope);
  }

  close(): void {
    this.repository.close();
  }

  get count(): number {
    return this.repository.countRecords(this.scopeForStore());
  }

  private toCreateRecordInput(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount" | "revisionCount" | "lastSeenAt">,
    id?: string,
  ): CreateMemoryRecordInput {
    const tags = [...entry.tags];
    if (this.tenantId) {
      tags.push(`_tenant:${this.tenantId}`);
    }
    return {
      id,
      layer: this.layer === "agent" ? "procedural" : "semantic",
      scope: this.scopeForStore(),
      content: entry.content,
      tags,
      topicKey: entry.topicKey,
      provenance: {
        sourceType: "operator",
        sourceId: this.tenantId ?? this.layer,
        capturedAt: new Date().toISOString(),
      },
    };
  }

  private toEntry(record: MemoryRecord): MemoryEntry {
    return {
      id: record.id,
      layer: this.layer,
      content: record.content,
      tags: record.tags,
      topicKey: record.topicKey,
      revisionCount: this.revisionCounts.get(record.id) ?? 1,
      lastSeenAt: new Date(record.updatedAt ?? record.createdAt),
      createdAt: new Date(record.createdAt),
      lastAccessedAt: new Date(record.updatedAt ?? record.createdAt),
      accessCount: this.accessCounts.get(record.id) ?? 0,
    };
  }

  private findByTopicKey(topicKey: string): MemoryEntry | undefined {
    const record = this.repository.getRecordByTopicKey(this.scopeForStore(), topicKey);
    return record ? this.toEntry(record) : undefined;
  }

  private scopeForStore() {
    if (this.tenantId) {
      return { kind: "tenant" as const, id: this.tenantId };
    }
    if (this.layer === "project") {
      return { kind: "project" as const, id: DEFAULT_SCOPE_ID };
    }
    if (this.layer === "agent") {
      return { kind: "agent" as const, id: DEFAULT_SCOPE_ID };
    }
    return { kind: "user" as const, id: DEFAULT_SCOPE_ID };
  }

  private isOwnScope(scope: { readonly kind: string; readonly id: string }): boolean {
    const expected = this.scopeForStore();
    return scope.kind === expected.kind && scope.id === expected.id;
  }
}
