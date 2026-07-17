import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import {
  createMemoryRelation,
  defineMemoryScope,
  isMemoryLayerKind,
  MEMORY_PROVENANCE_SOURCE_TYPES,
  validateMemoryRevisionLineage,
  type MemoryContextAdmission,
  type MemoryProvenance,
  type MemoryRecord,
  type MemoryRelation,
  type MemoryRelationDraft,
  type MemoryRelationTarget,
  type MemoryRevision,
  type MemoryScope,
} from "./domain/index.js";
import type {
  CreateMemoryRecordInput,
  MemoryRecordQuery,
  MemoryRecordSearchResult,
  MemoryRepository,
} from "./repository.js";

const DEFAULT_LIMIT = 50;
const MAX_RECORD_LIMIT = 500;
const MAX_REVISION_LIMIT = 501;
const MAX_RELATION_LIMIT = 1_001;
const MAX_ADMISSION_LIMIT = 501;

type SqlBinding = string | number | null;

export interface SqliteMemoryRepositoryOptions {
  readonly dbPath: string;
}

interface MemoryRecordRow {
  readonly id: string;
  readonly layer: string;
  readonly scope_kind: string;
  readonly scope_id: string;
  readonly content: string;
  readonly topic_key: string | null;
  readonly tags: string;
  readonly provenance: string;
  readonly confidence: number | null;
  readonly created_at: string;
  readonly updated_at: string | null;
}

interface MemorySearchRow extends MemoryRecordRow {
  readonly score: number;
  readonly snippet: string;
}

interface MemoryRevisionRow {
  readonly id: string;
  readonly record_id: string;
  readonly parent_revision_id: string | null;
  readonly sequence: number;
  readonly kind: MemoryRevision["kind"];
  readonly content: string;
  readonly provenance: string;
  readonly reason: string | null;
  readonly created_at: string;
}

interface MemoryRelationRow {
  readonly id: string;
  readonly source_record_id: string;
  readonly target_kind: MemoryRelationTarget["kind"];
  readonly target_record_id: string | null;
  readonly target_uri: string | null;
  readonly relation_type: MemoryRelation["type"];
  readonly reason: string | null;
  readonly evidence: string;
  readonly confidence: number | null;
  readonly created_at: string;
}

interface MemoryContextAdmissionRow {
  readonly id: string;
  readonly record_id: string;
  readonly session_id: string | null;
  readonly turn_id: string | null;
  readonly decision: MemoryContextAdmission["decision"];
  readonly reason: string;
  readonly estimated_tokens: number;
  readonly base_score: number;
  readonly effective_score: number;
  readonly created_at: string;
}

interface SqliteIndexRow {
  readonly name: string;
  readonly unique: number;
}

interface SqliteIndexInfoRow {
  readonly seqno: number;
  readonly name: string;
}

export class SqliteMemoryRepository implements MemoryRepository {
  private readonly db: Database;
  private inTransaction = false;

