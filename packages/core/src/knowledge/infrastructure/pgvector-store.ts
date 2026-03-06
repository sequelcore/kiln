// PgVectorStore -- PostgreSQL + pgvector vector storage with hybrid search (RRF)

import type { VectorEntry, VectorResult, VectorQueryOptions, VectorStore } from "../../engine/domain/vector-store.js";
import { KilnError } from "../../engine/errors.js";

export interface PgVectorStoreConfig {
  readonly connectionString: string;
  readonly dimensions?: number;
  readonly tableName?: string;
}

/** Minimal interface matching the postgres (Porsager) client. */
interface SqlLike {
  begin(fn: (sql: SqlLike) => Promise<void>): Promise<void>;
  end(): Promise<void>;
  unsafe(query: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

export class PgVectorStore implements VectorStore {
  private readonly sql: SqlLike;
  private readonly dimensions: number;
  private readonly tableName: string;

  constructor(sql: SqlLike, config: PgVectorStoreConfig) {
    this.sql = sql;
    this.dimensions = config.dimensions ?? 1536;
    this.tableName = config.tableName ?? "kiln_knowledge_chunks";
  }

  async initialize(): Promise<void> {
    await this.sql.unsafe("CREATE EXTENSION IF NOT EXISTS vector");

    await this.sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding halfvec(${this.dimensions}),
        metadata JSONB DEFAULT '{}',
        tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
      )
    `);

    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_embedding_idx
      ON ${this.tableName} USING hnsw (embedding halfvec_cosine_ops)
      WITH (m = 16, ef_construction = 128)
    `);

    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_metadata_idx
      ON ${this.tableName} USING gin (metadata)
    `);

    await this.sql.unsafe(`
      CREATE INDEX IF NOT EXISTS ${this.tableName}_tsv_idx
      ON ${this.tableName} USING gin (tsv)
    `);
  }

  async upsert(entries: VectorEntry[]): Promise<void> {
    await this.sql.begin(async (tx) => {
      for (const entry of entries) {
        const embeddingStr = `[${entry.embedding.join(",")}]`;
        await tx.unsafe(
          `INSERT INTO ${this.tableName} (id, content, embedding, metadata)
           VALUES ($1, $2, $3::halfvec, $4::jsonb)
           ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata`,
          [entry.id, entry.content, embeddingStr, JSON.stringify(entry.metadata)],
        );
      }
    });
  }

  async query(embedding: number[], options: VectorQueryOptions): Promise<VectorResult[]> {
    const { topK, minScore, filter } = options;
    const embeddingStr = `[${embedding.join(",")}]`;

    const conditions: string[] = [];
    const params: unknown[] = [embeddingStr, topK];

    if (filter) {
      params.push(JSON.stringify(filter));
      conditions.push(`metadata @> $${params.length}::jsonb`);
    }

    if (minScore !== undefined) {
      params.push(minScore);
      conditions.push(`1 - (embedding <=> $1::halfvec) >= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const rows = await this.sql.unsafe(
      `SELECT id, content, metadata, 1 - (embedding <=> $1::halfvec) AS score
       FROM ${this.tableName}
       ${whereClause}
       ORDER BY embedding <=> $1::halfvec
       LIMIT $2`,
      params,
    );

    return rows.map((row) => ({
      id: row.id as string,
      content: row.content as string,
      score: Number(row.score),
      metadata: (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>,
    }));
  }

  async delete(ids: string[]): Promise<void> {
    await this.sql.unsafe(`DELETE FROM ${this.tableName} WHERE id = ANY($1)`, [ids]);
  }

  async deleteByMetadata(filter: Record<string, unknown>): Promise<number> {
    const rows = await this.sql.unsafe(
      `DELETE FROM ${this.tableName} WHERE metadata @> $1::jsonb RETURNING id`,
      [JSON.stringify(filter)],
    );
    return rows.length;
  }

  async hybridQuery(embedding: number[], text: string, options: VectorQueryOptions): Promise<VectorResult[]> {
    const { topK, filter } = options;
    const embeddingStr = `[${embedding.join(",")}]`;

    const params: unknown[] = [embeddingStr, text, topK * 2, topK];
    let metadataCondition = "";

    if (filter) {
      params.push(JSON.stringify(filter));
      metadataCondition = `AND metadata @> $${params.length}::jsonb`;
    }

    const rows = await this.sql.unsafe(
      `WITH vector_search AS (
        SELECT id, content, metadata, ROW_NUMBER() OVER (ORDER BY embedding <=> $1::halfvec) AS rank
        FROM ${this.tableName}
        WHERE true ${metadataCondition}
        LIMIT $3
      ),
      text_search AS (
        SELECT id, content, metadata, ROW_NUMBER() OVER (ORDER BY ts_rank(tsv, plainto_tsquery('english', $2)) DESC) AS rank
        FROM ${this.tableName}
        WHERE tsv @@ plainto_tsquery('english', $2)
        ${metadataCondition}
        LIMIT $3
      ),
      rrf AS (
        SELECT COALESCE(v.id, t.id) AS id,
               COALESCE(v.content, t.content) AS content,
               COALESCE(v.metadata, t.metadata) AS metadata,
               COALESCE(1.0 / (60 + v.rank), 0) + COALESCE(1.0 / (60 + t.rank), 0) AS score
        FROM vector_search v
        FULL OUTER JOIN text_search t ON v.id = t.id
      )
      SELECT * FROM rrf ORDER BY score DESC LIMIT $4`,
      params,
    );

    return rows.map((row) => ({
      id: row.id as string,
      content: row.content as string,
      score: Number(row.score),
      metadata: (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>,
    }));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }
}

/** Create a PgVectorStore with a real postgres (Porsager) client via dynamic import. */
export async function createPgVectorStore(config: PgVectorStoreConfig): Promise<PgVectorStore> {
  const moduleName = "postgres";
  let postgres: (connectionString: string) => SqlLike;
  try {
    const mod = (await import(/* @vite-ignore */ moduleName)) as { default: (connectionString: string) => SqlLike };
    postgres = mod.default;
  } catch {
    throw new KilnError("CONFIG_INVALID", "postgres module not found. Install: bun add postgres", {
      context: { backend: "pgvector" },
    });
  }
  const sql = postgres(config.connectionString);
  return new PgVectorStore(sql, config);
}
