import type {
  MemoryProvenance,
  MemoryRecord,
  MemoryRevision,
  MemoryRevisionKind,
  MemoryScope,
} from "../domain/index.js";
import type { MemoryRepository } from "../repository.js";
import { MemoryRelationService } from "../relations/index.js";
import type { MemoryRelation } from "../domain/index.js";

type IdGenerator = () => string;
type Clock = () => string;

export interface MemoryReconsolidationServiceOptions {
  readonly repository: MemoryRepository;
  readonly relations?: MemoryRelationService;
  readonly idGenerator?: IdGenerator;
  readonly revisionIdGenerator?: IdGenerator;
  readonly clock?: Clock;
}

export interface MemoryTargetSelector {
  readonly recordId?: string;
  readonly scope?: MemoryScope;
  readonly topicKey?: string;
}

export interface MemoryReconsolidationMutationInput extends MemoryTargetSelector {
  readonly content: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly provenance: MemoryProvenance;
  readonly reason?: string;
}

export interface MemoryNoopInput extends MemoryTargetSelector {
  readonly provenance: MemoryProvenance;
  readonly reason?: string;
}

export interface MemoryRelatedRecordInput {
  readonly targetRecordId: string;
  readonly content: string;
  readonly topicKey: string;
  readonly tags?: readonly string[];
  readonly confidence?: number;
  readonly provenance: MemoryProvenance;
  readonly reason?: string;
  readonly evidence?: readonly string[];
}

export interface MemoryReconsolidationResult {
  readonly record: MemoryRecord;
  readonly revision: MemoryRevision;
}

export interface MemoryRelatedRecordResult {
  readonly record: MemoryRecord;
  readonly relation: MemoryRelation;
}

export class MemoryReconsolidationService {
  private readonly repository: MemoryRepository;
  private readonly relations: MemoryRelationService;
  private readonly idGenerator: IdGenerator;
  private readonly revisionIdGenerator: IdGenerator;
  private readonly clock: Clock;