  constructor(options: SqliteMemoryRepositoryOptions) {
    this.db = new Database(options.dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.initSchema();
  }

  transaction<T>(work: () => T): T {
    return this.runTransaction(work);
  }

  saveRecord(input: CreateMemoryRecordInput): MemoryRecord {
    const now = new Date().toISOString();
    const record = this.normalizeRecord(input, now);
    const provenanceJson = JSON.stringify(record.provenance);
    const tagsJson = JSON.stringify(record.tags);
    const stored = this.db.prepare("SELECT id FROM memory_records WHERE id = ?").get(record.id) as { id: string } | undefined;

    this.runTransaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO memory_sources (
          source_type,
          source_id,
          session_id,
          turn_id,
          tool_call_id,
          actor,
          captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.provenance.sourceType,
        record.provenance.sourceId,
        record.provenance.sessionId ?? null,
        record.provenance.turnId ?? null,
        record.provenance.toolCallId ?? null,
        record.provenance.actor ?? null,
        record.provenance.capturedAt,
      );

      if (stored) {
        this.db.prepare(`
          UPDATE memory_records
          SET
            layer = ?,
            scope_kind = ?,
            scope_id = ?,
            content = ?,
            topic_key = ?,
            tags = ?,
            provenance = ?,
            confidence = ?,
            updated_at = ?,
            deleted_at = NULL
          WHERE id = ?
        `).run(
          record.layer,
          record.scope.kind,
          record.scope.id,
          record.content,
          record.topicKey ?? null,
          tagsJson,
          provenanceJson,
          record.confidence ?? null,
          record.updatedAt ?? null,
          record.id,
        );
        this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(record.id);
      } else {
        this.db.prepare(`
          INSERT INTO memory_records (
            id,
            layer,
            scope_kind,
            scope_id,
            content,
            topic_key,
            tags,
            provenance,
            confidence,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          record.id,
          record.layer,
          record.scope.kind,
          record.scope.id,
          record.content,
          record.topicKey ?? null,
          tagsJson,
          provenanceJson,
          record.confidence ?? null,
          record.createdAt,
          record.updatedAt ?? null,
        );
      }

      this.db.prepare(`
        INSERT INTO memory_fts (id, content, tags, topic_key)
        VALUES (?, ?, ?, ?)
      `).run(record.id, record.content, tagsJson, record.topicKey ?? null);
    });

    return record;
  }

  getRecord(id: string): MemoryRecord | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM memory_records
      WHERE id = ? AND deleted_at IS NULL
    `).get(id) as MemoryRecordRow | undefined;
    return row ? this.toRecord(row) : undefined;
  }

  getRecordByTopicKey(scope: MemoryScope, topicKey: string): MemoryRecord | undefined {
    const definedScope = defineMemoryScope(scope);
    const row = this.db.prepare(`
      SELECT *
      FROM memory_records
      WHERE
        deleted_at IS NULL
        AND scope_kind = ?
        AND scope_id = ?
        AND topic_key = ?
      ORDER BY updated_at DESC, created_at DESC, id ASC
      LIMIT 1
    `).get(definedScope.kind, definedScope.id, requiredText(topicKey, "Memory topic key is required")) as MemoryRecordRow | undefined;
    return row ? this.toRecord(row) : undefined;
  }

  listRecords(query: MemoryRecordQuery = {}): readonly MemoryRecord[] {
    const limit = this.resolveRecordLimit(query.limit);
    const { where, args } = this.whereClause(query);
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_records
      ${where}
      ORDER BY updated_at DESC, created_at DESC, id ASC
      LIMIT ?
    `).all(...args, limit) as MemoryRecordRow[];
    return rows.map((row) => this.toRecord(row));
  }

  searchRecords(query: MemoryRecordQuery): readonly MemoryRecordSearchResult[] {
    if (!query.query || query.query.trim().length === 0) {
      const records = this.listRecords(query);
      return records.map((record) => ({ record }));
    }

    const limit = this.resolveRecordLimit(query.limit);
    const scopedQuery: MemoryRecordQuery = {
      ...query,
      query: undefined,
    };
    const { where, args } = this.whereClause(scopedQuery, "r");
    const rows = this.db.prepare(`
      SELECT r.*,
             bm25(memory_fts) AS score,
             snippet(memory_fts, 1, '<b>', '</b>', '...', 32) AS snippet
      FROM memory_fts f
      JOIN memory_records r ON r.id = f.id
      ${where === "" ? "WHERE" : `${where} AND`} memory_fts MATCH ?
      ORDER BY bm25(memory_fts), r.updated_at DESC, r.created_at DESC, r.id ASC
      LIMIT ?
    `).all(...args, toFtsQuery(query.query), limit) as MemorySearchRow[];

    return rows.map((row) => ({
      record: this.toRecord(row),
      score: Math.abs(row.score),
      snippet: row.snippet,
    }));
  }

  deleteRecord(id: string, scope?: MemoryScope): boolean {
    const record = this.getRecord(id);
    if (!record) return false;
    if (scope && (record.scope.kind !== scope.kind || record.scope.id !== scope.id)) {
      return false;
    }

    const deletedAt = new Date().toISOString();
    this.runTransaction(() => {
      this.db.prepare(`
        INSERT OR IGNORE INTO memory_archive (
          id,
          layer,
          scope_kind,
          scope_id,
          content,
          topic_key,
          tags,
          provenance,
          confidence,
          created_at,
          updated_at,
          archived_at
        )
        SELECT
          id,
          layer,
          scope_kind,
          scope_id,
          content,
          topic_key,
          tags,
          provenance,
          confidence,
          created_at,
          updated_at,
          ?
        FROM memory_records
        WHERE id = ?
      `).run(deletedAt, id);
      this.db.prepare("DELETE FROM memory_fts WHERE id = ?").run(id);
      this.db.prepare("UPDATE memory_records SET deleted_at = ? WHERE id = ?").run(deletedAt, id);
    });
    return true;
  }

  countRecords(scope?: MemoryScope): number {
    if (!scope) {
      const row = this.db.prepare("SELECT COUNT(*) AS count FROM memory_records WHERE deleted_at IS NULL").get() as { count: number };
      return row.count;
    }
    const definedScope = defineMemoryScope(scope);
    const row = this.db.prepare(`
      SELECT COUNT(*) AS count
      FROM memory_records
      WHERE deleted_at IS NULL AND scope_kind = ? AND scope_id = ?
    `).get(definedScope.kind, definedScope.id) as { count: number };
    return row.count;
  }

  saveRevision(revision: MemoryRevision): MemoryRevision {
    validateMemoryRevisionLineage([...this.listRevisions(revision.recordId), revision]);
    this.db.prepare(`
      INSERT INTO memory_revisions (
        id,
        record_id,
        parent_revision_id,
        sequence,
        kind,
        content,
        provenance,
        reason,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      requiredText(revision.id, "Memory revision id is required"),
      requiredText(revision.recordId, "Memory revision record id is required"),
      revision.parentRevisionId ?? null,
      revision.sequence,
      revision.kind,
      requiredText(revision.content, "Memory revision content is required"),
      JSON.stringify(normalizeProvenance(revision.provenance)),
      revision.reason ?? null,
      requiredText(revision.createdAt, "Memory revision createdAt is required"),
    );
    return revision;
  }

  listRevisions(recordId: string, query: { readonly limit?: number } = {}): readonly MemoryRevision[] {
    const args: SqlBinding[] = [recordId];
    let limitClause = "";
    if (query.limit !== undefined) {
      limitClause = "LIMIT ?";
      args.push(this.resolveRevisionLimit(query.limit));
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_revisions
      WHERE record_id = ?
      ORDER BY sequence ASC
      ${limitClause}
    `).all(...args) as MemoryRevisionRow[];
    return rows.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      parentRevisionId: row.parent_revision_id ?? undefined,
      sequence: row.sequence,
      kind: row.kind,
      content: row.content,
      provenance: normalizeProvenance(JSON.parse(row.provenance) as MemoryProvenance),
      reason: row.reason ?? undefined,
      createdAt: row.created_at,
    }));
  }

  saveRelation(input: MemoryRelationDraft): MemoryRelation {
    const relation = createMemoryRelation(input);
    const sourceRecord = this.getRecord(relation.sourceRecordId);
    if (!sourceRecord) throw new Error("Memory relation source record was not found");
    if (relation.target.kind === "memory_record") {
      const targetRecord = this.getRecord(relation.target.id);
      if (!targetRecord) throw new Error("Memory relation target record was not found");
      if (sourceRecord.scope.kind !== targetRecord.scope.kind || sourceRecord.scope.id !== targetRecord.scope.id) {
        throw new Error("Memory relation source and target records must share the same scope");
      }
    }
    this.db.prepare(`
      INSERT INTO memory_relations (
        id,
        source_record_id,
        target_kind,
        target_record_id,
        target_uri,
        relation_type,
        reason,
        evidence,
        confidence,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      relation.id,
      relation.sourceRecordId,
      relation.target.kind,
      relation.target.kind === "memory_record" ? relation.target.id : null,
      relation.target.kind === "resource" ? relation.target.uri : null,
      relation.type,
      relation.reason ?? null,
      JSON.stringify(relation.evidence ?? []),
      relation.confidence ?? null,
      relation.createdAt,
    );
    return relation;
  }

  getRelation(id: string): MemoryRelation | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM memory_relations
      WHERE id = ?
    `).get(id) as MemoryRelationRow | undefined;
    return row ? this.toRelation(row) : undefined;
  }

  listRelations(sourceRecordId: string, query: { readonly limit?: number } = {}): readonly MemoryRelation[] {
    const args: SqlBinding[] = [sourceRecordId];
    let limitClause = "";
    if (query.limit !== undefined) {
      limitClause = "LIMIT ?";
      args.push(this.resolveRelationLimit(query.limit));
    }
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_relations
      WHERE source_record_id = ?
      ORDER BY created_at ASC, id ASC
      ${limitClause}
    `).all(...args) as MemoryRelationRow[];
    return rows.map((row) => this.toRelation(row));
  }

  listIncomingRelations(targetRecordId: string, query: {
    readonly limit?: number;
    readonly sourceScope?: MemoryScope;
  } = {}): readonly MemoryRelation[] {
    const args: SqlBinding[] = [requiredText(targetRecordId, "Memory relation target record id is required")];
    let scopeClause = "";
    if (query.sourceScope) {
      const scope = defineMemoryScope(query.sourceScope);
      scopeClause = "AND source.scope_kind = ? AND source.scope_id = ?";
      args.push(scope.kind, scope.id);
    }
    let limitClause = "";
    if (query.limit !== undefined) {
      limitClause = "LIMIT ?";
      args.push(this.resolveRelationLimit(query.limit));
    }
    const rows = this.db.prepare(`
      SELECT relation.*
      FROM memory_relations relation
      JOIN memory_records source ON source.id = relation.source_record_id
      WHERE relation.target_kind = 'memory_record'
        AND relation.target_record_id = ?
        AND source.deleted_at IS NULL
        ${scopeClause}
      ORDER BY relation.created_at ASC, relation.id ASC
      ${limitClause}
    `).all(...args) as MemoryRelationRow[];
    return rows.map((row) => this.toRelation(row));
  }

  saveContextAdmission(admission: MemoryContextAdmission): MemoryContextAdmission {
    this.db.prepare(`
      INSERT INTO memory_context_admissions (
        id,
        record_id,
        session_id,
        turn_id,
        decision,
        reason,
        estimated_tokens,
        base_score,
        effective_score,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        record_id = excluded.record_id,
        session_id = excluded.session_id,
        turn_id = excluded.turn_id,
        decision = excluded.decision,
        reason = excluded.reason,
        estimated_tokens = excluded.estimated_tokens,
        base_score = excluded.base_score,
        effective_score = excluded.effective_score,
        created_at = excluded.created_at
    `).run(
      admission.id,
      admission.recordId,
      admission.sessionId ?? null,
      admission.turnId ?? null,
      admission.decision,
      admission.reason,
      admission.estimatedTokens,
      admission.baseScore,
      admission.effectiveScore,
      admission.createdAt,
    );
    return admission;
  }

  listContextAdmissions(query: {
    readonly sessionId?: string;
    readonly recordId?: string;
    readonly limit?: number;
    readonly order?: "oldest_first" | "newest_first";
  } = {}): readonly MemoryContextAdmission[] {
    const clauses = [];
    const args: SqlBinding[] = [];
    if (query.sessionId) {
      clauses.push("session_id = ?");
      args.push(query.sessionId);
    }
    if (query.recordId) {
      clauses.push("record_id = ?");
      args.push(query.recordId);
    }
    const limit = this.resolveAdmissionLimit(query.limit);
    const orderClause = query.order === "newest_first"
      ? "ORDER BY created_at DESC, id DESC"
      : "ORDER BY created_at ASC, id ASC";
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT *
      FROM memory_context_admissions
      ${where}
      ${orderClause}
      LIMIT ?
    `).all(...args, limit) as MemoryContextAdmissionRow[];
    return rows.map((row) => ({
      id: row.id,
      recordId: row.record_id,
      sessionId: row.session_id ?? undefined,
      turnId: row.turn_id ?? undefined,
      decision: row.decision,
      reason: row.reason,
      estimatedTokens: row.estimated_tokens,
      baseScore: row.base_score,
      effectiveScore: row.effective_score,
      createdAt: row.created_at,
    }));
  }

  close(): void {
    this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    this.db.close();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_sources (
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        session_id TEXT,
        turn_id TEXT,
        tool_call_id TEXT,
        actor TEXT,
        captured_at TEXT NOT NULL,
        PRIMARY KEY (source_type, source_id)
      );

      CREATE TABLE IF NOT EXISTS memory_records (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        scope_kind TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        content TEXT NOT NULL,
        topic_key TEXT,
        tags TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memory_records_scope
        ON memory_records(scope_kind, scope_id, layer);

      CREATE INDEX IF NOT EXISTS idx_memory_records_topic
        ON memory_records(scope_kind, scope_id, topic_key);

      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
        id UNINDEXED,
        content,
        tags,
        topic_key,
        tokenize='porter'
      );

      CREATE TABLE IF NOT EXISTS memory_revisions (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        parent_revision_id TEXT,
        sequence INTEGER NOT NULL,
        kind TEXT NOT NULL,
        content TEXT NOT NULL,
        provenance TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(record_id, sequence),
        FOREIGN KEY(record_id) REFERENCES memory_records(id)
      );

      CREATE TABLE IF NOT EXISTS memory_relations (
        id TEXT PRIMARY KEY,
        source_record_id TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_record_id TEXT,
        target_uri TEXT,
        relation_type TEXT NOT NULL,
        reason TEXT,
        evidence TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(source_record_id) REFERENCES memory_records(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_relations_source
        ON memory_relations(source_record_id, relation_type);
      CREATE INDEX IF NOT EXISTS idx_memory_relations_target_record
        ON memory_relations(target_kind, target_record_id, relation_type);

      CREATE TABLE IF NOT EXISTS memory_context_admissions (
        id TEXT PRIMARY KEY,
        record_id TEXT NOT NULL,
        session_id TEXT,
        turn_id TEXT,
        decision TEXT NOT NULL,
        reason TEXT NOT NULL,
        estimated_tokens INTEGER NOT NULL,
        base_score REAL NOT NULL,
        effective_score REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(record_id) REFERENCES memory_records(id)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_context_admissions_record
        ON memory_context_admissions(record_id, session_id);

      CREATE TABLE IF NOT EXISTS memory_archive (
        id TEXT PRIMARY KEY,
        layer TEXT NOT NULL,
        scope_kind TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        content TEXT NOT NULL,
        topic_key TEXT,
        tags TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence REAL,
        created_at TEXT NOT NULL,
        updated_at TEXT,
        archived_at TEXT NOT NULL
      );
    `);
    this.ensureMemoryRevisionProvenance();
    this.removeMemoryRecordTopicUniqueness();
  }

