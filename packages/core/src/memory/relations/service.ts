import type {
  MemoryRelation,
  MemoryRelationTarget,
  MemoryRelationType,
} from "../domain/index.js";
import type { MemoryRepository } from "../repository.js";

type IdGenerator = () => string;
type Clock = () => string;

export interface MemoryRelationServiceOptions {
  readonly repository: MemoryRepository;
  readonly idGenerator?: IdGenerator;
  readonly clock?: Clock;
}

export interface LinkMemoryRecordsInput {
  readonly sourceRecordId: string;
  readonly targetRecordId: string;
  readonly type: MemoryRelationType;
  readonly reason?: string;
  readonly evidence?: readonly string[];
  readonly confidence?: number;
}

export interface LinkMemoryResourceInput {
  readonly sourceRecordId: string;
  readonly targetUri: string;
  readonly type: MemoryRelationType;
  readonly reason?: string;
  readonly evidence?: readonly string[];
  readonly confidence?: number;
}

export class MemoryRelationService {
  private readonly repository: MemoryRepository;
  private readonly idGenerator: IdGenerator;
  private readonly clock: Clock;

  constructor(options: MemoryRelationServiceOptions) {
    this.repository = options.repository;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  linkRecords(input: LinkMemoryRecordsInput): MemoryRelation {
    return this.repository.transaction(() => {
      const source = this.repository.getRecord(requireText(input.sourceRecordId, "Memory relation source record id is required"));
      if (!source) {
        throw new Error("Memory relation source record was not found");
      }

      const target = this.repository.getRecord(requireText(input.targetRecordId, "Memory relation target record id is required"));
      if (!target) {
        throw new Error("Memory relation target record was not found");
      }

      if (source.scope.kind !== target.scope.kind || source.scope.id !== target.scope.id) {
        throw new Error("Memory relation cannot cross scopes");
      }

      return this.saveRelation({
        sourceRecordId: source.id,
        target: { kind: "memory_record", id: target.id },
        type: input.type,
        reason: input.reason,
        evidence: input.evidence,
        confidence: input.confidence,
      });
    });
  }

  linkResource(input: LinkMemoryResourceInput): MemoryRelation {
    return this.repository.transaction(() => {
      const sourceRecordId = requireText(input.sourceRecordId, "Memory relation source record id is required");
      if (!this.repository.getRecord(sourceRecordId)) {
        throw new Error("Memory relation source record was not found");
      }

      return this.saveRelation({
        sourceRecordId,
        target: { kind: "resource", uri: requireText(input.targetUri, "Memory relation target URI is required") },
        type: input.type,
        reason: input.reason,
        evidence: input.evidence,
        confidence: input.confidence,
      });
    });
  }

  private saveRelation(input: {
    readonly sourceRecordId: string;
    readonly target: MemoryRelationTarget;
    readonly type: MemoryRelationType;
    readonly reason?: string;
    readonly evidence?: readonly string[];
    readonly confidence?: number;
  }): MemoryRelation {
    return this.repository.saveRelation({
      id: this.idGenerator(),
      sourceRecordId: input.sourceRecordId,
      target: input.target,
      type: input.type,
      reason: input.reason,
      evidence: input.evidence,
      confidence: input.confidence,
      createdAt: this.clock(),
    });
  }
}

function requireText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
