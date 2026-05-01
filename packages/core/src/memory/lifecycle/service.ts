import type {
  MemoryRecord,
  MemoryScope,
} from "../domain/index.js";
import type { MemoryMutationService } from "../service.js";
import type { MemoryRepository } from "../repository.js";
import {
  validateMemoryLifecycleAction,
  type MemoryLifecycleAction,
  type MemoryLifecycleActionType,
} from "./policy.js";

type IdGenerator = () => string;
type Clock = () => string;

export interface MemoryLifecycleApplicationServiceOptions {
  readonly repository: MemoryRepository;
  readonly mutationService: MemoryMutationService;
  readonly idGenerator?: IdGenerator;
  readonly relationIdGenerator?: IdGenerator;
  readonly clock?: Clock;
}

export type MemoryLifecycleApplyStatus = "applied" | "deferred" | "noop";

export interface MemoryLifecycleApplicationResult {
  readonly status: MemoryLifecycleApplyStatus;
  readonly actionType: MemoryLifecycleActionType;
  readonly recordId: string;
  readonly reason?: string;
  readonly createdRecordIds: readonly string[];
  readonly createdRelationIds: readonly string[];
  readonly deletedRecordIds: readonly string[];
}

const RECALL_DEFERRED_REASON = "Recall salience persistence is owned by the recall lifecycle slice.";

export class MemoryLifecycleApplicationService {
  private readonly repository: MemoryRepository;
  private readonly mutationService: MemoryMutationService;
  private readonly idGenerator: IdGenerator;
  private readonly relationIdGenerator: IdGenerator;
  private readonly clock: Clock;

  constructor(options: MemoryLifecycleApplicationServiceOptions) {
    this.repository = options.repository;
    this.mutationService = options.mutationService;
    this.idGenerator = options.idGenerator ?? (() => crypto.randomUUID());
    this.relationIdGenerator = options.relationIdGenerator ?? (() => crypto.randomUUID());
    this.clock = options.clock ?? (() => new Date().toISOString());
  }

  apply(input: MemoryLifecycleAction): MemoryLifecycleApplicationResult {
    const action = validateMemoryLifecycleAction(input);
    const target = this.resolveTarget(action);

    switch (action.type) {
      case "archive":
        return this.deleteTarget(action, target);
      case "forget":
        return action.mode === "redact"
          ? this.redactTarget(action, target)
          : this.deleteTarget(action, target);
      case "promote":
        return this.promoteTarget(action, target);
      case "create_derived_summary":
        return this.createDerivedSummary(action, target);
      case "lower_recall_salience":
        return result({
          status: "deferred",
          actionType: action.type,
          recordId: target.id,
          reason: RECALL_DEFERRED_REASON,
        });
      case "retain":
        return result({
          status: "noop",
          actionType: action.type,
          recordId: target.id,
          reason: action.reason,
        });
      case "compact":
        return result({
          status: "deferred",
          actionType: action.type,
          recordId: target.id,
          reason: "Direct compaction is applied through create_derived_summary lifecycle actions.",
        });
    }
  }

  private deleteTarget(
    action: MemoryLifecycleAction & { readonly type: "archive" | "forget" },
    target: MemoryRecord,
  ): MemoryLifecycleApplicationResult {
    const deleted = this.mutationService.deleteRecord(target.id);
    return result({
      status: deleted ? "applied" : "noop",
      actionType: action.type,
      recordId: target.id,
      deletedRecordIds: deleted ? [target.id] : [],
    });
  }

  private redactTarget(
    action: MemoryLifecycleAction & { readonly type: "forget" },
    target: MemoryRecord,
  ): MemoryLifecycleApplicationResult {
    this.mutationService.saveRecord({
      id: target.id,
      layer: target.layer,
      scope: target.scope,
      content: "[redacted by memory lifecycle policy]",
      topicKey: target.topicKey,
      tags: appendTags(target.tags, ["lifecycle:redacted"]),
      provenance: {
        sourceType: "agent",
        sourceId: action.policyId,
        capturedAt: this.clock(),
      },
      confidence: target.confidence,
      createdAt: target.createdAt,
    });
    return result({
      status: "applied",
      actionType: action.type,
      recordId: target.id,
    });
  }

