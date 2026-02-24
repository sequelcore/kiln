import { Database } from "bun:sqlite";
import type { MemoryEntry, MemoryLayer, MemorySearchResult, MemoryStore } from "./index.js";
import type { DecayConfig } from "./decay-curves.js";
import { applyDecayCurve, DEFAULT_DECAY_CONFIG } from "./decay-curves.js";
import { MemoryCompactor } from "./compactor.js";
import type { CompactionConfig, CompactionResult, CompactableStore, CompactableEntry } from "./compactor.js";
import { KilnError } from "../engine/errors.js";

export interface SqliteMemoryStoreOptions {
  readonly dbPath: string;
  readonly layer: MemoryLayer;
  readonly enableDecay?: boolean;
  readonly decay?: DecayConfig;
  readonly compaction?: CompactionConfig;
  /** When set, enforces tenant namespace isolation: saves are tagged, searches/forgets are scoped. */
  readonly tenantId?: string;
}

interface MemoryRow {
  id: string;
  content: string;
  tags: string;
  agent_role: string | null;
  project_id: string | null;
  created_at: string;
  last_accessed_at: string;
  access_count: number;
  decay_score: number;
}

interface FtsSearchRow extends MemoryRow {
  score: number;
  snippet: string;
}

export class SqliteMemoryStore implements MemoryStore {
  private readonly db: Database;
  private readonly layer: MemoryLayer;
  private readonly enableDecay: boolean;
  private readonly decayConfig: DecayConfig;
  private readonly compactor: MemoryCompactor | null;
  private readonly tenantId: string | undefined;

  constructor(options: SqliteMemoryStoreOptions) {
    this.layer = options.layer;
    this.enableDecay = options.enableDecay ?? false;
    this.decayConfig = options.decay ?? DEFAULT_DECAY_CONFIG;
    this.compactor = options.compaction ? new MemoryCompactor(options.compaction) : null;
    this.tenantId = options.tenantId;
    this.db = new Database(options.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        agent_role TEXT,
        project_id TEXT,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER DEFAULT 0,
        decay_score REAL DEFAULT 1.0
      );
    `);
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        id UNINDEXED, content, tags, tokenize='porter'
      );
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories_archive (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        agent_role TEXT,
        project_id TEXT,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        access_count INTEGER DEFAULT 0,
        decay_score REAL DEFAULT 1.0,
        archived_at TEXT NOT NULL
      );
    `);
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    let tags = [...entry.tags];
    if (this.tenantId) {
      const tenantTag = `_tenant:${this.tenantId}`;
      if (!tags.includes(tenantTag)) tags.push(tenantTag);
    }
    const tagsJson = JSON.stringify(tags);

    this.db.prepare(`
      INSERT INTO memories (id, content, tags, agent_role, project_id, created_at, last_accessed_at, access_count, decay_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1.0)
    `).run(id, entry.content, tagsJson, entry.agentRole ?? null, entry.projectId ?? null, now, now);

    this.db.prepare(`
      INSERT INTO memories_fts (id, content, tags) VALUES (?, ?, ?)
    `).run(id, entry.content, tagsJson);

