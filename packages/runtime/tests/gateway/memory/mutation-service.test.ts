import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteMemoryRepository } from "../../../src/index.js";
import {
  defineMemoryAuthorityPolicy,
  governedMemoryAuthority,
  EventBus,
  MemoryMutationService,
  trustedInternalMemoryAuthority,
  type CreateMemoryRecordInput,
  type KilnEvent,
  type MemoryLayerKind,
  type MemoryRepository,
} from "@kilnai/core";

describe("MemoryMutationService", () => {
  let tmpDir: string;
  let repository: MemoryRepository;
  let eventBus: EventBus;
  let events: KilnEvent[];
  let service: MemoryMutationService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-mutation-service-"));
    repository = createSqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    eventBus = new EventBus();
    events = [];
    eventBus.onAny((event) => events.push(event));
    service = new MemoryMutationService({
      repository,
      eventBus,
      sessionId: "session-memory-test",
      authority: trustedInternalMemoryAuthority(),
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
      provenance: source.provenance,
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

  it("allows save when write authority explicitly matches scope and layer", () => {
    const serviceWithAuthority = new MemoryMutationService({
      repository,
      authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-1a" },
        rules: [{
          access: "write",
          operations: ["save"],
          scopeKinds: ["project"],
          scopeIds: ["kiln"],
          layers: ["semantic"],
        }],
      })),
    });

    const record = serviceWithAuthority.saveRecord(recordInput({ content: "Authorized memory write." }));
    expect(record.scope).toEqual({ kind: "project", id: "kiln" });
    expect(record.layer).toBe("semantic");
  });

  it("enforces governed durable-write admission at the mutation boundary", () => {
    const input = { ...recordInput({ content: "Governed durable memory write." }), confidence: 0.9 };
    const common = {
      durability: "durable" as const,
      contradictionState: "none" as const,
      canonicalEvidenceUris: ["kiln://artifacts/memory/source/content"],
    };

    expect(() => service.saveRecord(input, {
      ...common,
      futureTaskValue: 0.2,
      derivativeTrust: "original",
    })).toThrow("Memory write defer");
    expect(repository.countRecords()).toBe(0);

    expect(() => service.saveRecord(input, {
      ...common,
      futureTaskValue: 1,
      derivativeTrust: "untrusted",
    })).toThrow("Memory write reject");
    expect(repository.countRecords()).toBe(0);

    const saved = service.saveRecord(input, {
      ...common,
      futureTaskValue: 1,
      derivativeTrust: "original",
    });
    expect(saved.content).toBe(input.content);
  });

  it("denies save when authority does not allow the scope", () => {
    const serviceWithAuthority = new MemoryMutationService({
      repository,
      authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-1a" },
        rules: [{
          access: "write",
          operations: ["save"],
          scopeKinds: ["project"],
          scopeIds: ["kiln"],
          layers: ["semantic"],
        }],
      })),
    });

    expect(() => serviceWithAuthority.saveRecord(recordInput({
      content: "Wrong scope write.",
      scopeId: "other-project",
    }))).toThrow("scope is not authorized");
  });

  it("denies save when authority does not allow the layer", () => {
    const serviceWithAuthority = new MemoryMutationService({
      repository,
      authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-1a" },
        rules: [{
          access: "write",
          operations: ["save"],
          scopeKinds: ["project"],
          scopeIds: ["kiln"],
          layers: ["semantic"],
        }],
      })),
    });

    expect(() => serviceWithAuthority.saveRecord(recordInput({
      content: "Wrong layer write.",
      layer: "episodic",
    }))).toThrow("layer is not authorized");
  });

  it("denies audit writes unless explicitly allowed by authority", () => {
    const deniedAuditService = new MemoryMutationService({
      repository,
      authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-1a" },
        rules: [{
          access: "write",
          operations: ["save"],
          scopeKinds: ["project"],
          scopeIds: ["kiln"],
          layers: ["audit"],
        }],
      })),
    });

    expect(() => deniedAuditService.saveRecord(recordInput({
      content: "Audit write should fail.",
      layer: "audit",
    }))).toThrow("audit layer requires explicit permission");

    const allowedAuditService = new MemoryMutationService({
      repository,
      authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-1a" },
        rules: [{
          access: "write",
          operations: ["save"],
          scopeKinds: ["project"],
          scopeIds: ["kiln"],
          layers: ["audit"],
          allowAuditWrite: true,
        }],
      })),
    });

    const saved = allowedAuditService.saveRecord(recordInput({
      content: "Audit write allowed.",
      layer: "audit",
    }));
    expect(saved.layer).toBe("audit");
  });

  it("checks authority for every mutation operation, not only record saves", () => {
    const source = repository.saveRecord(recordInput({ id: "authority-source", content: "Source." }));
    const denied = new MemoryMutationService({
      repository,
      authority: governedMemoryAuthority(defineMemoryAuthorityPolicy({
        caller: { kind: "agent", id: "worker-denied" },
        rules: [],
      })),
    });

    expect(() => denied.deleteRecord(source.id)).toThrow("operation is not authorized");
    expect(() => denied.saveRelation({
      id: "denied-relation",
      sourceRecordId: source.id,
      target: { kind: "resource", uri: "kiln://resource" },
      type: "related_to",
      createdAt: "2026-04-30T12:00:00.000Z",
    })).toThrow("operation is not authorized");
    expect(() => denied.saveRevision({
      id: "denied-revision",
      recordId: source.id,
      sequence: 1,
      kind: "created",
      content: source.content,
      provenance: source.provenance,
      createdAt: "2026-04-30T12:00:00.000Z",
    })).toThrow("operation is not authorized");
    expect(() => denied.saveContextAdmission({
      id: "denied-admission",
      recordId: source.id,
      decision: "admitted",
      reason: "test",
      estimatedTokens: 1,
      baseScore: 1,
      effectiveScore: 1,
      createdAt: "2026-04-30T12:00:00.000Z",
    })).toThrow("operation is not authorized");

    expect(repository.getRecord(source.id)).toBeDefined();
    expect(repository.getRelation("denied-relation")).toBeUndefined();
    expect(repository.listRevisions(source.id)).toHaveLength(0);
    expect(repository.listContextAdmissions({ recordId: source.id })).toHaveLength(0);
  });
});

function recordInput(overrides: {
  readonly id?: string;
  readonly content: string;
  readonly topicKey?: string;
  readonly layer?: MemoryLayerKind;
  readonly scopeKind?: "project" | "tenant";
  readonly scopeId?: string;
}): CreateMemoryRecordInput {
  return {
    ...(overrides.id ? { id: overrides.id } : {}),
    layer: overrides.layer ?? "semantic",
    scope: { kind: overrides.scopeKind ?? "project", id: overrides.scopeId ?? "kiln" },
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