  private promoteTarget(
    action: MemoryLifecycleAction & { readonly type: "promote" },
    target: MemoryRecord,
  ): MemoryLifecycleApplicationResult {
    return this.repository.transaction(() => {
      const promoted = this.mutationService.saveRecord({
        id: this.idGenerator(),
        layer: action.targetLayer,
        scope: target.scope,
        content: target.content,
        topicKey: target.topicKey,
        tags: appendTags(target.tags, ["lifecycle:promoted"]),
        provenance: {
          sourceType: "agent",
          sourceId: action.policyId,
          capturedAt: this.clock(),
        },
        confidence: target.confidence,
        createdAt: this.clock(),
      });
      const relation = this.mutationService.saveRelation({
        id: this.relationIdGenerator(),
        sourceRecordId: promoted.id,
        target: { kind: "memory_record", id: target.id },
        type: "derived_from",
        reason: action.reason,
        createdAt: this.clock(),
      });

      return result({
        status: "applied",
        actionType: action.type,
        recordId: target.id,
        createdRecordIds: [promoted.id],
        createdRelationIds: [relation.id],
      });
    });
  }

  private createDerivedSummary(
    action: MemoryLifecycleAction & { readonly type: "create_derived_summary" },
    target: MemoryRecord,
  ): MemoryLifecycleApplicationResult {
    const topicKey = requiredText(target.topicKey ?? "", "Memory lifecycle summary requires a topic key");
    const sourceRecords = this.repository
      .listRecords({ scope: target.scope, layer: target.layer, limit: 500 })
      .filter((record) => record.topicKey === topicKey)
      .sort(compareRecordsById);

    return this.repository.transaction(() => {
      const summary = this.mutationService.saveRecord({
        id: this.idGenerator(),
        layer: action.targetLayer,
        scope: target.scope,
        content: formatSummary(topicKey, sourceRecords),
        topicKey,
        tags: appendTags(target.tags, ["lifecycle:derived-summary"]),
        provenance: {
          sourceType: "agent",
          sourceId: action.policyId,
          capturedAt: this.clock(),
        },
        confidence: target.confidence,
        createdAt: this.clock(),
      });
      const relations = sourceRecords.map((record) =>
        this.mutationService.saveRelation({
          id: this.relationIdGenerator(),
          sourceRecordId: summary.id,
          target: { kind: "memory_record", id: record.id },
          type: "derived_from",
          reason: action.reason,
          createdAt: this.clock(),
        }));

      return result({
        status: "applied",
        actionType: action.type,
        recordId: target.id,
        createdRecordIds: [summary.id],
        createdRelationIds: relations.map((relation) => relation.id),
      });
    });
  }

  private resolveTarget(action: MemoryLifecycleAction): MemoryRecord {
    const target = this.repository.getRecord(action.recordId);
    if (!target || target.layer !== action.layer || !sameScope(target.scope, action.scope)) {
      throw new Error("Memory lifecycle action target was not found");
    }
    return target;
  }
}

function result(input: {
  readonly status: MemoryLifecycleApplyStatus;
  readonly actionType: MemoryLifecycleActionType;
  readonly recordId: string;
  readonly reason?: string;
  readonly createdRecordIds?: readonly string[];
  readonly createdRelationIds?: readonly string[];
  readonly deletedRecordIds?: readonly string[];
}): MemoryLifecycleApplicationResult {
  return {
    status: input.status,
    actionType: input.actionType,
    recordId: input.recordId,
    ...(input.reason ? { reason: input.reason } : {}),
    createdRecordIds: input.createdRecordIds ?? [],
    createdRelationIds: input.createdRelationIds ?? [],
    deletedRecordIds: input.deletedRecordIds ?? [],
  };
}

function sameScope(left: MemoryScope, right: MemoryScope): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function appendTags(existing: readonly string[], additional: readonly string[]): readonly string[] {
  return [...new Set([...existing, ...additional].map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
}

function formatSummary(topicKey: string, records: readonly MemoryRecord[]): string {
  return `Lifecycle summary for topic ${topicKey}.\n\n${records.map((record) => `- ${record.content}`).join("\n")}`;
}

function compareRecordsById(left: Pick<MemoryRecord, "id">, right: Pick<MemoryRecord, "id">): number {
  return left.id.localeCompare(right.id);
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(message);
  }
  return trimmed;
}
