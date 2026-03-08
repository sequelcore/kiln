import type {
  EnrichmentStore,
  ConversationEnrichment,
} from "@kilnai/core";
import { Database } from "bun:sqlite";

export class SqliteEnrichmentStore implements EnrichmentStore {
  private readonly db: Database;

  constructor(dbPath: string = ":memory:") {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode=WAL;");
    this.db.exec("PRAGMA busy_timeout=5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_enrichments (
        session_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        enrichment_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_enrichments_tenant_created
      ON conversation_enrichments (tenant_id, created_at);
    `);
  }

  async save(enrichment: ConversationEnrichment): Promise<void> {
    this.db
      .prepare(
        "INSERT OR REPLACE INTO conversation_enrichments (session_id, tenant_id, enrichment_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        enrichment.sessionId,
        enrichment.tenantId,
        JSON.stringify(enrichment),
        enrichment.enrichedAt,
      );
  }

  async get(
    sessionId: string,
  ): Promise<ConversationEnrichment | undefined> {
    const row = this.db
      .prepare(
        "SELECT enrichment_json FROM conversation_enrichments WHERE session_id = ?",
      )
      .get(sessionId) as { enrichment_json: string } | null;
    if (!row) return undefined;
    return JSON.parse(row.enrichment_json) as ConversationEnrichment;
  }

  async listByTenant(
    tenantId: string,
    limit = 50,
    cursor?: string,
  ): Promise<{
    readonly enrichments: readonly ConversationEnrichment[];
    readonly nextCursor?: string;
  }> {
    let rows: { enrichment_json: string }[];
    if (cursor) {
      rows = this.db
        .prepare(
          "SELECT enrichment_json FROM conversation_enrichments WHERE tenant_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(tenantId, cursor, limit + 1) as { enrichment_json: string }[];
    } else {
      rows = this.db
        .prepare(
          "SELECT enrichment_json FROM conversation_enrichments WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(tenantId, limit + 1) as { enrichment_json: string }[];
    }

    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const enrichments = trimmed.map(
      (r) => JSON.parse(r.enrichment_json) as ConversationEnrichment,
    );
    const nextCursor = hasMore
      ? enrichments[enrichments.length - 1]?.enrichedAt
      : undefined;

    return { enrichments, nextCursor };
  }

  async delete(sessionId: string): Promise<boolean> {
    const existing = this.db
      .prepare(
        "SELECT 1 FROM conversation_enrichments WHERE session_id = ?",
      )
      .get(sessionId);
    if (!existing) return false;
    this.db
      .prepare(
        "DELETE FROM conversation_enrichments WHERE session_id = ?",
      )
      .run(sessionId);
    return true;
  }

  close(): void {
    this.db.close();
  }
}