    return id;
  }

  async search(
    query: string,
    _layer?: MemoryLayer,
    limit?: number,
  ): Promise<readonly MemorySearchResult[]> {
    const maxResults = limit ?? 10;

    let rows: FtsSearchRow[];
    if (this.tenantId) {
      const tenantTag = `_tenant:${this.tenantId}`;
      rows = this.db.prepare(`
        SELECT m.*, bm25(memories_fts) AS score,
               snippet(memories_fts, 1, '<b>', '</b>', '...', 32) AS snippet
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.id
        WHERE memories_fts MATCH ?
          AND m.tags LIKE ?
        ORDER BY bm25(memories_fts)
        LIMIT ?
      `).all(query, `%"${tenantTag}"%`, maxResults) as FtsSearchRow[];

      // Runtime assertion: verify each returned row has the tenant tag
      for (const row of rows) {
        const tags = JSON.parse(row.tags) as string[];
        if (!tags.includes(tenantTag)) {
          throw new KilnError("TENANT_ISOLATION_VIOLATED", `Memory entry ${row.id} lacks tenant tag for tenant ${this.tenantId}`, {
            context: { entryId: row.id, tenantId: this.tenantId },
            retryable: false,
          });
        }
      }
    } else {
      rows = this.db.prepare(`
        SELECT m.*, bm25(memories_fts) AS score,
               snippet(memories_fts, 1, '<b>', '</b>', '...', 32) AS snippet
        FROM memories_fts fts
        JOIN memories m ON m.id = fts.id
        WHERE memories_fts MATCH ?
        ORDER BY bm25(memories_fts)
        LIMIT ?
      `).all(query, maxResults) as FtsSearchRow[];
    }

    return rows.map((row) => this.toSearchResult(row));
  }

  async recall(query: string, tokenBudget: number): Promise<string> {
    const results = await this.search(query, undefined, 50);
    const parts: string[] = [];
    let tokensUsed = 0;

    for (const result of results) {
      const tokenEstimate = Math.ceil(result.entry.content.length / 4);
      if (tokensUsed + tokenEstimate > tokenBudget) break;
      parts.push(result.entry.content);
      tokensUsed += tokenEstimate;
    }

    return parts.join("\n\n");
  }

  async forget(id: string): Promise<void> {
    if (this.tenantId) {
      const row = this.db.prepare("SELECT tags FROM memories WHERE id = ?").get(id) as { tags: string } | undefined;
      if (row) {
        const tags = JSON.parse(row.tags) as string[];
        const tenantTag = `_tenant:${this.tenantId}`;
        if (!tags.includes(tenantTag)) {
          throw new KilnError("TENANT_ISOLATION_VIOLATED", `Cannot delete memory entry ${id}: tenant isolation violation`, {
            context: { entryId: id, tenantId: this.tenantId },
            retryable: false,
          });
        }
      }
    }
    this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
    this.db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  }

  reinforce(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE memories
      SET last_accessed_at = ?, access_count = access_count + 1, decay_score = 1.0
      WHERE id = ?
    `).run(now, id);
  }

  applyDecay(factor?: number): void {
    const config = this.decayConfig;
    const now = Date.now();

    if (config.curve === "step") {
      // Step decay: set score to 0 for entries older than factor days
      const rows = this.db.prepare("SELECT id, created_at FROM memories").all() as { id: string; created_at: string }[];
      for (const row of rows) {
        const ageInDays = (now - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24);
        const newScore = applyDecayCurve(1, config, ageInDays);
        this.db.prepare("UPDATE memories SET decay_score = ? WHERE id = ?").run(newScore, row.id);
      }
    } else if (config.curve === "linear") {
      const linearFactor = factor ?? config.factor;
      const rows = this.db.prepare("SELECT id, decay_score FROM memories").all() as { id: string; decay_score: number }[];
      for (const row of rows) {
        const newScore = applyDecayCurve(row.decay_score, { ...config, factor: linearFactor });
        this.db.prepare("UPDATE memories SET decay_score = ? WHERE id = ?").run(newScore, row.id);
      }
    } else {
      // Exponential (default) -- batch update for efficiency
      const decayFactor = factor ?? config.factor;
      this.db.prepare("UPDATE memories SET decay_score = decay_score * ?").run(decayFactor);
    }

    // Prune entries below threshold
    const threshold = config.pruneThreshold;
    const pruned = this.db.prepare("SELECT id FROM memories WHERE decay_score < ?").all(threshold) as { id: string }[];
    for (const row of pruned) {
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(row.id);
    }
    this.db.prepare("DELETE FROM memories WHERE decay_score < ?").run(threshold);
  }

  /** Run compaction if configured and threshold exceeded. Returns null if compaction is not configured. */
  runCompaction(): CompactionResult | null {
    if (!this.compactor) return null;
    if (!this.compactor.shouldCompact(this.asCompactable())) return null;
    return this.compactor.compact(this.asCompactable());
  }

  private asCompactable(): CompactableStore {
    const db = this.db;
    return {
      entryCount(): number {
        const row = db.prepare("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
        return row.cnt;
      },
      queryOldEntries(minAgeDays: number, limit: number): readonly CompactableEntry[] {
        const cutoff = new Date(Date.now() - minAgeDays * 24 * 60 * 60 * 1000).toISOString();
        const rows = db.prepare(`
          SELECT id, content, tags, decay_score
          FROM memories
          WHERE created_at < ?
          ORDER BY decay_score ASC
          LIMIT ?
        `).all(cutoff, limit) as { id: string; content: string; tags: string; decay_score: number }[];
        return rows.map((r) => ({
          id: r.id,
          content: r.content,
          tags: JSON.parse(r.tags) as string[],
          decayScore: r.decay_score,
        }));
      },
      saveSummary(content: string, tags: readonly string[]): string {
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const tagsJson = JSON.stringify(tags);
        db.prepare(`
          INSERT INTO memories (id, content, tags, created_at, last_accessed_at, access_count, decay_score)
          VALUES (?, ?, ?, ?, ?, 0, 1.0)
        `).run(id, content, tagsJson, now, now);
        db.prepare(`
          INSERT INTO memories_fts (id, content, tags) VALUES (?, ?, ?)
        `).run(id, content, tagsJson);
        return id;
      },
      archiveEntries(ids: readonly string[]): void {
        const now = new Date().toISOString();
        for (const id of ids) {
          db.prepare(`
            INSERT OR IGNORE INTO memories_archive
            SELECT *, ? AS archived_at FROM memories WHERE id = ?
          `).run(now, id);
          db.prepare("DELETE FROM memories_fts WHERE id = ?").run(id);
          db.prepare("DELETE FROM memories WHERE id = ?").run(id);
        }
      },
    };
  }

  listEntries(options?: { limit?: number; tags?: string }): readonly MemoryEntry[] {
    const limit = options?.limit ?? 100;
    const tagFilter = options?.tags ? options.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

    let rows: MemoryRow[];

    if (this.tenantId) {
      const tenantTag = `_tenant:${this.tenantId}`;
      rows = this.db.prepare(`
        SELECT * FROM memories
        WHERE tags LIKE ?
        ORDER BY last_accessed_at DESC
        LIMIT ?
      `).all(`%"${tenantTag}"%`, limit) as MemoryRow[];

      for (const row of rows) {
        const tags = JSON.parse(row.tags) as string[];
        if (!tags.includes(tenantTag)) {
          throw new KilnError("TENANT_ISOLATION_VIOLATED", `Memory entry ${row.id} lacks tenant tag for tenant ${this.tenantId}`, {
            context: { entryId: row.id, tenantId: this.tenantId },
            retryable: false,
          });
        }
      }
    } else {
      rows = this.db.prepare(`
        SELECT * FROM memories
        ORDER BY last_accessed_at DESC
        LIMIT ?
      `).all(limit) as MemoryRow[];
    }

    if (tagFilter.length > 0) {
      rows = rows.filter((row) => {
        const rowTags = JSON.parse(row.tags) as string[];
        return tagFilter.every((t) => rowTags.includes(t));
      });
    }

    return rows.map((row) => this.toEntry(row));
  }

  hasEntry(id: string): boolean {
    const row = this.db.prepare("SELECT 1 FROM memories WHERE id = ?").get(id) as { 1: number } | undefined;
    return row !== undefined;
  }

  close(): void {
    this.db.close();
  }

  get count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS cnt FROM memories").get() as { cnt: number };
    return row.cnt;
  }

  private toSearchResult(row: FtsSearchRow): MemorySearchResult {
    const score = this.enableDecay ? Math.abs(row.score) * row.decay_score : Math.abs(row.score);
    return {
      entry: this.toEntry(row),
      score,
      snippet: row.snippet,
    };
  }

  private toEntry(row: MemoryRow): MemoryEntry {
    return {
      id: row.id,
      layer: this.layer,
      content: row.content,
      tags: JSON.parse(row.tags) as string[],
      createdAt: new Date(row.created_at),
      lastAccessedAt: new Date(row.last_accessed_at),
      accessCount: row.access_count,
      agentRole: row.agent_role as MemoryEntry["agentRole"],
      projectId: row.project_id ?? undefined,
    };
  }
}
