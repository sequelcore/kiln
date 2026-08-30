import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqliteMemoryRepository } from "../../../src/index.js";
import {
  MemoryGraphProjector,
  type CreateMemoryRecordInput,
  type MemoryProvenance,
  type MemoryRepository,
} from "@kilnai/core/memory";

describe("MemoryGraphProjector", () => {
  let tmpDir: string;
  let repository: MemoryRepository;
  let projector: MemoryGraphProjector;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "kiln-memory-graph-"));
    repository = createSqliteMemoryRepository({ dbPath: join(tmpDir, "memory.db") });
    projector = new MemoryGraphProjector({ repository });
  });

  afterEach(() => {
    repository.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns an empty bounded graph safely", () => {
    const snapshot = projector.project({
      limits: { maxNodes: 5, maxEdges: 5 },
    });

    expect(snapshot).toEqual({
      nodes: [],
      edges: [],
      limits: { maxNodes: 5, maxEdges: 5 },
      truncated: false,
    });
  });

  it("accepts the repository maximum seed limit without throwing", () => {
    const snapshot = projector.project({
      limits: { maxNodes: 500, maxEdges: 10 },
    });

    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.limits.maxNodes).toBe(500);
  });

  it("filters seed records by scope, layer, and query", () => {
    const semantic = repository.saveRecord(recordInput({
      id: "semantic-1",
      content: "Memory lattice semantic graph.",
      topicKey: "memory/lattice",
      layer: "semantic",
      scopeId: "kiln",
    }));
    repository.saveRecord(recordInput({
      id: "working-1",
      content: "Memory lattice working note.",
      topicKey: "memory/working",
      layer: "working",
      scopeId: "kiln",
    }));
    repository.saveRecord(recordInput({
      id: "other-scope",
      content: "Memory lattice semantic graph in another project.",
      topicKey: "memory/other",
      layer: "semantic",
      scopeId: "other",
    }));

    const snapshot = projector.project({
      scope: semantic.scope,
      layer: "semantic",
      query: "lattice",
      limits: { maxNodes: 10, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([semantic.id]);
    expect(snapshot.edges).toEqual([]);
  });

  it("walks memory-record relations up to the requested depth", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Child memory.", topicKey: "child" }));
    const grandchild = repository.saveRecord(recordInput({ id: "grandchild", content: "Grandchild memory.", topicKey: "grandchild" }));
    repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));
    repository.saveRelation(relationInput("relation-2", child.id, grandchild.id, "derived_from"));

    const depthOne = projector.project({
      rootRecordIds: [root.id],
      depth: 1,
      limits: { maxNodes: 10, maxEdges: 10 },
    });
    const depthTwo = projector.project({
      rootRecordIds: [root.id],
      depth: 2,
      limits: { maxNodes: 10, maxEdges: 10 },
    });

    expect(depthOne.nodes.map((node) => node.recordId)).toEqual([root.id, child.id]);
    expect(depthOne.edges.map((edge) => edge.id)).toEqual(["relation-1"]);
    expect(depthTwo.nodes.map((node) => node.recordId)).toEqual([root.id, child.id, grandchild.id]);
    expect(depthTwo.edges.map((edge) => edge.id)).toEqual(["relation-1", "relation-2"]);
  });

  it("does not surface soft-deleted relation targets in bounded projections", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const live = repository.saveRecord(recordInput({ id: "live", content: "Live memory.", topicKey: "live" }));
    const deleted = repository.saveRecord(recordInput({ id: "deleted", content: "Deleted memory.", topicKey: "deleted" }));
    repository.saveRelation(relationInput("relation-live", root.id, live.id, "supports"));
    repository.saveRelation(relationInput("relation-deleted", root.id, deleted.id, "supports"));
    repository.deleteRecord(deleted.id);

    const snapshot = projector.project({
      rootRecordIds: [root.id],
      depth: 1,
      limits: { maxNodes: 10, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([root.id, live.id]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(["relation-live"]);
  });

  it("filters relations by type before expanding targets", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const supported = repository.saveRecord(recordInput({ id: "supported", content: "Supported memory.", topicKey: "supported" }));
    const related = repository.saveRecord(recordInput({ id: "related", content: "Related memory.", topicKey: "related" }));
    repository.saveRelation(relationInput("relation-1", root.id, related.id, "related_to"));
    repository.saveRelation(relationInput("relation-2", root.id, supported.id, "supports"));

    const snapshot = projector.project({
      rootRecordIds: [root.id],
      depth: 1,
      relationTypes: ["supports"],
      limits: { maxNodes: 10, maxEdges: 1 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([root.id, supported.id]);
    expect(snapshot.edges.map((edge) => edge.relationType)).toEqual(["supports"]);
  });

  it("returns deterministic ordering independent of seed order", () => {
    const alpha = repository.saveRecord(recordInput({ id: "alpha", content: "Alpha memory.", topicKey: "alpha" }));
    const beta = repository.saveRecord(recordInput({ id: "beta", content: "Beta memory.", topicKey: "beta" }));
    repository.saveRelation(relationInput("relation-b", beta.id, alpha.id, "related_to"));
    repository.saveRelation(relationInput("relation-a", alpha.id, beta.id, "supports"));

    const first = projector.project({
      rootRecordIds: [beta.id, alpha.id],
      depth: 1,
      limits: { maxNodes: 10, maxEdges: 10 },
    });
    const second = projector.project({
      rootRecordIds: [alpha.id, beta.id],
      depth: 1,
      limits: { maxNodes: 10, maxEdges: 10 },
    });

    expect(first).toEqual(second);
    expect(first.nodes.map((node) => node.recordId)).toEqual([alpha.id, beta.id]);
    expect(first.edges.map((edge) => edge.id)).toEqual(["relation-a", "relation-b"]);
  });

  it("enforces payload caps before returning", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const first = repository.saveRecord(recordInput({ id: "first", content: "First memory.", topicKey: "first" }));
    const second = repository.saveRecord(recordInput({ id: "second", content: "Second memory.", topicKey: "second" }));
    repository.saveRelation(relationInput("relation-1", root.id, first.id, "supports"));
    repository.saveRelation(relationInput("relation-2", root.id, second.id, "related_to"));

    const snapshot = projector.project({
      rootRecordIds: [root.id],
      depth: 1,
      limits: { maxNodes: 2, maxEdges: 1 },
    });

    expect(snapshot.nodes).toHaveLength(2);
    expect(snapshot.edges.length).toBeLessThanOrEqual(1);
    expect(snapshot.truncated).toBe(true);
  });

  it("bounds relation fanout reads before applying graph edge caps", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    for (let index = 1; index <= 12; index += 1) {
      const child = repository.saveRecord(recordInput({
        id: `child-${index}`,
        content: `Child memory ${index}.`,
        topicKey: `child-${index}`,
      }));
      repository.saveRelation(relationInput(`relation-${index}`, root.id, child.id, "related_to"));
    }
    const observedLimits: number[] = [];
    const boundedRepository = Object.assign(Object.create(repository) as MemoryRepository, {
      listRelations: (sourceRecordId: string, query?: { readonly limit?: number }) => {
        observedLimits.push(query?.limit ?? 0);
        return repository.listRelations(sourceRecordId, query);
      },
    });

    const snapshot = new MemoryGraphProjector({ repository: boundedRepository }).project({
      rootRecordIds: [root.id],
      depth: 1,
      limits: { maxNodes: 20, maxEdges: 10 },
    });

    expect(observedLimits).toEqual([1001]);
    expect(snapshot.edges).toHaveLength(10);
    expect(snapshot.truncated).toBe(true);
  });

  it("keeps an explicit root when node caps are tight", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Child memory.", topicKey: "child" }));
    repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));

    const snapshot = projector.project({
      rootRecordIds: [root.id],
      depth: 1,
      limits: { maxNodes: 1, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([root.id]);
    expect(snapshot.edges).toEqual([]);
    expect(snapshot.truncated).toBe(true);
  });

  it("normalizes tag filters for explicit roots and relation targets", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    const child = repository.saveRecord(recordInput({ id: "child", content: "Child memory.", topicKey: "child" }));
    repository.saveRelation(relationInput("relation-1", root.id, child.id, "supports"));

    const snapshot = projector.project({
      rootRecordIds: [root.id],
      depth: 1,
      tags: [" memory ", "memory"],
      limits: { maxNodes: 10, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([root.id, child.id]);
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(["relation-1"]);
  });

  it("deduplicates explicit roots before applying payload caps", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));

    const snapshot = projector.project({
      rootRecordIds: [root.id, root.id],
      limits: { maxNodes: 1, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([root.id]);
    expect(snapshot.truncated).toBe(false);
  });

  it("bounds explicit-root repository reads before applying graph caps", () => {
    const root = repository.saveRecord(recordInput({ id: "root", content: "Root memory.", topicKey: "root" }));
    repository.saveRecord(recordInput({ id: "second", content: "Second memory.", topicKey: "second" }));
    repository.saveRecord(recordInput({ id: "third", content: "Third memory.", topicKey: "third" }));
    const observedIds: string[] = [];
    const boundedRepository = Object.assign(Object.create(repository) as MemoryRepository, {
      getRecord: (recordId: string) => {
        observedIds.push(recordId);
        return repository.getRecord(recordId);
      },
    });

    const snapshot = new MemoryGraphProjector({ repository: boundedRepository }).project({
      rootRecordIds: [root.id, "second", "third", "fourth", "fifth"],
      limits: { maxNodes: 2, maxEdges: 10 },
    });

    expect(observedIds).toEqual([root.id, "second", "third"]);
    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([root.id, "second"]);
    expect(snapshot.truncated).toBe(true);
  });

  it("marks explicit-root projections truncated when root ids exceed the repository seed cap", () => {
    const roots = Array.from({ length: 501 }, (_, index) => `root-${index + 1}`);

    const snapshot = projector.project({
      rootRecordIds: roots,
      limits: { maxNodes: 500, maxEdges: 10 },
    });

    expect(snapshot.nodes).toEqual([]);
    expect(snapshot.truncated).toBe(true);
  });

  it("keeps repository query tie ordering when graph caps are applied", () => {
    repository.saveRecord(recordInput({
      id: "beta",
      content: "Shared query term.",
      topicKey: "beta",
      createdAt: "2026-04-30T12:00:00.000Z",
    }));
    repository.saveRecord(recordInput({
      id: "alpha",
      content: "Shared query term.",
      topicKey: "alpha",
      createdAt: "2026-04-30T12:00:00.000Z",
    }));

    const snapshot = projector.project({
      query: "shared",
      limits: { maxNodes: 1, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual(["alpha"]);
    expect(snapshot.truncated).toBe(true);
  });

  it("preserves repository search order when equal scores are not id-sorted", () => {
    const beta = repository.saveRecord(recordInput({ id: "beta", content: "Shared memory.", topicKey: "beta" }));
    const alpha = repository.saveRecord(recordInput({ id: "alpha", content: "Shared memory.", topicKey: "alpha" }));
    const rankedRepository = Object.assign(Object.create(repository) as MemoryRepository, {
      searchRecords: () => [
        { record: beta, score: 1 },
        { record: alpha, score: 1 },
      ],
    });

    const snapshot = new MemoryGraphProjector({ repository: rankedRepository }).project({
      query: "memory",
      limits: { maxNodes: 1, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([beta.id]);
    expect(snapshot.truncated).toBe(true);
  });

  it("preserves repository search ranking before graph score caps are applied", () => {
    const stronger = repository.saveRecord(recordInput({ id: "stronger", content: "Relevant memory.", topicKey: "stronger" }));
    const weaker = repository.saveRecord(recordInput({ id: "weaker", content: "Less relevant memory.", topicKey: "weaker" }));
    const rankedRepository = Object.assign(Object.create(repository) as MemoryRepository, {
      searchRecords: () => [
        { record: stronger, score: 1 },
        { record: weaker, score: 100 },
      ],
    });

    const snapshot = new MemoryGraphProjector({ repository: rankedRepository }).project({
      query: "memory",
      limits: { maxNodes: 1, maxEdges: 10 },
    });

    expect(snapshot.nodes.map((node) => node.recordId)).toEqual([stronger.id]);
    expect(snapshot.truncated).toBe(true);
  });
});

function recordInput(overrides: {
  readonly id: string;
  readonly content: string;
  readonly topicKey: string;
  readonly layer?: CreateMemoryRecordInput["layer"];
  readonly scopeId?: string;
  readonly createdAt?: string;
}): CreateMemoryRecordInput {
  return {
    id: overrides.id,
    layer: overrides.layer ?? "semantic",
    scope: {
      kind: "project",
      id: overrides.scopeId ?? "kiln",
    },
    content: overrides.content,
    tags: ["memory"],
    topicKey: overrides.topicKey,
    provenance: provenance("seed"),
    createdAt: overrides.createdAt,
  };
}

function relationInput(
  id: string,
  sourceRecordId: string,
  targetRecordId: string,
  type: "supports" | "related_to" | "derived_from",
) {
  return {
    id,
    sourceRecordId,
    target: { kind: "memory_record" as const, id: targetRecordId },
    type,
    createdAt: "2026-04-30T12:00:00.000Z",
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
