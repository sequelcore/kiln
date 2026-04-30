import { describe, expect, it } from "vitest";
import {
  createMemoryGraphSnapshot,
  createMemoryRelation,
  defineMemoryScope,
  validateMemoryRevisionLineage,
  type MemoryGraphEdge,
  type MemoryGraphNode,
  type MemoryRevision,
} from "../../src/memory/domain/index.js";

describe("Memory Lattice domain", () => {
  describe("defineMemoryScope", () => {
    it("normalizes explicit scoped memory owners", () => {
      expect(defineMemoryScope({ kind: "project", id: "kiln" })).toEqual({
        kind: "project",
        id: "kiln",
      });
    });

    it("rejects unsupported scope kinds", () => {
      expect(() => defineMemoryScope({ kind: "global", id: "all" })).toThrow("Unsupported memory scope kind");
    });

    it("rejects blank scope ids", () => {
      expect(() => defineMemoryScope({ kind: "project", id: " " })).toThrow("Memory scope id is required");
    });
  });

  describe("createMemoryRelation", () => {
    it("accepts explicit Memory Lattice relation types", () => {
      const relation = createMemoryRelation({
        id: "rel-1",
        sourceRecordId: "mem-1",
        target: { kind: "memory_record", id: "mem-2" },
        type: "contradicts",
        confidence: 0.72,
        createdAt: "2026-04-30T00:00:00.000Z",
      });

      expect(relation.type).toBe("contradicts");
      expect(relation.target.id).toBe("mem-2");
    });

    it("rejects unsupported relation types", () => {
      expect(() =>
        createMemoryRelation({
          id: "rel-1",
          sourceRecordId: "mem-1",
          target: { kind: "memory_record", id: "mem-2" },
          type: "overlaps" as never,
          createdAt: "2026-04-30T00:00:00.000Z",
        }),
      ).toThrow("Unsupported memory relation type");
    });

    it("rejects self-relations between the same memory record", () => {
      expect(() =>
        createMemoryRelation({
          id: "rel-1",
          sourceRecordId: "mem-1",
          target: { kind: "memory_record", id: "mem-1" },
          type: "related_to",
          createdAt: "2026-04-30T00:00:00.000Z",
        }),
      ).toThrow("Memory relation cannot target itself");
    });
  });

  describe("validateMemoryRevisionLineage", () => {
    it("accepts contiguous revisions for one record", () => {
      const revisions: MemoryRevision[] = [
        revision({ id: "rev-1", sequence: 1, parentRevisionId: undefined }),
        revision({ id: "rev-2", sequence: 2, parentRevisionId: "rev-1" }),
      ];

      expect(validateMemoryRevisionLineage(revisions)).toEqual(revisions);
    });

    it("rejects mixed record lineage", () => {
      expect(() =>
        validateMemoryRevisionLineage([
          revision({ id: "rev-1", sequence: 1, parentRevisionId: undefined }),
          revision({ id: "rev-2", recordId: "mem-2", sequence: 2, parentRevisionId: "rev-1" }),
        ]),
      ).toThrow("Memory revision lineage cannot mix records");
    });

    it("rejects non-contiguous parent links", () => {
      expect(() =>
        validateMemoryRevisionLineage([
          revision({ id: "rev-1", sequence: 1, parentRevisionId: undefined }),
          revision({ id: "rev-2", sequence: 2, parentRevisionId: "missing" }),
        ]),
      ).toThrow("Memory revision parent must reference the previous revision");
    });
  });

  describe("createMemoryGraphSnapshot", () => {
    it("applies deterministic node and edge caps", () => {
      const nodes: MemoryGraphNode[] = [
        node("mem-1", 0.4),
        node("mem-2", 0.9),
        node("mem-3", 0.6),
      ];
      const edges: MemoryGraphEdge[] = [
        edge("edge-1", "mem-2", "mem-3"),
        edge("edge-2", "mem-1", "mem-2"),
        edge("edge-3", "mem-2", "mem-4"),
      ];

      const snapshot = createMemoryGraphSnapshot({
        nodes,
        edges,
        limits: { maxNodes: 2, maxEdges: 1 },
      });

      expect(snapshot.nodes.map((candidate) => candidate.id)).toEqual(["mem-2", "mem-3"]);
      expect(snapshot.edges.map((candidate) => candidate.id)).toEqual(["edge-1"]);
      expect(snapshot.truncated).toBe(true);
    });
  });
});

function revision(overrides: Partial<MemoryRevision>): MemoryRevision {
  return {
    id: "rev-1",
    recordId: "mem-1",
    sequence: 1,
    kind: "created",
    content: "memory content",
    createdAt: "2026-04-30T00:00:00.000Z",
    ...overrides,
  };
}

function node(id: string, score: number): MemoryGraphNode {
  return {
    id,
    recordId: id,
    layer: "episodic",
    scope: { kind: "project", id: "kiln" },
    label: id,
    score,
  };
}

function edge(id: string, sourceRecordId: string, targetRecordId: string): MemoryGraphEdge {
  return {
    id,
    sourceRecordId,
    targetRecordId,
    relationType: "related_to",
  };
}
