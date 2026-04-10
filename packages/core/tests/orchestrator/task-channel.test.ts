import { describe, it, expect, beforeEach } from "vitest";
import { TaskRegistry } from "../../src/orchestrator/task-registry.js";

describe("TaskRegistry", () => {
  let registry: TaskRegistry;

  beforeEach(() => {
    registry = new TaskRegistry();
  });

  describe("register", () => {
    it("registers task with open status when no dependencies", () => {
      const task = registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      expect(task.status).toBe("open");
      expect(task.id).toBe("task-1");
      expect(task.dependencies).toHaveLength(0);
    });

    it("registers task with blocked status when dependency is not completed", () => {
      registry.register({
        id: "task-a",
        description: "Parent task",
        category: "code",
        demand: 0.8,
      });

      const blockedTask = registry.register({
        id: "task-b",
        description: "Dependent task",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      expect(blockedTask.status).toBe("blocked");
    });

    it("registers task with open status when dependency IS completed", () => {
      registry.register({
        id: "task-a",
        description: "Parent task",
        category: "code",
        demand: 0.8,
      });

      const childTask = registry.register({
        id: "task-b",
        description: "Dependent task",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      expect(childTask.status).toBe("blocked");

      registry.claim("task-a", "agent-1");
      registry.complete("task-a", { result: "done" });

      const reopenedTask = registry.register({
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
      const task = registry.register({
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
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const claimed = registry.claim("task-1", "agent-1");

      expect(claimed).not.toBeNull();
      expect(claimed!.status).toBe("claimed");
      expect(claimed!.assignee).toBe("agent-1");
    });

    it("returns null for non-existent task", () => {
      const result = registry.claim("non-existent", "agent-1");
      expect(result).toBeNull();
    });

    it("returns null for already-claimed task", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      registry.claim("task-1", "agent-1");
      const result = registry.claim("task-1", "agent-2");

      expect(result).toBeNull();
    });

    it("returns null for completed task", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      registry.claim("task-1", "agent-1");
      registry.complete("task-1", { result: "done" });

      const result = registry.claim("task-1", "agent-1");
      expect(result).toBeNull();
    });
  });

  describe("complete", () => {
    it("completes a claimed task with result string", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      registry.claim("task-1", "agent-1");
      const completed = registry.complete("task-1", { result: "Wrote utils.ts with 3 helpers" });

      expect(completed).not.toBeNull();
      expect(completed!.status).toBe("completed");
      expect(completed!.result).toBe("Wrote utils.ts with 3 helpers");
    });

    it("returns null for open task (must be claimed first)", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const result = registry.complete("task-1", { result: "done" });
      expect(result).toBeNull();
    });

    it("unblocks dependent tasks after completion", () => {
      registry.register({
        id: "task-a",
        description: "Parent task",
        category: "code",
        demand: 0.8,
      });

      registry.register({
        id: "task-b",
        description: "Dependent task",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });

      const blockedTask = registry.get("task-b")!;
      expect(blockedTask.status).toBe("blocked");

      registry.claim("task-a", "agent-1");
      registry.complete("task-a", { result: "done" });

      const unblockedTask = registry.get("task-b")!;
      expect(unblockedTask.status).toBe("open");
    });
  });

  describe("fail", () => {
    it("fails a claimed task with error string", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      registry.claim("task-1", "agent-1");
      const failed = registry.fail("task-1", { error: "TypeScript compilation failed" });

      expect(failed).not.toBeNull();
      expect(failed!.status).toBe("failed");
      expect(failed!.error).toBe("TypeScript compilation failed");
    });

    it("returns null for open task", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const result = registry.fail("task-1", { error: "some error" });
      expect(result).toBeNull();
    });
  });

  describe("release", () => {
    it("releases claimed task back to open, clears assignee", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      registry.claim("task-1", "agent-1");
      const released = registry.release("task-1");

      expect(released).not.toBeNull();
      expect(released!.status).toBe("open");
      expect(released!.assignee).toBeUndefined();
    });

    it("returns null for open task", () => {
      registry.register({
        id: "task-1",
        description: "Test task",
        category: "code",
        demand: 0.8,
      });

      const result = registry.release("task-1");
      expect(result).toBeNull();
    });
  });

  describe("queries", () => {
    beforeEach(() => {
      registry.register({ id: "task-1", description: "Task 1", category: "code", demand: 0.8 });
      registry.register({ id: "task-2", description: "Task 2", category: "review", demand: 0.6 });
      registry.register({ id: "task-3", description: "Task 3", category: "code", demand: 0.9 });

      registry.claim("task-1", "agent-1");
      registry.claim("task-2", "agent-2");

      registry.complete("task-1", { result: "done" });
    });

    it("open() returns only open tasks", () => {
      const openTasks = registry.open();
      expect(openTasks).toHaveLength(1);
      expect(openTasks[0].id).toBe("task-3");
    });

    it('byStatus("completed") returns only completed tasks', () => {
      const completedTasks = registry.byStatus("completed");
      expect(completedTasks).toHaveLength(1);
      expect(completedTasks[0].id).toBe("task-1");
    });

    it("byAssignee returns tasks for specific agent", () => {
      const tasksForAgent2 = registry.byAssignee("agent-2");
      expect(tasksForAgent2).toHaveLength(1);
      expect(tasksForAgent2[0].id).toBe("task-2");
    });

    it("all() returns every task", () => {
      const allTasks = registry.all();
      expect(allTasks).toHaveLength(3);
    });

    it("counts() returns correct tallies per status", () => {
      const counts = registry.counts();
      expect(counts.open).toBe(1);
      expect(counts.claimed).toBe(1);
      expect(counts.completed).toBe(1);
      expect(counts.failed).toBe(0);
      expect(counts.blocked).toBe(0);
    });
  });

  describe("dependency chain", () => {
    it("task A → task B → task C: completing A unblocks B, completing B unblocks C", () => {
      registry.register({ id: "task-a", description: "Task A", category: "research", demand: 0.9 });
      registry.register({
        id: "task-b",
        description: "Task B",
        category: "code",
        demand: 0.8,
        dependencies: ["task-a"],
      });
      registry.register({
        id: "task-c",
        description: "Task C",
        category: "review",
        demand: 0.7,
        dependencies: ["task-b"],
      });

      expect(registry.get("task-b")!.status).toBe("blocked");
      expect(registry.get("task-c")!.status).toBe("blocked");

      registry.claim("task-a", "agent-1");
      registry.complete("task-a", { result: "Research complete" });

      expect(registry.get("task-b")!.status).toBe("open");
      expect(registry.get("task-c")!.status).toBe("blocked");

      registry.claim("task-b", "agent-2");
      registry.complete("task-b", { result: "Code complete" });

      expect(registry.get("task-c")!.status).toBe("open");
    });

    it("task with multiple deps: only unblocks when ALL deps completed", () => {
      registry.register({ id: "task-a", description: "Task A", category: "research", demand: 0.9 });
      registry.register({ id: "task-b", description: "Task B", category: "writing", demand: 0.8 });
      registry.register({
        id: "task-c",
        description: "Task C",
        category: "general",
        demand: 0.7,
        dependencies: ["task-a", "task-b"],
      });

      expect(registry.get("task-c")!.status).toBe("blocked");

      registry.claim("task-a", "agent-1");
      registry.complete("task-a", { result: "done" });

      expect(registry.get("task-c")!.status).toBe("blocked");

      registry.claim("task-b", "agent-2");
      registry.complete("task-b", { result: "done" });

      expect(registry.get("task-c")!.status).toBe("open");
    });
  });
});
