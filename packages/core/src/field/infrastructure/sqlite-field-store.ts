import { Database } from "bun:sqlite";
import type { FieldSignal, FieldSnapshot, FieldVector } from "../domain/field.js";
import type { FieldConfig } from "../domain/field-config.js";
import { DEFAULT_FIELD_CONFIG } from "../domain/field-config.js";
import type { FieldStore } from "../domain/field-store.js";

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS field_vectors (
    regionId TEXT PRIMARY KEY,
    value REAL NOT NULL,
    confidence REAL NOT NULL,
    updatedAt INTEGER NOT NULL,
    source TEXT NOT NULL
  )
`;

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function computeEntropy(regions: readonly FieldVector[]): number {
  const total = regions.reduce((sum, r) => sum + r.value, 0);
  if (total <= 0) return 0;
  return regions.reduce((entropy, region) => {
    if (region.value <= 0) return entropy;
    const probability = region.value / total;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

export interface SqliteFieldStoreOptions {
  readonly path?: string;
  readonly config?: FieldConfig;
}

export class SqliteFieldStore implements FieldStore {
  private readonly db: Database;
  private readonly config: Required<FieldConfig>;
  private readonly subscribers = new Set<(snapshot: FieldSnapshot) => void>();

  constructor(opts?: SqliteFieldStoreOptions) {
    this.db = new Database(opts?.path ?? ":memory:");
    this.db.run(CREATE_TABLE);
    this.config = { ...DEFAULT_FIELD_CONFIG, ...opts?.config };
  }

  async inject(signal: FieldSignal): Promise<void> {
    const now = signal.timestamp ?? Date.now();
    const selectStmt = this.db.prepare("SELECT value, confidence FROM field_vectors WHERE regionId = ?");
    const current = selectStmt.get(signal.regionId) as { value: number; confidence: number } | undefined;
    const baseValue = current?.value ?? 0;
    const baseConfidence = current?.confidence ?? this.config.defaultConfidence;
    const nextValue = clamp(baseValue + signal.delta, this.config.minValue, this.config.maxValue);
    const nextConfidence = clamp(signal.confidence ?? baseConfidence, 0, 1);

    const insertStmt = this.db.prepare(`
      INSERT INTO field_vectors (regionId, value, confidence, updatedAt, source)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(regionId) DO UPDATE SET
        value = excluded.value,
        confidence = excluded.confidence,
        updatedAt = excluded.updatedAt,
        source = excluded.source
    `);
    insertStmt.run(signal.regionId, nextValue, nextConfidence, now, signal.source);

    this.emit();
  }

  async snapshot(): Promise<FieldSnapshot> {
    const rows = this.db.prepare("SELECT regionId, value, confidence, updatedAt, source FROM field_vectors")
      .all() as Array<{
        regionId: string;
        value: number;
        confidence: number;
        updatedAt: number;
        source: string;
      }>;
    const vectors: FieldVector[] = rows.map((row) => ({
      regionId: row.regionId,
      value: row.value,
      confidence: row.confidence,
      updatedAt: row.updatedAt,
      source: row.source as FieldSignal["source"],
    }));
    const ordered = [...vectors].sort((a, b) => b.value - a.value || b.updatedAt - a.updatedAt);
    const dominant = ordered.slice(0, this.config.dominantRegionLimit).map((v) => v.regionId);
    return {
      timestamp: Date.now(),
      regions: new Map(ordered.map((v) => [v.regionId, v])),
      entropy: computeEntropy(ordered),
      dominantRegions: dominant,
    };
  }

  async queryRegion(regionId: string): Promise<FieldVector | null> {
    const row = this.db.prepare("SELECT regionId, value, confidence, updatedAt, source FROM field_vectors WHERE regionId = ?")
      .get(regionId) as {
        regionId: string;
        value: number;
        confidence: number;
        updatedAt: number;
        source: string;
      } | undefined;
    if (!row) return null;
    return {
      regionId: row.regionId,
      value: row.value,
      confidence: row.confidence,
      updatedAt: row.updatedAt,
      source: row.source as FieldSignal["source"],
    };
  }

  subscribe(cb: (snapshot: FieldSnapshot) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  close(): void {
    this.db.close();
  }

  private emit(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.snapshot();
    snapshot.then((value) => {
      for (const subscriber of this.subscribers) {
        subscriber(value);
      }
    }).catch(() => {});
  }
}
