import { describe, it, expect, beforeEach } from "vitest";
import { TaskChannel } from "../../src/orchestrator/task-channel.js";

describe("TaskChannel", () => {
  let channel: TaskChannel;

  beforeEach(() => {
    channel = new TaskChannel();
  });

  describe("publish", () => {
    it("publishes task with open status when no dependencies", () => {
      const task = channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      expect(task.status).toBe("open");
      expect(task.id).toBe("task-1");
      expect(task.dependencies).toHaveLength(0);
    });

    it("publishes task with blocked status when dependency is not completed", () => {
      channel.publish({
        id: "task-a",
        description: "Parent task",
        category: "code",
        demand: 0.8,
      });

      const blockedTask = channel.publish({
        id: "task-b",
        description: "Dependent task",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      expect(blockedTask.status).toBe("blocked");
    });

    it("publishes task with open status when dependency IS completed", () => {
      channel.publish({
        id: "task-a",
        description: "Parent task",
        category: "code",
        demand: 0.8,
      });

      const childTask = channel.publish({
        id: "task-b",
        description: "Dependent task",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      expect(childTask.status).toBe("blocked");

      channel.claim("task-a", "agent-1");
      channel.complete("task-a", { result: "done" });

      const reopenedTask = channel.publish({
        id: "task-c",
        description: "Dependent task after parent completed",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      expect(reopenedTask.status).toBe("open");
    });

    it("sets createdAt and updatedAt to current timestamp", () => {
      const now = Date.now();
      const task = channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      expect(task.createdAt).toBeGreaterThanOrEqual(now - 10);
      expect(task.createdAt).toBeLessThanOrEqual(now + 10);
      expect(task.updatedAt).toBeGreaterThanOrEqual(now - 10);
      expect(task.updatedAt).toBeLessThanOrEqual(now + 10);
      expect(task.createdAt).toBe(task.updatedAt);
    });
  });

  describe("claim", () => {
    it("claims an open task, sets status to claimed and assignee", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const claimed = channel.claim("task-1", "agent-1");

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("claimed");
      expect(claimed!.assignee).toBe("agent-1");
    });

    it("returns null for non-existent task", () => {
      const result = channel.claim("non-existent", "agent-1");
      expect(result).toBeNull();
    });

    it("returns null for already-claimed task", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      channel.claim("task-1", "agent-1");
      const result = channel.claim("task-1", "agent-2");

      expect(result).toBeNull();
    });

    it("returns null for completed task", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      channel.claim("task-1", "agent-1");
      channel.complete("task-1", { result: "done" });

      const result = channel.claim("task-1", "agent-1");
      expect(result).toBeNull();
    });
  });

  describe("complete", () => {
    it("completes a claimed task with result string", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      channel.claim("task-1", "agent-1");
      const completed = channel.complete("task-1", { result: "Wrote utils.ts with 3 helpers" });

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe("completed");
      expect(completed!.result).toBe("Wrote utils.ts with 3 helpers");
    });

    it("returns null for open task (must be claimed first)", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const result = channel.complete("task-1", { result: "done" });
      expect(result).toBeNull();
    });

    it("unblocks dependent tasks after completion", () => {
      channel.publish({
        id: "task-a",
        description: "Parent task",
        category: "code",
        demand: 0.8,
      });

      channel.publish({
        id: "task-b",
        description: "Dependent task",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      const blockedTask = channel.get("task-b")!;
      expect(blockedTask.status).toBe("blocked");

      channel.claim("task-a", "agent-1");
      channel.complete("task-a", { result: "done" });

      const unblockedTask = channel.get("task-b")!;
      expect(unblockedTask.status).toBe("open");
    });
  });

  describe("fail", () => {
    it("fails a claimed task with error string", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      channel.claim("task-1", "agent-1");
      const failed = channel.fail("task-1", { error: "TypeScript compilation failed" });

      expect(failed).not.toBeNull();
      expect(failed!.status).toBe("failed");
      expect(failed!.error).toBe("TypeScript compilation failed");
    });

    it("returns null for open task", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const result = channel.fail("task-1", { error: "some error" });
      expect(result).toBeNull();
    });
  });

  describe("release", () => {
    it("releases claimed task back to open, clears assignee", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      channel.claim("task-1", "agent-1");
      const released = channel.release("task-1");

      expect(released).not.toBeNull();
      expect(released!.status).toBe("open");
      expect(released!.assignee).toBeUndefined();
    });

    it("returns null for open task", () => {
      channel.publish({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const result = channel.release("task-1");
      expect(result).toBeNull();
    });
  });

  describe("queries", () => {
    beforeEach(() => {
      channel.publish({ id: "task-1", description: "Task 1", category: "code", demand: 0.8 });
      channel.publish({ id: "task-2", description: "Task 2", category: "review", demand: 0.6 });
      channel.publish({ id: "task-3", description: "Task 3", category: "code", demand: 0.9 });

      channel.claim("task-1", "agent-1");
      channel.claim("task-2", "agent-2");

      channel.complete("task-1", { result: "done" });
    });

    it("open() returns only open tasks", () => {
      const openTasks = channel.open();
      expect(openTasks).toHaveLength(1);
      expect(openTasks[0].id).toBe("task-3");
    });

    it('byStatus("completed") returns only completed tasks', () => {
      const completedTasks = channel.byStatus("completed");
      expect(completedTasks).toHaveLength(1);
      expect(completedTasks[0].id).toBe("task-1");
    });

    it("byAssignee returns tasks for specific agent", () => {
      const tasksForAgent2 = channel.byAssignee("agent-2");
      expect(tasksForAgent2).toHaveLength(1);
      expect(tasksForAgent2[0].id).toBe("task-2");
    });

    it("all() returns every task", () => {
      const allTasks = channel.all();
      expect(allTasks).toHaveLength(3);
    });

    it("counts() returns correct tallies per status", () => {
      const counts = channel.counts();
      expect(counts.open).toBe(1);
      expect(counts.claimed).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(0);
      expect(counts.blocked).toBe(0);
    });
  });

  describe("dependency chain", () => {
    it("task A → task B → task C: completing A unblocks B, completing B unblocks C", () => {
      channel.publish({ id: "task-a", description: "Task A", category: "research", demand: 0.9 });
      channel.publish({
        id: "task-b",
        description: "Task B",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });
      channel.publish({
        id: "task-c",
        description: "Task C",
        category: "review",
        demand: 0.7,
        dependencies: ["task-b"],
      });

      expect(channel.get("task-b")!.status).toBe("blocked");
      expect(channel.get("task-c")!.status).toBe("blocked");

      channel.claim("task-a", "agent-1");
      channel.complete("task-a", { result: "Research complete" });

      expect(channel.get("task-b")!.status).toBe("open");
      expect(channel.get("task-c")!.status).toBe("blocked");

      channel.claim("task-b", "agent-2");
      channel.complete("task-b", { result: "Code complete" });

      expect(channel.get("task-c")!.status).toBe("open");
    });

    it("task with multiple deps: only unblocks when ALL deps completed", () => {
      channel.publish({ id: "task-a", description: "Task A", category: "research", demand: 0.9 });
      channel.publish({ id: "task-b", description: "Task B", category: "writing", demand: 0.8 });
      channel.publish({
        id: "task-c",
        description: "Task C",
        category: "general",
        demand: 0.7,
        dependencies: ["task-a", "task-b"],
      });

      expect(channel.get("task-c")!.status).toBe("blocked");

      channel.claim("task-a", "agent-1");
      channel.complete("task-a", { result: "done" });

      expect(channel.get("task-c")!.status).toBe("blocked");

      channel.claim("task-b", "agent-2");
      channel.complete("task-b", { result: "done" });

      expect(channel.get("task-c")!.status).toBe("open");
    });
  });
});