  private ensureMemoryRevisionProvenance(): void {
    const columns = this.db.prepare("PRAGMA table_info('memory_revisions')").all() as Array<{ readonly name: string }>;
    if (columns.some((column) => column.name === "provenance")) return;

    this.runTransaction(() => {
      this.db.exec("ALTER TABLE memory_revisions ADD COLUMN provenance TEXT NOT NULL DEFAULT '{}'");
      this.db.exec(`
        UPDATE memory_revisions
        SET provenance = (
          SELECT memory_records.provenance
          FROM memory_records
          WHERE memory_records.id = memory_revisions.record_id
        )
      `);
    });
  }

  private removeMemoryRecordTopicUniqueness(): void {
    if (!this.hasUniqueMemoryRecordTopicIndex()) {
      return;
    }

    this.runTransaction(() => {
      this.db.exec(`
        DROP INDEX IF EXISTS idx_memory_records_scope;
        DROP INDEX IF EXISTS idx_memory_records_topic;

        ALTER TABLE memory_records RENAME TO memory_records_with_unique_topic;

        CREATE TABLE memory_records (
          id TEXT PRIMARY KEY,
          layer TEXT NOT NULL,
          scope_kind TEXT NOT NULL,
          scope_id TEXT NOT NULL,
          content TEXT NOT NULL,
          topic_key TEXT,
          tags TEXT NOT NULL,
          provenance TEXT NOT NULL,
          confidence REAL,
          created_at TEXT NOT NULL,
          updated_at TEXT,
          deleted_at TEXT
        );

        INSERT INTO memory_records (
          id,
          layer,
          scope_kind,
          scope_id,
          content,
          topic_key,
          tags,
          provenance,
          confidence,
          created_at,
          updated_at,
          deleted_at
        )
        SELECT
          id,
          layer,
          scope_kind,
          scope_id,
          content,
          topic_key,
          tags,
          provenance,
          confidence,
          created_at,
          updated_at,
          deleted_at
        FROM memory_records_with_unique_topic;

        DROP TABLE memory_records_with_unique_topic;

        CREATE INDEX IF NOT EXISTS idx_memory_records_scope
          ON memory_records(scope_kind, scope_id, layer);

        CREATE INDEX IF NOT EXISTS idx_memory_records_topic
          ON memory_records(scope_kind, scope_id, topic_key);
      `);
    });
  }

