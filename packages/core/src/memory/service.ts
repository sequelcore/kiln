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
  MemoryAuthorityBoundary,
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
import {
  evaluateMemoryWriteAdmission,
  type MemoryWriteAdmissionInput,
  type MemoryWriteAdmissionResult,
} from "./efficiency.js";

export interface MemoryMutationServiceOptions {
  readonly repository: MemoryRepository;
  readonly eventBus?: EventBus;
  readonly sessionId?: string;
  readonly tenantId?: string;
  /** Explicitly governed or explicitly trusted-internal; omission is invalid. */
  readonly authority: MemoryAuthorityBoundary;
}

const DEFAULT_MEMORY_SESSION_ID = "memory";

export class MemoryMutationService {
  private readonly repository: MemoryRepository;
  private readonly eventBus: EventBus | undefined;
  private readonly sessionId: string;
  private readonly tenantId: string | undefined;
  private readonly authority: MemoryAuthorityBoundary;

  constructor(options: MemoryMutationServiceOptions) {
    this.repository = options.repository;
    this.eventBus = options.eventBus;
    this.sessionId = options.sessionId ?? DEFAULT_MEMORY_SESSION_ID;
    this.tenantId = options.tenantId;
    this.authority = options.authority;
  }

  saveRecord(
    input: CreateMemoryRecordInput,
    writeAdmission?: Omit<MemoryWriteAdmissionInput, "layer" | "topicKey" | "provenance" | "confidence">,
  ): MemoryRecord {
    this.assertWriteAuthority(input);
    if (writeAdmission) {
      const admission = evaluateMemoryWriteAdmission({
        layer: input.layer,
        topicKey: input.topicKey,
        provenance: input.provenance,
        confidence: input.confidence,
        ...writeAdmission,
      });
      assertMemoryWriteAdmitted(admission);
    }
    const existing = input.id ? this.repository.getRecord(input.id) : undefined;
    const record = this.repository.saveRecord(input);
    this.emitRecordEvent(existing ? "memory_record_updated" : "memory_record_created", record);
    return record;
  }

  deleteRecord(id: string): boolean {
    const existing = this.repository.getRecord(id);
    if (existing) {
      this.assertMutationAuthority({ operation: "delete", scope: existing.scope, layer: existing.layer });
    }
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
    const sourceRecord = this.repository.getRecord(input.sourceRecordId);
    if (sourceRecord) {
      this.assertMutationAuthority({ operation: "relate", scope: sourceRecord.scope, layer: sourceRecord.layer });
    }
    const relation = this.repository.saveRelation(input);
    const savedSourceRecord = this.repository.getRecord(relation.sourceRecordId);
    this.emit({
      type: "memory_relation_created",
      relationId: relation.id,
      sourceRecordId: relation.sourceRecordId,
      ...(relation.target.kind === "memory_record" ? { targetRecordId: relation.target.id } : {}),
      ...(relation.target.kind === "resource" ? { targetUri: relation.target.uri } : {}),
      relationType: relation.type,
      ...(savedSourceRecord ? { scope: savedSourceRecord.scope } : {}),
      timestamp: new Date(),
      sessionId: this.sessionId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
    } satisfies MemoryRelationCreatedEvent);
    return relation;
  }

  saveRevision(revision: MemoryRevision): MemoryRevision {
    const record = this.repository.getRecord(revision.recordId);
    if (record) {
      this.assertMutationAuthority({ operation: "revise", scope: record.scope, layer: record.layer });
    }
    const saved = this.repository.saveRevision(revision);
    const savedRecord = this.repository.getRecord(saved.recordId);
    this.emit({
      type: "memory_revision_created",
      revisionId: saved.id,
      recordId: saved.recordId,
      ...(savedRecord ? { scope: savedRecord.scope } : {}),
      timestamp: new Date(),
      sessionId: this.sessionId,
      ...(this.tenantId ? { tenantId: this.tenantId } : {}),
    } satisfies MemoryRevisionCreatedEvent);
    return saved;
  }

  saveContextAdmission(admission: MemoryContextAdmission): MemoryContextAdmission {
    const record = this.repository.getRecord(admission.recordId);
    if (record) {
      this.assertMutationAuthority({ operation: "promote", scope: record.scope, layer: record.layer });
    }
    const saved = this.repository.saveContextAdmission(admission);
    const savedRecord = this.repository.getRecord(saved.recordId);
    this.emit({
      type: saved.decision === "admitted" ? "memory_context_admitted" : "memory_context_deferred",
      admissionId: saved.id,
      recordId: saved.recordId,
      ...(savedRecord ? { scope: savedRecord.scope } : {}),
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
    this.assertMutationAuthority({
      operation: "save",
      scope: input.scope,
      layer: input.layer,
    });
  }

  private assertMutationAuthority(request: {
    readonly operation: Parameters<typeof assertMemoryWriteAuthorized>[1]["operation"];
    readonly scope: CreateMemoryRecordInput["scope"];
    readonly layer: CreateMemoryRecordInput["layer"];
  }): void {
    if (this.authority.kind === "trusted-internal") {
      return;
    }
    assertMemoryWriteAuthorized(this.authority.policy, request);
  }
}

function assertMemoryWriteAdmitted(admission: MemoryWriteAdmissionResult): void {
  if (admission.decision === "admit") return;
  throw new Error(`Memory write ${admission.decision} by ${admission.policyId}: ${admission.reasons.join(", ")}`);
}
