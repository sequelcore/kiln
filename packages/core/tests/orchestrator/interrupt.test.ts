import { describe, it, expect, beforeEach } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { CheckpointStore } from "../../src/orchestrator/checkpoint-store.js";
import type { Checkpoint, CheckpointOptions } from "../../src/orchestrator/checkpoint-types.js";
import type { InterruptRequestedEvent, InterruptResumedEvent } from "../../src/events/index.js";

/** In-memory CheckpointStore mock for tests that don't need bun:sqlite */
function createMockStore(): CheckpointStore {
  const store = new Map<string, Checkpoint>();

  return {
    async save(checkpoint: Checkpoint, _options?: CheckpointOptions): Promise<void> {
      store.set(checkpoint.id, checkpoint);
    },
    async load(id: string): Promise<Checkpoint | null> {
      return store.get(id) ?? null;
    },
    async listBySession(sessionId: string): Promise<readonly Checkpoint[]> {
      return [...store.values()].filter((c) => c.sessionId === sessionId);
    },
    async listChildren(parentId: string): Promise<readonly Checkpoint[]> {
      return [...store.values()].filter((c) => c.parentId === parentId);
    },
    async delete(id: string): Promise<void> {
      store.delete(id);
    },
  };
}

describe("Orchestrator interrupt/resume", () => {
  let orchestrator: Orchestrator;
  let mockStore: CheckpointStore;

  beforeEach(() => {
    orchestrator = new Orchestrator({
      phases: ["analyze", "research", "architect", "implement"],
      requireApproval: false,
      maxDepth: 3,
      parallelWorkers: 2,
    });
    mockStore = createMockStore();
    orchestrator.attachCheckpointStore(mockStore);
  });

  describe("interrupt", () => {
    it("creates checkpoint with interrupt state in metadata", async () => {
      orchestrator.start("Test task");
      orchestrator.advancePhase(); // -> research

      const checkpointId = await orchestrator.interrupt({
        reason: "Need user approval",
        resumeSchema: { type: "object", required: ["approved"] },
        metadata: { source: "architect" },
      });

      expect(checkpointId).toBeDefined();

      const checkpoint = await mockStore.load(checkpointId);
      expect(checkpoint).not.toBeNull();
      expect(checkpoint!.metadata).toBeDefined();
      expect(checkpoint!.metadata!.interruptState).toBeDefined();

      const interruptState = checkpoint!.metadata!.interruptState as Record<string, unknown>;
      expect(interruptState.reason).toBe("Need user approval");
      expect(interruptState.resumeSchema).toEqual({ type: "object", required: ["approved"] });
      expect(interruptState.phase).toBe("research");
      expect(interruptState.requestedAt).toBeDefined();
    });

    it("sets interruptState on orchestrator", async () => {
      orchestrator.start("Test task");

      expect(orchestrator.interruptState).toBeNull();

      await orchestrator.interrupt({ reason: "Waiting for input" });

      expect(orchestrator.interruptState).not.toBeNull();
      expect(orchestrator.interruptState!.reason).toBe("Waiting for input");
      expect(orchestrator.interruptState!.phase).toBe("analyze");
    });

    it("emits interrupt_requested event", async () => {
      orchestrator.start("Test task");

      const events: InterruptRequestedEvent[] = [];
      orchestrator.eventBus.on("interrupt_requested", (e) => events.push(e));

      const checkpointId = await orchestrator.interrupt({
        reason: "Need approval",
        resumeSchema: { type: "string" },
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.checkpointId).toBe(checkpointId);
      expect(events[0]!.reason).toBe("Need approval");
      expect(events[0]!.resumeSchema).toEqual({ type: "string" });
    });

    it("preserves extra metadata alongside interruptState", async () => {
      orchestrator.start("Test task");

      const checkpointId = await orchestrator.interrupt({
        reason: "Pause",
        metadata: { agentName: "researcher", priority: "high" },
      });

      const checkpoint = await mockStore.load(checkpointId);
      expect(checkpoint!.metadata!.agentName).toBe("researcher");
      expect(checkpoint!.metadata!.priority).toBe("high");
      expect(checkpoint!.metadata!.interruptState).toBeDefined();
    });

    it("throws without checkpoint store", async () => {
      const bare = new Orchestrator({ requireApproval: false, maxDepth: 2, parallelWorkers: 1, phases: ["analyze"] });
      bare.start("Test task");

      await expect(bare.interrupt({ reason: "test" })).rejects.toThrow(
        "No checkpoint store attached",
      );
    });

    it("throws without active session", async () => {
      await expect(orchestrator.interrupt({ reason: "test" })).rejects.toThrow(
        "No active session",
      );
    });
  });

  describe("resumeInterrupt", () => {
    it("resumes from interrupt checkpoint with value", async () => {
      const originalSessionId = orchestrator.start("Test task");
      orchestrator.advancePhase(); // -> research

      const checkpointId = await orchestrator.interrupt({
        reason: "Need user input",
        resumeSchema: { type: "object" },
      });

      const newSessionId = await orchestrator.resumeInterrupt({
        checkpointId,
        value: { approved: true, comment: "Looks good" },
      });

      expect(newSessionId).toBeDefined();
      expect(newSessionId).not.toBe(originalSessionId);
      expect(orchestrator.currentPhase).toBe("research");
      expect(orchestrator.task).toBe("Test task");
      expect(orchestrator.interruptState).toBeNull();
    });

    it("emits interrupt_resumed event", async () => {
      orchestrator.start("Test task");

      const checkpointId = await orchestrator.interrupt({ reason: "Pause" });

      const events: InterruptResumedEvent[] = [];
      orchestrator.eventBus.on("interrupt_resumed", (e) => events.push(e));

      const newSessionId = await orchestrator.resumeInterrupt({
        checkpointId,
        value: "user-response",
      });

      expect(events).toHaveLength(1);
      expect(events[0]!.checkpointId).toBe(checkpointId);
      expect(events[0]!.resumeValue).toBe("user-response");
      expect(events[0]!.sessionId).toBe(newSessionId);
    });

    it("throws for checkpoint without interrupt state", async () => {
      orchestrator.start("Test task");

      // Create a regular checkpoint (no interrupt state)
      const checkpointId = await orchestrator.checkpoint();

      await expect(
        orchestrator.resumeInterrupt({ checkpointId, value: "test" }),
      ).rejects.toThrow("Checkpoint does not contain interrupt state");
    });

    it("throws for nonexistent checkpoint", async () => {
      orchestrator.start("Test task");

      await expect(
        orchestrator.resumeInterrupt({ checkpointId: "nonexistent-id", value: "test" }),
      ).rejects.toThrow("Checkpoint not found");
    });

    it("throws without checkpoint store", async () => {
      const bare = new Orchestrator({ requireApproval: false, maxDepth: 2, parallelWorkers: 1, phases: ["analyze"] });

      await expect(
        bare.resumeInterrupt({ checkpointId: "any", value: "test" }),
      ).rejects.toThrow("No checkpoint store attached");
    });
  });
});