  constructor(options: MemoryReconsolidationServiceOptions) {
    this.repository = options.repository;
    this.relations = options.relations ?? new MemoryRelationService({ repository: options.repository });
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.revisionIdGenerator = options.revisionIdGenerator ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  correct(input: MemoryReconsolidationMutationInput): MemoryReconsolidationResult {
    return this.updateExisting(input, "corrected", requiredText(input.content, "Memory correction content is required"));
  }

  extend(input: MemoryReconsolidationMutationInput): MemoryReconsolidationResult {
    const target = this.resolveTarget(input);
    const extension = requiredText(input.content, "Memory extension content is required");
    return this.updateRecord({
      target,
      content: `${target.content}\n\n${extension}`,
      kind: "extended",
      provenance: requireProvenance(input.provenance),
      reason: input.reason,
      tags: input.tags,
      confidence: input.confidence,
    });
  }

  noop(input: MemoryNoopInput): MemoryReconsolidationResult {
    const target = this.resolveTarget(input);
    return this.updateRecord({
      target,
      content: target.content,
      kind: "noop",
      provenance: requireProvenance(input.provenance),
      reason: input.reason,
    });
  }

  contradict(input: MemoryRelatedRecordInput): MemoryRelatedRecordResult {
    return this.createRelatedRecord(input, "contradicts");
  }

  supersede(input: MemoryRelatedRecordInput): MemoryRelatedRecordResult {
    return this.createRelatedRecord(input, "supersedes");
  }

  private updateExisting(
    input: MemoryReconsolidationMutationInput,
    kind: MemoryRevisionKind,
    content: string,
  ): MemoryReconsolidationResult {
    const target = this.resolveTarget(input);
    return this.updateRecord({
      target,
      content,
      kind,
      provenance: requireProvenance(input.provenance),
      reason: input.reason,
      tags: input.tags,
      confidence: input.confidence,
    });
  }

  private updateRecord(input: {
    readonly target: MemoryRecord;
    readonly content: string;
    readonly kind: MemoryRevisionKind;
    readonly provenance: MemoryProvenance;
    readonly reason?: string;
    readonly tags?: readonly string[];
    readonly confidence?: number;
  }): MemoryReconsolidationResult {
    return this.repository.transaction(() => {
      this.ensureCreatedRevision(input.target);

      const record = this.repository.saveRecord({
        id: input.target.id,
        layer: input.target.layer,
        scope: input.target.scope,
        content: input.content,
        topicKey: input.target.topicKey,
        tags: input.tags ?? input.target.tags,
        provenance: input.provenance,
        confidence: input.confidence ?? input.target.confidence,
        createdAt: input.target.createdAt,
      });
      const revision = this.appendRevision(record, input.kind, input.reason);
      return { record, revision };
    });
  }

  private createRelatedRecord(
    input: MemoryRelatedRecordInput,
    relationType: "contradicts" | "supersedes",
  ): MemoryRelatedRecordResult {
    const target = this.repository.getRecord(requiredText(input.targetRecordId, "Memory reconsolidation target record id is required"));
    if (!target) {
      throw new Error("Memory reconsolidation target was not found");
    }

    return this.repository.transaction(() => {
      const record = this.repository.saveRecord({
        id: this.idGenerator(),
        layer: target.layer,
        scope: target.scope,
        content: requiredText(input.content, "Memory related record content is required"),
        topicKey: requiredText(input.topicKey, "Memory related record topic key is required"),
        tags: input.tags ?? target.tags,
        provenance: requireProvenance(input.provenance),
        confidence: input.confidence ?? target.confidence,
      });
      this.ensureCreatedRevision(record);

      const relation = this.relations.linkRecords({
        sourceRecordId: record.id,
        targetRecordId: target.id,
        type: relationType,
        reason: input.reason,
        evidence: input.evidence,
        confidence: input.confidence,
      });
      return { record, relation };
    });
  }

  private resolveTarget(input: MemoryTargetSelector): MemoryRecord {
    if (input.recordId) {
      const target = this.repository.getRecord(requiredText(input.recordId, "Memory reconsolidation target record id is required"));
      if (!target) {
        throw new Error("Memory reconsolidation target was not found");
      }
      if (input.scope && (target.scope.kind !== input.scope.kind || target.scope.id !== input.scope.id)) {
        throw new Error("Memory reconsolidation target was not found");
      }
      if (input.topicKey !== undefined && target.topicKey !== requiredText(input.topicKey, "Memory reconsolidation topic key is required")) {
        throw new Error("Memory reconsolidation target was not found");
      }
      return target;
    }

    if (!input.scope || !input.topicKey) {
      throw new Error("Memory reconsolidation requires matching scope plus topic or explicit relation");
    }

    const target = this.repository.getRecordByTopicKey(input.scope, input.topicKey);
    if (!target) {
      throw new Error("Memory reconsolidation target was not found");
    }
    return target;
  }

  private ensureCreatedRevision(record: MemoryRecord): void {
    if (this.repository.listRevisions(record.id).length > 0) {
      return;
    }

    this.repository.saveRevision({
      id: this.revisionIdGenerator(),
      recordId: record.id,
      sequence: 1,
      kind: "created",
      content: record.content,
      createdAt: record.createdAt,
    });
  }

  private appendRevision(record: MemoryRecord, kind: MemoryRevisionKind, reason?: string): MemoryRevision {
    const revisions = this.repository.listRevisions(record.id);
    const previous = revisions[revisions.length - 1];
    return this.repository.saveRevision({
      id: this.revisionIdGenerator(),
      recordId: record.id,
      parentRevisionId: previous?.id,
      sequence: (previous?.sequence ?? 0) + 1,
      kind,
      content: record.content,
      reason,
      createdAt: this.clock(),
    });
  }
}

function requireProvenance(provenance: MemoryProvenance | undefined): MemoryProvenance {
  if (!provenance) {
    throw new Error("Memory reconsolidation provenance is required");
  }
  return provenance;
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
