import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EventBus,
  trustedInternalMemoryAuthority,
  MemoryLifecycleApplicationService,
  MemoryMutationService,
  SqliteMemoryRepository,
  type KilnEvent,
  type MemoryLifecycleAction,
  type MemoryRepository,
} from "../../../src/index.js";

describe("MemoryLifecycleApplicationService", () => {
  let tmpDir: string;
  let repository: MemoryRepository;
  let eventBus: EventBus;
  let events: KilnEvent[];
  let mutationService: MemoryMutationService;
  let service: MemoryLifecycleApplicationService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-lifecycle-service-"));
    repository = new SqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    eventBus = new EventBus();
    events = [];
    eventBus.onAny((event) => events.push(event));
    mutationService = new MemoryMutationService({
      repository,
      eventBus,
      sessionId: "lifecycle-test",
      authority: trustedInternalMemoryAuthority(),
    });
    service = new MemoryLifecycleApplicationService({
      repository,
      mutationService,
      idGenerator: sequentialIds("life"),
      relationIdGenerator: sequentialIds("rel"),
      clock: () => "2026-05-01T00:00:00.000Z",
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("archives records through the governed mutation service", () => {
    const record = mutationService.saveRecord(recordInput({ id: "stale", layer: "coordination" }));
    events = [];

    const result = service.apply(action({
      type: "archive",
      recordId: record.id,
      layer: "coordination",
      policyId: "coordination-retention",
      reason: "Memory record exceeded retention window.",
    }));

    expect(result).toEqual({
      status: "applied",
      actionType: "archive",
      recordId: record.id,
      createdRecordIds: [],
      createdRelationIds: [],
      deletedRecordIds: [record.id],
    });
    expect(repository.getRecord(record.id)).toBeUndefined();
    expect(events.map((event) => event.type)).toEqual(["memory_record_deleted"]);
  });

  it("soft-deletes only the scoped target and emits bounded deletion event data", () => {
    const target = mutationService.saveRecord(recordInput({
      id: "forget-target",
      layer: "coordination",
      content: "sensitive content",
    }));
    const untouched = mutationService.saveRecord(recordInput({
      id: "keep-target",
      layer: "semantic",
      content: "should remain",
    }));
    events = [];

    const result = service.apply(action({
      type: "forget",
      mode: "soft_delete",
      recordId: target.id,
      layer: "coordination",
      policyId: "coordination-forgetting",
      reason: "Lifecycle forget policy applied.",
    }));

    expect(result).toEqual({
      status: "applied",
      actionType: "forget",
      recordId: target.id,
      createdRecordIds: [],
      createdRelationIds: [],
      deletedRecordIds: [target.id],
    });
    expect(repository.getRecord(target.id)).toBeUndefined();
    expect(repository.getRecord(untouched.id)).toMatchObject({ id: untouched.id });
    expect(events.map((event) => event.type)).toEqual(["memory_record_deleted"]);

    const [deletedEvent] = events;
    if (deletedEvent === undefined) throw new Error("expected deletion event");
    expect(deletedEvent).toMatchObject({
      type: "memory_record_deleted",
      recordId: target.id,
      scope: target.scope,
      layer: target.layer,
      sessionId: "lifecycle-test",
    });
    expect("content" in deletedEvent).toBe(false);
  });

  it("redacts forget targets in place and emits update events without deletion", () => {
    const target = mutationService.saveRecord(recordInput({
      id: "redact-target",
      layer: "episodic",
      content: "private source content",
      topicKey: "topic/redact",
    }));
    events = [];

    const result = service.apply(action({
      type: "forget",
      mode: "redact",
      recordId: target.id,
      layer: "episodic",
      policyId: "episodic-redaction",
      reason: "Lifecycle redact policy applied.",
    }));

    expect(result).toEqual({
      status: "applied",
      actionType: "forget",
      recordId: target.id,
      createdRecordIds: [],
      createdRelationIds: [],
      deletedRecordIds: [],
    });
    expect(repository.getRecord(target.id)).toMatchObject({
      id: target.id,
      content: "[redacted by memory lifecycle policy]",
      topicKey: "topic/redact",
      tags: ["memory-lifecycle", "lifecycle:redacted"],
    });
    expect(events.map((event) => event.type)).toEqual(["memory_record_updated"]);
    expect(events.some((event) => event.type === "memory_record_deleted")).toBe(false);
  });

  it("promotes a record by creating a governed derived record and relation", () => {
    const source = mutationService.saveRecord(recordInput({
      id: "source",
      layer: "episodic",
      content: "Lifecycle policy should promote repeated useful facts.",
      topicKey: "memory/lifecycle",
    }));
    events = [];

    const result = service.apply(action({
      type: "promote",
      recordId: source.id,
      layer: "episodic",
      targetLayer: "semantic",
      policyId: "episodic-promotion",
      reason: "Memory record met promotion criteria.",
    }));

    expect(result.status).toBe("applied");
    expect(result.createdRecordIds).toEqual(["life-1"]);
    expect(result.createdRelationIds).toEqual(["rel-1"]);

    const promoted = repository.getRecord("life-1");
    expect(promoted).toMatchObject({
      id: "life-1",
      layer: "semantic",
      scope: source.scope,
      content: source.content,
      topicKey: source.topicKey,
      tags: ["memory-lifecycle", "lifecycle:promoted"],
    });
    expect(repository.listRelations("life-1")).toMatchObject([{
      id: "rel-1",
      sourceRecordId: "life-1",
      target: { kind: "memory_record", id: source.id },
      type: "derived_from",
      reason: "Memory record met promotion criteria.",
    }]);
    expect(events.map((event) => event.type)).toEqual([
      "memory_record_created",
      "memory_relation_created",
    ]);
  });

  it("creates a derived summary from same-topic source records without rewriting sources", () => {
    const first = mutationService.saveRecord(recordInput({ id: "a", layer: "episodic", topicKey: "same" }));
    const second = mutationService.saveRecord(recordInput({ id: "b", layer: "episodic", topicKey: "same" }));
    mutationService.saveRecord(recordInput({ id: "other", layer: "episodic", topicKey: "other" }));
    events = [];

    const result = service.apply(action({
      type: "create_derived_summary",
      recordId: first.id,
      layer: "episodic",
      targetLayer: "semantic",
      policyId: "episodic-compaction",
      reason: "Memory topic group met compaction threshold.",
    }));

    expect(result.createdRecordIds).toEqual(["life-1"]);
    expect(result.createdRelationIds).toEqual(["rel-1", "rel-2"]);
    expect(repository.getRecord(first.id)?.content).toBe(first.content);
    expect(repository.getRecord(second.id)?.content).toBe(second.content);
    expect(repository.getRecord("life-1")).toMatchObject({
      layer: "semantic",
      topicKey: "same",
      content: "Lifecycle summary for topic same.\n\n- memory a\n- memory b",
    });
  });

  it("does not persist recall salience before the recall slice owns that state", () => {
    const record = mutationService.saveRecord(recordInput({ id: "salience", layer: "episodic" }));
    events = [];

    const result = service.apply(action({
      type: "lower_recall_salience",
      recordId: record.id,
      layer: "episodic",
      policyId: "episodic-decay",
      reason: "Memory record age exceeded decay half-life.",
      targetSalience: 0.2,
    }));

    expect(result).toEqual({
      status: "deferred",
      actionType: "lower_recall_salience",
      recordId: record.id,
      reason: "Recall salience persistence is owned by the recall lifecycle slice.",
      createdRecordIds: [],
      createdRelationIds: [],
      deletedRecordIds: [],
    });
    expect(events).toEqual([]);
  });

  it("rejects lifecycle actions when the current record scope or layer does not match", () => {
    const record = mutationService.saveRecord(recordInput({ id: "scoped", layer: "episodic" }));

    expect(() =>
      service.apply(action({
        type: "archive",
        recordId: record.id,
        layer: "semantic",
        policyId: "bad-policy",
        reason: "bad layer",
      })),
    ).toThrow("Memory lifecycle action target was not found");
  });

  it("rejects forget actions targeting the audit layer through validation", () => {
    expect(() =>
      service.apply(action({
        type: "forget",
        mode: "soft_delete",
        recordId: "audit-record",
        layer: "audit",
        policyId: "audit-forgetting",
        reason: "invalid forget action",
      })),
    ).toThrow("Audit memory cannot be forgotten by lifecycle policy");
  });
});

function recordInput(overrides: {
  readonly id: string;
  readonly layer: "episodic" | "coordination" | "semantic";
  readonly content?: string;
  readonly topicKey?: string;
}) {
  return {
    id: overrides.id,
    layer: overrides.layer,
    scope: { kind: "project", id: "kiln" } as const,
    content: overrides.content ?? `memory ${overrides.id}`,
    topicKey: overrides.topicKey ?? `topic/${overrides.id}`,
    tags: ["memory-lifecycle"],
    provenance: {
      sourceType: "operator" as const,
      sourceId: "lifecycle-service-test",
      capturedAt: "2026-05-01T00:00:00.000Z",
    },
    confidence: 0.8,
    createdAt: "2026-04-01T00:00:00.000Z",
  };
}

function action(overrides: Partial<MemoryLifecycleAction> & Pick<MemoryLifecycleAction, "type" | "recordId" | "layer" | "policyId" | "reason">): MemoryLifecycleAction {
  return {
    scope: { kind: "project", id: "kiln" },
    policyVersion: "2026-05-01",
    ...overrides,
  } as MemoryLifecycleAction;
}

function sequentialIds(prefix: string): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${next}`;
  };
}
