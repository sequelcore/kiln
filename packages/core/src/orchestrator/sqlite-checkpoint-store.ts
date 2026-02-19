import { Database } from "bun:sqlite";
import type { Checkpoint, CheckpointOptions } from "./checkpoint-types.js";
import type { CheckpointStore } from "./checkpoint-store.js";
import type { OrchestratorStatus } from "./index.js";
import type { TaskNode, TreeConfig } from "../tree/index.js";
import type { KilnEvent } from "../events/index.js";
import type { CostSummary } from "../cost/index.js";

interface CheckpointRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  phase: string;
  phase_index: number;
  status: string;
  task: string;
  tree_data: string;
  event_history: string;
  cost_summary: string;
  created_at: string;
  metadata: string | null;
}

export class SqliteCheckpointStore implements CheckpointStore {
  private readonly db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        phase TEXT NOT NULL,
        phase_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        task TEXT NOT NULL,
        tree_data TEXT NOT NULL,
        event_history TEXT NOT NULL,
        cost_summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        metadata TEXT
      );
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session_id ON checkpoints(session_id);
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_checkpoints_parent_id ON checkpoints(parent_id);
    `);
  }

  async save(checkpoint: Checkpoint, options?: CheckpointOptions): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO checkpoints (
        id, session_id, parent_id, phase, phase_index, status, task,
        tree_data, event_history, cost_summary, created_at, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      checkpoint.id,
      checkpoint.sessionId,
      checkpoint.parentId,
      checkpoint.phase,
      checkpoint.phaseIndex,
      checkpoint.status,
      checkpoint.task,
      JSON.stringify(checkpoint.tree),
      JSON.stringify(checkpoint.eventHistory),
      JSON.stringify(checkpoint.costSummary),
      checkpoint.timestamp.toISOString(),
      options?.metadata ? JSON.stringify(options.metadata) : null,
    );
  }

  async load(id: string): Promise<Checkpoint | null> {
    const stmt = this.db.prepare("SELECT * FROM checkpoints WHERE id = ?");
    const row = stmt.get(id) as CheckpointRow | undefined;

    if (!row) return null;

    return this.rowToCheckpoint(row);
  }

  async listBySession(sessionId: string): Promise<readonly Checkpoint[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at ASC",
    );
    const rows = stmt.all(sessionId) as CheckpointRow[];

    return rows.map((row) => this.rowToCheckpoint(row));
  }

  async listChildren(parentId: string): Promise<readonly Checkpoint[]> {
    const stmt = this.db.prepare(
      "SELECT * FROM checkpoints WHERE parent_id = ? ORDER BY created_at ASC",
    );
    const rows = stmt.all(parentId) as CheckpointRow[];

    return rows.map((row) => this.rowToCheckpoint(row));
  }

  async delete(id: string): Promise<void> {
    const children = await this.listChildren(id);
    for (const child of children) {
      await this.delete(child.id);
    }

    const stmt = this.db.prepare("DELETE FROM checkpoints WHERE id = ?");
    stmt.run(id);
  }

  close(): void {
    this.db.close();
  }

  private rowToCheckpoint(row: CheckpointRow): Checkpoint {
    return {
      id: row.id,
      sessionId: row.session_id,
      parentId: row.parent_id,
      phase: row.phase,
      phaseIndex: row.phase_index,
      status: row.status as OrchestratorStatus,
      task: row.task,
      tree: JSON.parse(row.tree_data) as { nodes: TaskNode[]; config: TreeConfig },
      eventHistory: JSON.parse(row.event_history) as KilnEvent[],
      costSummary: JSON.parse(row.cost_summary) as CostSummary,
      timestamp: new Date(row.created_at),
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    };
  }
}
