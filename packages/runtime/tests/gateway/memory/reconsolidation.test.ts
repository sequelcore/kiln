import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteMemoryRepository } from "../../../src/index.js";
import {
  MemoryReconsolidationService,
  MemoryRelationService,
  type CreateMemoryRecordInput,
  type MemoryProvenance,
  type MemoryRepository,
} from "@kilnai/core/memory";

describe("MemoryReconsolidationService", () => {
  let tmpDir: string;
  let repository: MemoryRepository;
  let relations: MemoryRelationService;
  let service: MemoryReconsolidationService;
  let sequence = 0;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-reconsolidation-"));
    repository = createSqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    relations = new MemoryRelationService({
      repository,
      idGenerator: () => `relation-${++sequence}`,
      clock: () => "2026-04-30T12:00:00.000Z",
    });
    service = new MemoryReconsolidationService({
      repository,
      relations,
      idGenerator: () => `memory-${++sequence}`,
      revisionIdGenerator: () => `revision-${++sequence}`,
      clock: () => "2026-04-30T12:00:00.000Z",
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
    sequence = 0;
  });

  it("corrects a record only when scope and topic match", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Memory lattice belongs in the GUI.",
      topicKey: "architecture/memory-lattice",
    }));

    const result = service.correct({
      scope: original.scope,
      topicKey: "architecture/memory-lattice",
      content: "Memory Lattice belongs in core and is rendered by the GUI.",
      provenance: provenance("correction"),
      reason: "Architecture correction from ADR-008.",
    });

    expect(result.record.id).toBe(original.id);
    expect(result.record.content).toBe("Memory Lattice belongs in core and is rendered by the GUI.");
    expect(result.revision.reason).toBe("Architecture correction from ADR-008.");
    const revisions = repository.listRevisions(original.id);
    expect(revisions.map((revision) => revision.kind)).toEqual(["created", "corrected"]);
    expect(revisions.map((revision) => revision.content)).toEqual([
      "Memory lattice belongs in the GUI.",
      "Memory Lattice belongs in core and is rendered by the GUI.",
    ]);
    expect(revisions.map((revision) => revision.provenance.sourceId)).toEqual([original.provenance.sourceId, "correction"]);
    expect(revisions[1]!.parentRevisionId).toBe(revisions[0]!.id);
  });

  it("rejects correction without matching scope plus topic or explicit relation", () => {
    repository.saveRecord(recordInput({
      id: "record-1",
      content: "Scoped memory",
      topicKey: "architecture/scoped",
    }));

    expect(() =>
      service.correct({
        scope: { kind: "project", id: "other" },
        topicKey: "architecture/scoped",
        content: "Wrong scope write",
        provenance: provenance("wrong-scope"),
      }),
    ).toThrow("Memory reconsolidation target was not found");
  });

  it("rejects correction by record id when the supplied topic does not match", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Scoped memory",
      topicKey: "architecture/scoped",
    }));

    expect(() =>
      service.correct({
        recordId: original.id,
        scope: original.scope,
        topicKey: "architecture/other",
        content: "Wrong topic write",
        provenance: provenance("wrong-topic"),
      }),
    ).toThrow("Memory reconsolidation target was not found");
  });

  it("rejects blank topic selectors when correcting by record id", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Scoped memory",
      topicKey: "architecture/scoped",
    }));

    expect(() =>
      service.correct({
        recordId: original.id,
        topicKey: "",
        content: "Blank topic write",
        provenance: provenance("blank-topic"),
      }),
    ).toThrow("Memory reconsolidation topic key is required");
  });

  it("rolls back record updates when revision persistence fails", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Original content.",
      topicKey: "architecture/atomicity",
    }));
    const failingService = new MemoryReconsolidationService({
      repository,
      relations,
      revisionIdGenerator: () => "duplicate-revision",
      clock: () => "2026-04-30T12:00:00.000Z",
    });

    expect(() =>
      failingService.correct({
        scope: original.scope,
        topicKey: "architecture/atomicity",
        content: "Partially persisted content.",
        provenance: provenance("atomicity"),
      }),
    ).toThrow();

    expect(repository.getRecord(original.id)!.content).toBe("Original content.");
    expect(repository.listRevisions(original.id)).toEqual([]);
  });

  it("extends a record without losing revision lineage", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Memory Lattice uses scoped records.",
      topicKey: "architecture/memory-lattice",
    }));

    const result = service.extend({
      scope: original.scope,
      topicKey: "architecture/memory-lattice",
      content: "It also records revision provenance.",
      provenance: provenance("extension"),
    });

    expect(result.record.content).toContain("Memory Lattice uses scoped records.");
    expect(result.record.content).toContain("It also records revision provenance.");
    expect(repository.listRevisions(original.id).map((revision) => revision.kind)).toEqual(["created", "extended"]);
  });

  it("records noop reconsolidation without rewriting content", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Stable memory fact.",
      topicKey: "architecture/stable",
    }));

    const result = service.noop({
      scope: original.scope,
      topicKey: "architecture/stable",
      provenance: provenance("noop"),
      reason: "Candidate had no material change.",
    });

    expect(result.record.content).toBe("Stable memory fact.");
    expect(result.revision.reason).toBe("Candidate had no material change.");
    expect(repository.listRevisions(original.id).map((revision) => revision.kind)).toEqual(["created", "noop"]);
  });

  it("creates contradiction records and relations without overwriting the target", () => {
    const target = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Memory admission can bypass ContextGovernor.",
      topicKey: "context/admission",
    }));

    const result = service.contradict({
      targetRecordId: target.id,
      content: "Memory admission must be owned by ContextGovernor.",
      topicKey: "context/admission/contradiction",
      provenance: provenance("contradiction"),
      reason: "Context ownership correction.",
      evidence: ["ADR-008"],
    });

    expect(repository.getRecord(target.id)!.content).toBe("Memory admission can bypass ContextGovernor.");
    expect(result.record.id).not.toBe(target.id);
    expect(result.relation.type).toBe("contradicts");
    expect(result.relation.sourceRecordId).toBe(result.record.id);
    expect(result.relation.target).toEqual({ kind: "memory_record", id: target.id });
  });

  it("supersedes records while keeping the old record inspectable", () => {
    const target = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Old Memory Lattice persistence shape.",
      topicKey: "memory/persistence/old",
    }));

    const result = service.supersede({
      targetRecordId: target.id,
      content: "Memory Lattice uses memory_records with provenance and revisions.",
      topicKey: "memory/persistence/current",
      provenance: provenance("supersession"),
      reason: "SQLite repository replacement completed.",
      evidence: ["Slice 01.C"],
    });

    expect(repository.getRecord(target.id)).toBeDefined();
    expect(result.record.id).not.toBe(target.id);
    expect(result.relation.type).toBe("supersedes");
    expect(result.relation.target).toEqual({ kind: "memory_record", id: target.id });
  });

  it("requires provenance for every mutation", () => {
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Provenance required.",
      topicKey: "memory/provenance",
    }));

    expect(() =>
      service.correct({
        scope: original.scope,
        topicKey: "memory/provenance",
        content: "Missing provenance is invalid.",
        provenance: undefined as never,
      }),
    ).toThrow("Memory reconsolidation provenance is required");
  });

  it("uses valid default id generators", () => {
    const defaultService = new MemoryReconsolidationService({ repository });
    const original = repository.saveRecord(recordInput({
      id: "record-1",
      content: "Default UUIDs work.",
      topicKey: "memory/default-ids",
    }));

    const result = defaultService.correct({
      scope: original.scope,
      topicKey: "memory/default-ids",
      content: "Default UUID callbacks stay bound.",
      provenance: provenance("default-ids"),
    });

    expect(result.revision.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("MemoryRelationService", () => {
  let tmpDir: string;
  let repository: MemoryRepository;
  let service: MemoryRelationService;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-relations-"));
    repository = createSqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    service = new MemoryRelationService({
      repository,
      idGenerator: () => "relation-1",
      clock: () => "2026-04-30T12:00:00.000Z",
    });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates scoped relations between existing records", () => {
    const source = repository.saveRecord(recordInput({
      id: "source",
      content: "A supports B.",
      topicKey: "a",
    }));
    const target = repository.saveRecord(recordInput({
      id: "target",
      content: "B is supported.",
      topicKey: "b",
    }));

    const relation = service.linkRecords({
      sourceRecordId: source.id,
      targetRecordId: target.id,
      type: "supports",
      reason: "Evidence chain.",
      evidence: ["test"],
      confidence: 0.9,
    });

    expect(relation.type).toBe("supports");
    expect(repository.listRelations(source.id)).toEqual([relation]);
  });

  it("rejects cross-scope record relations", () => {
    const source = repository.saveRecord(recordInput({
      id: "source",
      content: "Project memory.",
      topicKey: "a",
    }));
    const target = repository.saveRecord(recordInput({
      id: "target",
      content: "Tenant memory.",
      scopeKind: "tenant",
      scopeId: "tenant-a",
      topicKey: "b",
    }));

    expect(() =>
      service.linkRecords({
        sourceRecordId: source.id,
        targetRecordId: target.id,
        type: "related_to",
      }),
    ).toThrow("Memory relation cannot cross scopes");
  });

  it("uses a valid default relation id generator", () => {
    const defaultService = new MemoryRelationService({ repository });
    const source = repository.saveRecord(recordInput({
      id: "source",
      content: "A supports B.",
      topicKey: "a",
    }));
    const target = repository.saveRecord(recordInput({
      id: "target",
      content: "B is supported.",
      topicKey: "b",
    }));

    const relation = defaultService.linkRecords({
      sourceRecordId: source.id,
      targetRecordId: target.id,
      type: "supports",
    });

    expect(relation.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

function recordInput(overrides: {
  readonly id: string;
  readonly content: string;
  readonly scopeKind?: CreateMemoryRecordInput["scope"]["kind"];
  readonly scopeId?: string;
  readonly topicKey: string;
}): CreateMemoryRecordInput {
  return {
    id: overrides.id,
    layer: "semantic",
    scope: {
      kind: overrides.scopeKind ?? "project",
      id: overrides.scopeId ?? "kiln",
    },
    content: overrides.content,
    tags: ["memory"],
    topicKey: overrides.topicKey,
    provenance: provenance("seed"),
  };
}

function provenance(sourceId: string): MemoryProvenance {
  return {
    sourceType: "operator",
    sourceId,
    actor: "Alex Rivera",
    capturedAt: "2026-04-30T12:00:00.000Z",
  };
}
