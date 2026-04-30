import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  EventBus,
  MemoryMutationService,
  SqliteMemoryRepository,
  type CreateMemoryRecordInput,
  type KilnEvent,
  type MemoryRepository,
} from "../../src/index.js";

describe("MemoryMutationService", () => {
  let tmpDir: string;
  let repository: MemoryRepository;
  let eventBus: EventBus;
  let events: KilnEvent[];
  let service: MemoryMutationService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-mutation-service-"));
    repository = new SqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    eventBus = new EventBus();
    events = [];
    eventBus.onAny((event) => events.push(event));
    service = new MemoryMutationService({
      repository,
      eventBus,
      sessionId: "session-memory-test",
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("emits record lifecycle events from the service layer", () => {
    const created = service.saveRecord(recordInput({ content: "Memory Lattice graph contract." }));
    service.saveRecord(recordInput({
      id: created.id,
      content: "Memory Lattice graph contract updated.",
    }));
    service.deleteRecord(created.id);

    expect(events.map((event) => event.type)).toEqual([
      "memory_record_created",
      "memory_record_updated",
      "memory_record_deleted",
    ]);
    expect(events[0]).toMatchObject({
      type: "memory_record_created",
      sessionId: "session-memory-test",
      recordId: created.id,
      scope: { kind: "project", id: "kiln" },
      layer: "semantic",
    });
  });

  it("emits relation, revision, and context admission events without repository side effects", () => {
    const source = service.saveRecord(recordInput({ id: "source", content: "Source memory.", topicKey: "source" }));
    const target = service.saveRecord(recordInput({ id: "target", content: "Target memory.", topicKey: "target" }));
    events = [];

    service.saveRelation({
      id: "source-supports-target",
      sourceRecordId: source.id,
      target: { kind: "memory_record", id: target.id },
      type: "supports",
      createdAt: "2026-04-30T12:00:00.000Z",
    });
    service.saveRevision({
      id: "source-revision-1",
      recordId: source.id,
      sequence: 1,
      kind: "created",
      content: source.content,
      createdAt: "2026-04-30T12:00:01.000Z",
    });
    service.saveContextAdmission({
      id: "source-admission",
      recordId: source.id,
      sessionId: "session-memory-test",
      decision: "admitted",
      reason: "Relevant to current graph inspection.",
      estimatedTokens: 12,
      baseScore: 0.8,
      effectiveScore: 0.9,
      createdAt: "2026-04-30T12:00:02.000Z",
    });

    expect(events.map((event) => event.type)).toEqual([
      "memory_relation_created",
      "memory_revision_created",
      "memory_context_admitted",
    ]);
    expect(events[0]).toMatchObject({
      type: "memory_relation_created",
      relationId: "source-supports-target",
      sourceRecordId: source.id,
      targetRecordId: target.id,
      relationType: "supports",
      scope: { kind: "project", id: "kiln" },
    });
  });
});

function recordInput(overrides: {
  readonly id?: string;
  readonly content: string;
  readonly topicKey?: string;
}): CreateMemoryRecordInput {
  return {
    ...(overrides.id ? { id: overrides.id } : {}),
    layer: "semantic",
    scope: { kind: "project", id: "kiln" },
    content: overrides.content,
    topicKey: overrides.topicKey ?? "memory-lattice-test",
    tags: ["memory-lattice"],
    provenance: {
      sourceType: "operator",
      sourceId: "mutation-service-test",
      capturedAt: "2026-04-30T12:00:00.000Z",
    },
    createdAt: "2026-04-30T12:00:00.000Z",
  };
}
