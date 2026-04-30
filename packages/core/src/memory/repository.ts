import type {
  MemoryContextAdmission,
  MemoryLayerKind,
  MemoryProvenance,
  MemoryRecord,
  MemoryRelation,
  MemoryRelationDraft,
  MemoryRevision,
  MemoryScope,
} from "./domain/index.js";

export interface CreateMemoryRecordInput {
  readonly id?: string;
  readonly layer: MemoryLayerKind;
  readonly scope: MemoryScope;
  readonly content: string;
  readonly topicKey?: string;
  readonly tags?: readonly string[];
  readonly provenance: MemoryProvenance;
  readonly confidence?: number;
  readonly createdAt?: string;
}

export interface MemoryRecordQuery {
  readonly query?: string;
  readonly scope?: MemoryScope;
  readonly layer?: MemoryLayerKind;
  readonly tags?: readonly string[];
  readonly limit?: number;
}

export interface MemoryRecordSearchResult {
  readonly record: MemoryRecord;
  readonly score?: number;
  readonly snippet?: string;
}

export interface MemoryRepository {
  transaction<T>(work: () => T): T;

  saveRecord(input: CreateMemoryRecordInput): MemoryRecord;
  getRecord(id: string): MemoryRecord | undefined;
  getRecordByTopicKey(scope: MemoryScope, topicKey: string): MemoryRecord | undefined;
  listRecords(query?: MemoryRecordQuery): readonly MemoryRecord[];
  searchRecords(query: MemoryRecordQuery): readonly MemoryRecordSearchResult[];
  deleteRecord(id: string, scope?: MemoryScope): boolean;
  countRecords(scope?: MemoryScope): number;

  saveRevision(revision: MemoryRevision): MemoryRevision;
  listRevisions(recordId: string, query?: {
    readonly limit?: number;
  }): readonly MemoryRevision[];

  saveRelation(relation: MemoryRelationDraft): MemoryRelation;
  getRelation(id: string): MemoryRelation | undefined;
  listRelations(sourceRecordId: string, query?: {
    readonly limit?: number;
  }): readonly MemoryRelation[];

  saveContextAdmission(admission: MemoryContextAdmission): MemoryContextAdmission;
  listContextAdmissions(query?: {
    readonly sessionId?: string;
    readonly recordId?: string;
    readonly limit?: number;
  }): readonly MemoryContextAdmission[];

  close(): void;
}
