import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SqliteCheckpointStore } from "../../src/orchestrator/sqlite-checkpoint-store.js";
import type { Checkpoint, CheckpointOptions } from "../../src/orchestrator/checkpoint-types.js";
import type { OrchestratorStatus } from "../../src/orchestrator/index.js";

describe("SqliteCheckpointStore", () => {
  let store: SqliteCheckpointStore;
  const dbPath = ":memory:";

  beforeEach(() => {
    store = new SqliteCheckpointStore(dbPath);
  });

  afterEach(() => {
    store.close();
  });

  const createMockCheckpoint = (
    overrides: Partial<Checkpoint> = {},
  ): Checkpoint => ({
    id: "test-id-1",
    sessionId: "session-1",
    parentId: null,
    phase: "analyze",
    phaseIndex: 0,
    status: "running" as OrchestratorStatus,
    task: "Test task",
    tree: { nodes: [], config: { maxDepth: 3, batchSize: 2, depthDiscount: 0.8 } },
    eventHistory: [],
    costSummary: {
      totalInputTokens: 100,
      totalOutputTokens: 50,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      totalToolCalls: 1,
      totalCostUsd: 0.001,
      byRole: {},
    },
    timestamp: new Date("2024-01-01T00:00:00Z"),
    ...overrides,
  });

  describe("save and load", () => {
    it("should save and load a checkpoint", async () => {
      const checkpoint = createMockCheckpoint();
      await store.save(checkpoint);

      const loaded = await store.load(checkpoint.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(checkpoint.id);
      expect(loaded!.sessionId).toBe(checkpoint.sessionId);
      expect(loaded!.phase).toBe(checkpoint.phase);
      expect(loaded!.status).toBe(checkpoint.status);
    });

    it("should save checkpoint with metadata", async () => {
      const checkpoint = createMockCheckpoint();
      const options: CheckpointOptions = { metadata: { userId: "user-1", tag: "production" } };
      await store.save(checkpoint, options);

      const loaded = await store.load(checkpoint.id);
      expect(loaded!.metadata).toEqual({ userId: "user-1", tag: "production" });
    });

    it("should return null for non-existent checkpoint", async () => {
      const loaded = await store.load("non-existent-id");
      expect(loaded).toBeNull();
    });
  });

  describe("listBySession", () => {
    it("should list checkpoints for a session", async () => {
      const cp1 = createMockCheckpoint({ id: "cp-1", sessionId: "session-1", phaseIndex: 0 });
      const cp2 = createMockCheckpoint({ id: "cp-2", sessionId: "session-1", phaseIndex: 1 });
      const cp3 = createMockCheckpoint({ id: "cp-3", sessionId: "session-2", phaseIndex: 0 });

      await store.save(cp1);
      await store.save(cp2);
      await store.save(cp3);

      const session1Checkpoints = await store.listBySession("session-1");
      expect(session1Checkpoints).toHaveLength(2);
      expect(session1Checkpoints[0]!.phaseIndex).toBe(0);
      expect(session1Checkpoints[1]!.phaseIndex).toBe(1);
    });

    it("should return empty array for non-existent session", async () => {
      const checkpoints = await store.listBySession("non-existent-session");
      expect(checkpoints).toHaveLength(0);
    });
  });

  describe("listChildren", () => {
    it("should list child checkpoints", async () => {
      const parent = createMockCheckpoint({ id: "parent", parentId: null });
      const child1 = createMockCheckpoint({ id: "child-1", parentId: "parent" });
      const child2 = createMockCheckpoint({ id: "child-2", parentId: "parent" });
      const unrelated = createMockCheckpoint({ id: "unrelated", parentId: null });

      await store.save(parent);
      await store.save(child1);
      await store.save(child2);
      await store.save(unrelated);

      const children = await store.listChildren("parent");
      expect(children).toHaveLength(2);
      expect(children.map(c => c.id).sort()).toEqual(["child-1", "child-2"]);
    });
  });

  describe("delete", () => {
    it("should delete a checkpoint", async () => {
      const checkpoint = createMockCheckpoint();
      await store.save(checkpoint);

      await store.delete(checkpoint.id);

      const loaded = await store.load(checkpoint.id);
      expect(loaded).toBeNull();
    });

    it("should delete checkpoint and its children", async () => {
      const parent = createMockCheckpoint({ id: "parent" });
      const child = createMockCheckpoint({ id: "child", parentId: "parent" });

      await store.save(parent);
      await store.save(child);

      await store.delete("parent");

      expect(await store.load("parent")).toBeNull();
      expect(await store.load("child")).toBeNull();
    });
  });
});
