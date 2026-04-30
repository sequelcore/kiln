import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SqliteMemoryRepository,
  type CreateMemoryRecordInput,
} from "../../src/memory/index.js";

describe("SqliteMemoryRepository", () => {
  let tmpDir: string;
  let dbPath: string;
  let repository: SqliteMemoryRepository;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-lattice-"));
    dbPath = join(tmpDir, "memory.db");
    repository = new SqliteMemoryRepository({ dbPath });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the final Memory Lattice tables without legacy memory tables", () => {
    const db = new Database(dbPath, { readonly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'virtual') ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    db.close();

    expect(tables).toContain("memory_records");
    expect(tables).toContain("memory_revisions");
    expect(tables).toContain("memory_relations");
    expect(tables).toContain("memory_sources");
    expect(tables).toContain("memory_context_admissions");
    expect(tables).toContain("memory_fts");
    expect(tables).toContain("memory_archive");
    expect(tables).not.toContain("memories");
    expect(tables).not.toContain("memories_fts");
  });

  it("saves and searches scoped domain records", async () => {
    const saved = await repository.saveRecord(recordInput({
      content: "Kiln memory stores governed context evidence.",
      scopeId: "kiln",
      tags: ["memory", "governance"],
      topicKey: "architecture/memory-lattice",
    }));

    const results = await repository.searchRecords({
      query: "governed context",
      scope: { kind: "project", id: "kiln" },
      limit: 10,
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.record).toEqual(saved);
    expect(results[0]!.record.scope).toEqual({ kind: "project", id: "kiln" });
    expect(results[0]!.record.layer).toBe("semantic");
    expect(results[0]!.snippet).toBeDefined();
  });

  it("keeps scopes isolated inside the same database", async () => {
    await repository.saveRecord(recordInput({
      content: "Tenant A deployment token rules",
      scopeKind: "tenant",
      scopeId: "tenant-a",
      topicKey: "security/deployment-token",
    }));
    await repository.saveRecord(recordInput({
      content: "Tenant B billing rule set",
      scopeKind: "tenant",
      scopeId: "tenant-b",
      topicKey: "billing/rules",
    }));

    const tenantAResults = await repository.searchRecords({
      query: "token rules",
      scope: { kind: "tenant", id: "tenant-a" },
      limit: 10,
    });
    const tenantBResults = await repository.searchRecords({
      query: "token rules",
      scope: { kind: "tenant", id: "tenant-b" },
      limit: 10,
    });

    expect(tenantAResults.map((result) => result.record.scope.id)).toEqual(["tenant-a"]);
    expect(tenantBResults).toHaveLength(0);
  });

  it("stores revision lineage for a record", async () => {
    const saved = await repository.saveRecord(recordInput({
      content: "Initial memory lattice decision.",
      scopeId: "kiln",
    }));

    const createdRevision = await repository.saveRevision({
      id: "revision-1",
      recordId: saved.id,
      sequence: 1,
      kind: "created",
      content: saved.content,
      createdAt: "2026-04-30T10:00:00.000Z",
    });
    const extendedRevision = await repository.saveRevision({
      id: "revision-2",
      recordId: saved.id,
      parentRevisionId: createdRevision.id,
      sequence: 2,
      kind: "extended",
      content: "Initial memory lattice decision with scoped repository.",
      createdAt: "2026-04-30T10:05:00.000Z",
    });

    const revisions = await repository.listRevisions(saved.id);

    expect(revisions).toEqual([createdRevision, extendedRevision]);
  });

  it("stores typed relations without allowing cross-record ambiguity", async () => {
    const source = await repository.saveRecord(recordInput({
      content: "Memory Lattice requires provenance.",
      scopeId: "kiln",
      topicKey: "memory/provenance",
    }));
    const target = await repository.saveRecord(recordInput({
      content: "Context admission is owned by ContextGovernor.",
      scopeId: "kiln",
      topicKey: "context/admission",
    }));

    const relation = await repository.saveRelation({
      id: "relation-1",
      sourceRecordId: source.id,
      target: { kind: "memory_record", id: target.id },
      type: "supports",
      reason: "Provenance supports later admission audit.",
      evidence: ["ADR-008"],
      confidence: 0.9,
      createdAt: "2026-04-30T10:10:00.000Z",
    });

    const relations = await repository.listRelations(source.id);

    expect(relations).toEqual([relation]);
  });
});

function recordInput(overrides: {
  readonly content: string;
  readonly scopeKind?: CreateMemoryRecordInput["scope"]["kind"];
  readonly scopeId: string;
  readonly tags?: readonly string[];
  readonly topicKey?: string;
}): CreateMemoryRecordInput {
  return {
    layer: "semantic",
    scope: {
      kind: overrides.scopeKind ?? "project",
      id: overrides.scopeId,
    },
    content: overrides.content,
    tags: overrides.tags ?? [],
    topicKey: overrides.topicKey,
    provenance: {
      sourceType: "operator",
      sourceId: "ricardo",
      actor: "Ricardo Armenta",
      capturedAt: "2026-04-30T09:00:00.000Z",
    },
    confidence: 0.8,
  };
}
