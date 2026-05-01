import type {
  EventBus,
  MemoryContextAdmittedEvent,
  MemoryContextDeferredEvent,
  MemoryRecordCreatedEvent,
  MemoryRecordDeletedEvent,
  MemoryRecordUpdatedEvent,
  MemoryRelationCreatedEvent,
  MemoryRevisionCreatedEvent,
} from "../events/index.js";
import type {
  MemoryAuthorityPolicy,
  MemoryContextAdmission,
  MemoryRecord,
  MemoryRelation,
  MemoryRevision,
} from "./domain/index.js";
import { assertMemoryWriteAuthorized } from "./domain/index.js";
import type {
  CreateMemoryRecordInput,
  MemoryRepository,
} from "./repository.js";
import type { MemoryRelationDraft } from "./domain/relation.js";

export interface MemoryMutationServiceOptions {
  readonly repository: MemoryRepository;
  readonly eventBus?: EventBus;
  readonly sessionId?: string;
  readonly tenantId?: string;
  readonly authority?: MemoryAuthorityPolicy;
}

const DEFAULT_MEMORY_SESSION_ID = "memory";

export class MemoryMutationService {
  private readonly repository: MemoryRepository;
  private readonly eventBus: EventBus | undefined;
  private readonly sessionId: string;
  private readonly tenantId: string | undefined;
  private readonly authority: MemoryAuthorityPolicy | undefined;

  constructor(options: MemoryMutationServiceOptions) {
    this.repository = options.repository;
    this.eventBus = options.eventBus;
    this.sessionId = options.sessionId ?? DEFAULT_MEMORY_SESSION_ID;
    this.tenantId = options.tenantId;
    this.authority = options.authority;
  }

  saveRecord(input: CreateMemoryRecordInput): MemoryRecord {
    this.assertWriteAuthority(input);
    const existing = input.id ? this.repository.getRecord(input.id) : undefined;
    const record = this.repository.saveRecord(input);
    this.emitRecordEvent(existing ? "memory_record_updated" : "memory_record_created", record);
    return record;
  }

  deleteRecord(id: string): boolean {
    const existing = this.repository.getRecord(id);
    const deleted = this.repository.deleteRecord(id);
    if (deleted && existing) {
      this.emit({
        type: "memory_record_deleted",
        recordId: existing.id,
        scope: existing.scope,
        layer: existing.layer,
        timestamp: new Date(),
        sessionId: this.sessionId,
        ...(this.tenantId ? { tenantId: this.tenantId } : {}),
      } satisfies MemoryRecordDeletedEvent);
    }
    return deleted;
  }

  saveRelation(input: MemoryRelationDraft): MemoryRelation {
    const relation = this.repository.saveRelation(input);
    const sourceRecord = this.repository.getRecord(relation.sourceRecordId);
    this.emit({
      type: "memory_relation_created",
      relationId: relation.id,
      sourceRecordId: relation.sourceRecordId,
      ...(relation.target.kind === "memory_record" ? { targetRecordId: relation.target.id } : {}),
      ...(relation.target.kind === "resource" ? { targetUri: relation.target.uri } : {}),
      relationType: relation.type,
      ...(sourceRecord ? { scope: sourceRecord.scope } : {}),
      timestamp: new Date(),
      sessionId: this.sessionId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
    } satisfies MemoryRelationCreatedEvent);
    return relation;
  }

  saveRevision(revision: MemoryRevision): MemoryRevision {
    const saved = this.repository.saveRevision(revision);
    const record = this.repository.getRecord(saved.recordId);
    this.emit({
      type: "memory_revision_created",
      revisionId: saved.id,
      recordId: saved.recordId,
      ...(record ? { scope: record.scope } : {}),
      timestamp: new Date(),
      sessionId: this.sessionId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
    } satisfies MemoryRevisionCreatedEvent);
    return saved;
  }

  saveContextAdmission(admission: MemoryContextAdmission): MemoryContextAdmission {
    const saved = this.repository.saveContextAdmission(admission);
    const record = this.repository.getRecord(saved.recordId);
    this.emit({
      type: saved.decision === "admitted" ? "memory_context_admitted" : "memory_context_deferred",
      admissionId: saved.id,
      recordId: saved.recordId,
      ...(record ? { scope: record.scope } : {}),
      timestamp: new Date(),
      sessionId: this.sessionId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
    } satisfies MemoryContextAdmittedEvent | MemoryContextDeferredEvent);
    return saved;
  }

  private emitRecordEvent(
    type: MemoryRecordCreatedEvent["type"] | MemoryRecordUpdatedEvent["type"],
    record: MemoryRecord,
  ): void {
    this.emit({
      type,
      recordId: record.id,
      scope: record.scope,
      layer: record.layer,
      ...(record.topicKey ? { topicKey: record.topicKey } : {}),
      timestamp: new Date(),
      sessionId: this.sessionId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
    } satisfies MemoryRecordCreatedEvent | MemoryRecordUpdatedEvent);
  }

  private emit<T extends Parameters<EventBus["emit"]>[0]>(event: T): void {
    this.eventBus?.emit(event);
  }

  private assertWriteAuthority(input: CreateMemoryRecordInput): void {
    if (!this.authority) {
      return;
    }
    assertMemoryWriteAuthorized(this.authority, {
      operation: "save",
      scope: input.scope,
      layer: input.layer,
    });
  }
}
