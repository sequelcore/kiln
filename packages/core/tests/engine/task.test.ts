import { describe, it, expect } from "vitest";
import type { Task, TaskStatus, TreeAction } from "../../src/engine/domain/task.js";

describe("Task interface", () => {
  it("accepts a minimal root task", () => {
    const task: Task = {
      id: "root-1",
      statement: "Implement the authentication module",
      status: "proposed",
      depth: 0,
      priority: 1,
      children: [],
      evidence: [],
    };
    expect(task.id).toBe("root-1");
    expect(task.statement).toBe("Implement the authentication module");
    expect(task.status).toBe("proposed");
    expect(task.depth).toBe(0);
    expect(task.priority).toBe(1);
    expect(task.children).toEqual([]);
    expect(task.evidence).toEqual([]);
    expect(task.parentId).toBeUndefined();
  });

  it("accepts a nested task tree with parent and children", () => {
    const grandchild: Task = {
      id: "child-1-1",
      statement: "Write unit tests for JWT validation",
      status: "active",
      parentId: "child-1",
      depth: 2,
      priority: 0.8,
      children: [],
      evidence: ["test coverage at 85%"],
    };

    const child: Task = {
      id: "child-1",
      statement: "Add JWT token validation",
      status: "active",
      parentId: "root-1",
      depth: 1,
      priority: 0.9,
      children: [grandchild],
      evidence: [],
    };

    const root: Task = {
      id: "root-1",
      statement: "Implement the authentication module",
      status: "proposed",
      depth: 0,
      priority: 1,
      children: [child],
      evidence: [],
    };

    expect(root.children).toHaveLength(1);
    expect(root.children[0]!.id).toBe("child-1");
    expect(root.children[0]!.children[0]!.id).toBe("child-1-1");
    expect(root.children[0]!.children[0]!.depth).toBe(2);
  });

  it("supports all 4 TaskStatus values", () => {
    const statuses: TaskStatus[] = ["proposed", "active", "completed", "pruned"];
    for (const status of statuses) {
      const task: Task = {
        id: `task-${status}`,
        statement: `Task with status ${status}`,
        status,
        depth: 0,
        priority: 1,
        children: [],
        evidence: [],
      };
      expect(task.status).toBe(status);
    }
  });

  it("supports all 3 TreeAction values", () => {
    const actions: TreeAction[] = ["deepen", "branch", "prune"];
    expect(actions).toHaveLength(3);
    expect(actions).toContain("deepen");
    expect(actions).toContain("branch");
    expect(actions).toContain("prune");
  });

  it("accepts a task with evidence", () => {
    const task: Task = {
      id: "task-evidence",
      statement: "Refactor the payment service",
      status: "active",
      depth: 1,
      priority: 0.7,
      children: [],
      evidence: [
        "Legacy code uses deprecated Stripe v2 API",
        "3 integration tests currently failing",
        "Performance profiling shows 200ms latency spike",
      ],
    };
    expect(task.evidence).toHaveLength(3);
    expect(task.evidence[0]).toBe("Legacy code uses deprecated Stripe v2 API");
  });

  it("parentId is optional for root tasks but required for children", () => {
    const root: Task = {
      id: "root",
      statement: "Root task",
      status: "proposed",
      depth: 0,
      priority: 1,
      children: [],
      evidence: [],
    };

    const child: Task = {
      id: "child",
      statement: "Child task",
      status: "proposed",
      parentId: "root",
      depth: 1,
      priority: 0.9,
      children: [],
      evidence: [],
    };

    expect(root.parentId).toBeUndefined();
    expect(child.parentId).toBe("root");
  });
});
