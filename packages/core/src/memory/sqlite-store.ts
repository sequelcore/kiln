import { Database } from "bun:sqlite";
import type { MemoryEntry, MemoryLayer, MemorySearchResult, MemoryStore } from "./index.js";

export interface SqliteMemoryStoreOptions {
  readonly dbPath: string;
  readonly layer: MemoryLayer;
  readonly enableDecay?: boolean;
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

  constructor(options: SqliteMemoryStoreOptions) {
    this.layer = options.layer;
    this.enableDecay = options.enableDecay ?? false;
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
  }

  async save(
    entry: Omit<MemoryEntry, "id" | "createdAt" | "lastAccessedAt" | "accessCount">,
  ): Promise<string> {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const tagsJson = JSON.stringify(entry.tags);

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

    const rows = this.db.prepare(`
      SELECT m.*, bm25(memories_fts) AS score,
             snippet(memories_fts, 1, '<b>', '</b>', '...', 32) AS snippet
      FROM memories_fts fts
      JOIN memories m ON m.id = fts.id
      WHERE memories_fts MATCH ?
      ORDER BY bm25(memories_fts)
      LIMIT ?
    `).all(query, maxResults) as FtsSearchRow[];

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
    const decayFactor = factor ?? 0.95;
    this.db.prepare("UPDATE memories SET decay_score = decay_score * ?").run(decayFactor);

    const pruned = this.db.prepare("SELECT id FROM memories WHERE decay_score < 0.01").all() as { id: string }[];
    for (const row of pruned) {
      this.db.prepare("DELETE FROM memories_fts WHERE id = ?").run(row.id);
    }
    this.db.prepare("DELETE FROM memories WHERE decay_score < 0.01").run();
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
