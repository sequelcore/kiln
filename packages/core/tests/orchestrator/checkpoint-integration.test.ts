import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import { SqliteCheckpointStore } from "../../src/orchestrator/sqlite-checkpoint-store.js";

describe("Orchestrator checkpoint integration", () => {
  let orchestrator: Orchestrator;
  let store: SqliteCheckpointStore;
  const dbPath = ":memory:";

  beforeEach(() => {
    orchestrator = new Orchestrator({
      phases: ["analyze", "research", "architect", "implement"],
      requireApproval: false,
      maxDepth: 3,
      parallelWorkers: 2,
    });
    store = new SqliteCheckpointStore(dbPath);
    orchestrator.attachCheckpointStore(store);
  });

  afterEach(() => {
    store.close();
  });

  describe("auto-checkpoint on phase change", () => {
    it("should automatically create checkpoint after phase advance", async () => {
      const sessionId = orchestrator.start("Test task");
      
      expect(orchestrator.currentPhase).toBe("analyze");
      
      orchestrator.advancePhase();

      const checkpoints = await store.listBySession(sessionId);
      expect(checkpoints.length).toBeGreaterThan(0);
      
      const latestCheckpoint = checkpoints[checkpoints.length - 1];
      expect(latestCheckpoint!.phase).toBe("research");
    });
  });

  describe("checkpoint and resume", () => {
    it("should create checkpoint manually", async () => {
      orchestrator.start("Test task");
      
      const checkpointId = await orchestrator.checkpoint();
      expect(checkpointId).toBeDefined();

      const checkpoint = await store.load(checkpointId);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.task).toBe("Test task");
      expect(checkpoint!.phase).toBe("analyze");
    });

    it("should resume from checkpoint", async () => {
      orchestrator.start("Original task");
      orchestrator.advancePhase();
      orchestrator.advancePhase();
      
      expect(orchestrator.currentPhase).toBe("architect");
      const originalSessionId = orchestrator.sessionId;

      const checkpointId = await orchestrator.checkpoint();
      const resumedSessionId = await orchestrator.resume(checkpointId);

      expect(resumedSessionId).not.toBe(originalSessionId);
      expect(orchestrator.currentPhase).toBe("architect");
      expect(orchestrator.task).toBe("Original task");
    });

    it("should throw error when resuming without store", async () => {
      const newOrchestrator = new Orchestrator();
      newOrchestrator.start("Test task");
      const checkpointId = await orchestrator.checkpoint();

      await expect(newOrchestrator.resume(checkpointId)).rejects.toThrow(
        "No checkpoint store attached",
      );
    });
  });

  describe("fork", () => {
    it("should fork from checkpoint with new parentId", async () => {
      orchestrator.start("Original task");
      orchestrator.advancePhase();
      
      const checkpointId = await orchestrator.checkpoint();
      const forkSessionId = await orchestrator.fork(checkpointId);

      const forkCheckpoint = await store.load(
        (await store.listBySession(forkSessionId))[0]!.id,
      );

      expect(forkCheckpoint!.parentId).toBe(checkpointId);
    });
  });

  describe("replay", () => {
    it("should replay with task override", async () => {
      orchestrator.start("Original task");
      orchestrator.advancePhase();
      
      const checkpointId = await orchestrator.checkpoint();
      await orchestrator.replay(checkpointId, {
        task: "Modified task",
      });

      expect(orchestrator.task).toBe("Modified task");
    });

    it("should replay with startPhase override", async () => {
      orchestrator.start("Test task");
      orchestrator.advancePhase();
      orchestrator.advancePhase();
      
      expect(orchestrator.currentPhase).toBe("architect");
      
      const checkpointId = await orchestrator.checkpoint();
      await orchestrator.replay(checkpointId, {
        startPhase: "analyze",
      });

      expect(orchestrator.currentPhase).toBe("analyze");
    });
  });
});