  private hasUniqueMemoryRecordTopicIndex(): boolean {
    const indexes = this.db.prepare("PRAGMA index_list('memory_records')").all() as SqliteIndexRow[];
    for (const index of indexes) {
      if (index.unique !== 1) {
        continue;
      }
      const columns = (this.db.prepare(`PRAGMA index_info('${index.name}')`).all() as SqliteIndexInfoRow[])
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name);
      if (columns.join("|") === "scope_kind|scope_id|topic_key") {
        return true;
      }
    }
    return false;
  }

  private runTransaction<T>(work: () => T): T {
    if (this.inTransaction) {
      return work();
    }

    this.db.exec("BEGIN");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  private normalizeRecord(input: CreateMemoryRecordInput, now: string): MemoryRecord {
    if (!isMemoryLayerKind(input.layer)) {
      throw new Error(`Unsupported memory layer: ${input.layer as string}`);
    }
    const scope = defineMemoryScope(input.scope);
    const content = requiredText(input.content, "Memory record content is required");
    const provenance = normalizeProvenance(input.provenance);
    if (input.confidence !== undefined && (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1)) {
      throw new Error("Memory record confidence must be between 0 and 1");
    }

    return {
      id: input.id ?? randomUUID(),
      layer: input.layer,
      scope,
      content,
      topicKey: input.topicKey?.trim() || undefined,
      tags: normalizeTags(input.tags ?? []),
      provenance,
      confidence: input.confidence,
      createdAt: input.createdAt ?? now,
      updatedAt: input.createdAt ?? now,
    };
  }

  private whereClause(query: MemoryRecordQuery, alias = ""): {
    readonly where: string;
    readonly args: SqlBinding[];
  } {
    const prefix = alias ? `${alias}.` : "";
    const clauses = [`${prefix}deleted_at IS NULL`];
    const args: SqlBinding[] = [];

    if (query.scope) {
      const scope = defineMemoryScope(query.scope);
      clauses.push(`${prefix}scope_kind = ?`, `${prefix}scope_id = ?`);
      args.push(scope.kind, scope.id);
    }
    if (query.layer) {
      if (!isMemoryLayerKind(query.layer)) {
        throw new Error(`Unsupported memory layer: ${query.layer as string}`);
      }
      clauses.push(`${prefix}layer = ?`);
      args.push(query.layer);
    }
    for (const tag of normalizeTags(query.tags ?? [])) {
      clauses.push(`${prefix}tags LIKE ?`);
      args.push(`%"${tag}"%`);
    }

    return {
      where: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
      args,
    };
  }

  private resolveRecordLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RECORD_LIMIT) {
      throw new Error("Memory record query limit must be an integer between 1 and 500");
    }
    return limit;
  }

  private resolveRevisionLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_REVISION_LIMIT) {
      throw new Error("Memory revision query limit must be an integer between 1 and 501");
    }
    return limit;
  }

  private resolveRelationLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RELATION_LIMIT) {
      throw new Error("Memory relation query limit must be an integer between 1 and 1001");
    }
    return limit;
  }

  private resolveAdmissionLimit(limit: number | undefined): number {
    if (limit === undefined) return DEFAULT_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMISSION_LIMIT) {
      throw new Error("Memory context admission query limit must be an integer between 1 and 501");
    }
    return limit;
  }

  private toRecord(row: MemoryRecordRow): MemoryRecord {
    if (!isMemoryLayerKind(row.layer)) {
      throw new Error(`Stored memory layer is invalid: ${row.layer}`);
    }
    return {
      id: row.id,
      layer: row.layer,
      scope: defineMemoryScope({
        kind: row.scope_kind,
        id: row.scope_id,
      }),
      content: row.content,
      topicKey: row.topic_key ?? undefined,
      tags: JSON.parse(row.tags) as string[],
      provenance: JSON.parse(row.provenance) as MemoryProvenance,
      confidence: row.confidence ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? undefined,
    };
  }

  private toRelation(row: MemoryRelationRow): MemoryRelation {
    const target: MemoryRelationTarget = row.target_kind === "memory_record"
      ? {
        kind: "memory_record",
        id: requiredText(row.target_record_id ?? "", "Memory relation target id is required"),
      }
      : {
        kind: "resource",
        uri: requiredText(row.target_uri ?? "", "Memory relation target URI is required"),
      };

    return createMemoryRelation({
      id: row.id,
      sourceRecordId: row.source_record_id,
      target,
      type: row.relation_type,
      reason: row.reason ?? undefined,
      evidence: JSON.parse(row.evidence) as string[],
      confidence: row.confidence ?? undefined,
      createdAt: row.created_at,
    });
  }
}

function normalizeProvenance(provenance: MemoryProvenance): MemoryProvenance {
  if (!(MEMORY_PROVENANCE_SOURCE_TYPES as readonly string[]).includes(provenance.sourceType)) {
    throw new Error(`Unsupported memory provenance source type: ${provenance.sourceType as string}`);
  }
  return {
    ...provenance,
    sourceId: requiredText(provenance.sourceId, "Memory provenance source id is required"),
    capturedAt: requiredText(provenance.capturedAt, "Memory provenance capturedAt is required"),
  };
}

function normalizeTags(tags: readonly string[]): readonly string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

function toFtsQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/g)
    .map((term) => `"${term.replace(/"/g, "\"\"")}"`)
    .join(" ");
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
