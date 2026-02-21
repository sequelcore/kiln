import { describe, it, expect, beforeEach } from "vitest";
import { A2ATaskStore } from "../../src/a2a/a2a-task-store.js";
import type { A2AMessage } from "@kilnai/core";

describe("A2ATaskStore", () => {
  let store: A2ATaskStore;

  beforeEach(() => {
    store = new A2ATaskStore();
  });

  const createMessage = (text: string): A2AMessage => ({
    role: "user",
    parts: [{ type: "text", text }],
  });

  describe("createTask", () => {
    it("creates task with 'submitted' status", () => {
      const message = createMessage("Hello");
      const task = store.createTask("task-1", message);

      expect(task.id).toBe("task-1");
      expect(task.status.state).toBe("submitted");
      expect(task.status.timestamp).toBeDefined();
      expect(task.history).toHaveLength(1);
      expect(task.history![0]).toEqual(message);
    });
  });

  describe("updateStatus", () => {
    it("updates task status", () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);

      const newStatus = { state: "working" as const, timestamp: new Date().toISOString() };
      const updated = store.updateStatus("task-1", newStatus);

      expect(updated?.status.state).toBe("working");
    });

    it("updates task with artifacts", () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);

      const artifacts = [{ parts: [{ type: "text" as const, text: "result" }] }];
      const newStatus = { state: "completed" as const, timestamp: new Date().toISOString() };
      const updated = store.updateStatus("task-1", newStatus, artifacts);

      expect(updated?.artifacts).toEqual(artifacts);
    });

    it("returns undefined for unknown task ID", () => {
      const result = store.updateStatus("unknown", { state: "working", timestamp: new Date().toISOString() });
      expect(result).toBeUndefined();
    });
  });

  describe("getTask", () => {
    it("returns task by ID", () => {
      const message = createMessage("Hello");
      const created = store.createTask("task-1", message);
      const retrieved = store.getTask("task-1");

      expect(retrieved).toEqual(created);
    });

    it("returns undefined for unknown task ID", () => {
      expect(store.getTask("unknown")).toBeUndefined();
    });
  });

  describe("cancelTask", () => {
    it("cancels active task", () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);

      const canceled = store.cancelTask("task-1");

      expect(canceled?.status.state).toBe("canceled");
    });

    it("cannot cancel completed task", () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);
      store.updateStatus("task-1", { state: "completed", timestamp: new Date().toISOString() });

      const result = store.cancelTask("task-1");

      expect(result?.status.state).toBe("completed");
    });

    it("cannot cancel failed task", () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);
      store.updateStatus("task-1", { state: "failed", message: "error", timestamp: new Date().toISOString() });

      const result = store.cancelTask("task-1");

      expect(result?.status.state).toBe("failed");
    });

    it("returns undefined for unknown task ID", () => {
      expect(store.cancelTask("unknown")).toBeUndefined();
    });
  });

  describe("cleanExpired", () => {
    it("removes old completed tasks", async () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);
      store.updateStatus("task-1", { state: "completed", timestamp: new Date().toISOString() });

      await new Promise((r) => setTimeout(r, 10));

      const removed = store.cleanExpired(5);
      expect(removed).toBe(1);
      expect(store.getTask("task-1")).toBeUndefined();
    });

    it("keeps recent completed tasks", () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);
      store.updateStatus("task-1", { state: "completed", timestamp: new Date().toISOString() });

      const removed = store.cleanExpired(60000);
      expect(removed).toBe(0);
      expect(store.getTask("task-1")).toBeDefined();
    });

    it("does not remove active tasks", async () => {
      const message = createMessage("Hello");
      store.createTask("task-1", message);

      await new Promise((r) => setTimeout(r, 10));

      const removed = store.cleanExpired(5);
      expect(removed).toBe(0);
      expect(store.getTask("task-1")).toBeDefined();
    });
  });
});
