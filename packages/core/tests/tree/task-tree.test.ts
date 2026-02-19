import { describe, it, expect, vi } from "vitest";
import { EventBus } from "../../src/events/event-bus.js";
import { TaskTree } from "../../src/tree/task-tree.js";
import type { TreeConfig } from "../../src/tree/index.js";
import type { TaskStartedEvent, TaskCompletedEvent } from "../../src/events/index.js";

const DEFAULT_CONFIG: TreeConfig = {
  maxDepth: 3,
  batchSize: 2,
  depthDiscount: 0.8,
};

function createTree(config: TreeConfig = DEFAULT_CONFIG): {
  tree: TaskTree;
  eventBus: EventBus;
} {
  const eventBus = new EventBus();
  const tree = new TaskTree({ config, eventBus });
  return { tree, eventBus };
}

describe("TaskTree", () => {
  it("creates empty tree", () => {
    const { tree } = createTree();
    expect(tree.allNodes).toHaveLength(0);
    expect(tree.roots).toHaveLength(0);
    expect(tree.pendingCount).toBe(0);
    expect(tree.isComplete).toBe(true);
  });

  it("addRoot creates task at depth 0 with status proposed", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Test hypothesis", 0.9);

    const node = tree.getNode(id);
    expect(node).toBeDefined();
    expect(node!.depth).toBe(0);
    expect(node!.status).toBe("proposed");
    expect(node!.statement).toBe("Test hypothesis");
    expect(node!.priority).toBe(0.9);
    expect(node!.parentId).toBeNull();
    expect(node!.children).toEqual([]);
    expect(node!.evidence).toEqual([]);
  });

  it("addRoots creates multiple root tasks", () => {
    const { tree } = createTree();
    const ids = tree.addRoots([
      { statement: "Task A", priority: 0.8 },
      { statement: "Task B", priority: 0.6 },
      { statement: "Task C", priority: 0.9 },
    ]);

    expect(ids).toHaveLength(3);
    expect(tree.roots).toHaveLength(3);
    expect(tree.allNodes).toHaveLength(3);
  });

  it("selectBatch returns highest-scoring proposed tasks", () => {
    const { tree } = createTree();
    tree.addRoot("Low priority", 0.1);
    tree.addRoot("High priority", 0.9);
    tree.addRoot("Mid priority", 0.5);

    const batch = tree.selectBatch(2);
    expect(batch).toHaveLength(2);
    expect(batch[0]!.priority).toBe(0.9);
    expect(batch[1]!.priority).toBe(0.5);
  });

  it("selectBatch sets selected tasks to testing status", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Task", 0.8);

    const batch = tree.selectBatch();
    expect(batch).toHaveLength(1);
    expect(batch[0]!.status).toBe("testing");

    const node = tree.getNode(id);
    expect(node!.status).toBe("testing");
  });

  it("selectBatch respects batch size", () => {
    const { tree } = createTree();
    tree.addRoots([
      { statement: "A", priority: 0.9 },
      { statement: "B", priority: 0.8 },
      { statement: "C", priority: 0.7 },
      { statement: "D", priority: 0.6 },
    ]);

    const batch = tree.selectBatch(2);
    expect(batch).toHaveLength(2);
    expect(tree.pendingCount).toBe(2);
  });

  it("computeBranchScore applies depth discount", () => {
    const { tree } = createTree();
    const rootId = tree.addRoot("Root", 1.0);
    const childId = tree.applyAction(rootId, "deepen", "Child task");

    const root = tree.getNode(rootId)!;
    const child = tree.getNode(childId!)!;

    // Root: 1.0 * 0.8^0 * 1.0 = 1.0
    expect(root.branchScore).toBeCloseTo(1.0);
    // Child: 1.0 * 0.8^1 * 1.0 = 0.8
    expect(child.branchScore).toBeCloseTo(0.8);
  });

  it("computeBranchScore includes evidence bonus capped at 0.5", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Task", 1.0);

    // No evidence: score = 1.0 * 1.0 * 1.0 = 1.0
    expect(tree.getNode(id)!.branchScore).toBeCloseTo(1.0);

    // 3 evidence items: bonus = min(3 * 0.1, 0.5) = 0.3
    tree.addEvidence(id, "evidence 1");
    tree.addEvidence(id, "evidence 2");
    tree.addEvidence(id, "evidence 3");
    expect(tree.getNode(id)!.branchScore).toBeCloseTo(1.3);

    // 10 evidence items: bonus = min(10 * 0.1, 0.5) = 0.5 (capped)
    for (let i = 4; i <= 10; i++) {
      tree.addEvidence(id, `evidence ${i}`);
    }
    expect(tree.getNode(id)!.branchScore).toBeCloseTo(1.5);
  });

  it("applyAction deepen creates child at depth+1", () => {
    const { tree } = createTree();
    const rootId = tree.addRoot("Root task", 0.9);
    const childId = tree.applyAction(rootId, "deepen", "Child task");

    expect(childId).not.toBeNull();
    const child = tree.getNode(childId!)!;
    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(rootId);
    expect(child.statement).toBe("Child task");
    expect(child.status).toBe("proposed");

    const root = tree.getNode(rootId)!;
    expect(root.children).toContain(childId);
  });

  it("applyAction deepen throws at maxDepth", () => {
    const { tree } = createTree({ ...DEFAULT_CONFIG, maxDepth: 1 });
    const rootId = tree.addRoot("Root", 0.9);
    const childId = tree.applyAction(rootId, "deepen", "Depth 1")!;

    expect(() => tree.applyAction(childId, "deepen", "Depth 2")).toThrow(
      /exceeds maxDepth/,
    );
  });

  it("applyAction branch creates sibling at same depth", () => {
    const { tree } = createTree();
    const rootId = tree.addRoot("Root", 0.9);
    const childId = tree.applyAction(rootId, "deepen", "Child A")!;
    const siblingId = tree.applyAction(childId, "branch", "Child B")!;

    const sibling = tree.getNode(siblingId)!;
    expect(sibling.depth).toBe(1);
    expect(sibling.parentId).toBe(rootId); // Same parent as childId
    expect(sibling.statement).toBe("Child B");

    // Parent should have both children
    const root = tree.getNode(rootId)!;
    expect(root.children).toContain(childId);
    expect(root.children).toContain(siblingId);
  });

  it("applyAction prune sets status to rejected", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Task", 0.9);

    const result = tree.applyAction(id, "prune", "Not useful");
    expect(result).toBeNull();

    const node = tree.getNode(id)!;
    expect(node.status).toBe("rejected");
  });

  it("updateStatus changes task status", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Task", 0.9);

    tree.updateStatus(id, "testing");
    expect(tree.getNode(id)!.status).toBe("testing");

    tree.updateStatus(id, "supported");
    expect(tree.getNode(id)!.status).toBe("supported");
  });

  it("addEvidence appends and recalculates score", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Task", 1.0);
    const initialScore = tree.getNode(id)!.branchScore;

    tree.addEvidence(id, "Found supporting data");
    const afterOne = tree.getNode(id)!;
    expect(afterOne.evidence).toHaveLength(1);
    expect(afterOne.evidence[0]).toBe("Found supporting data");
    expect(afterOne.branchScore).toBeGreaterThan(initialScore);
  });

  it("isComplete returns true when no pending tasks", () => {
    const { tree } = createTree();
    expect(tree.isComplete).toBe(true);

    const id = tree.addRoot("Task", 0.9);
    expect(tree.isComplete).toBe(false);

    tree.updateStatus(id, "supported");
    expect(tree.isComplete).toBe(true);
  });

  it("toJSON serializes entire tree", () => {
    const { tree } = createTree();
    tree.addRoot("Task A", 0.8);
    tree.addRoot("Task B", 0.6);

    const json = tree.toJSON();
    expect(json.config).toEqual(DEFAULT_CONFIG);
    expect(json.nodes).toHaveLength(2);
    expect(json.nodes[0]!.statement).toBe("Task A");
    expect(json.nodes[1]!.statement).toBe("Task B");
  });

  it("getNode returns readonly snapshot", () => {
    const { tree } = createTree();
    const id = tree.addRoot("Task", 0.9);

    const snapshot1 = tree.getNode(id)!;
    tree.addEvidence(id, "new evidence");
    const snapshot2 = tree.getNode(id)!;

    // snapshot1 should NOT reflect the new evidence (it's a snapshot)
    expect(snapshot1.evidence).toHaveLength(0);
    expect(snapshot2.evidence).toHaveLength(1);
  });

  it("emits task_started event on addRoot", () => {
    const { tree, eventBus } = createTree();
    const handler = vi.fn();
    eventBus.on("task_started", handler);

    const id = tree.addRoot("New task", 0.8);

    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as TaskStartedEvent;
    expect(event.type).toBe("task_started");
    expect(event.taskId).toBe(id);
    expect(event.statement).toBe("New task");
    expect(event.parentId).toBeNull();
  });

  it("emits task_completed event on terminal status", () => {
    const { tree, eventBus } = createTree();
    const handler = vi.fn();
    eventBus.on("task_completed", handler);

    const id = tree.addRoot("Task", 0.8);

    // Non-terminal status should NOT emit
    tree.updateStatus(id, "testing");
    expect(handler).not.toHaveBeenCalled();

    // Terminal status should emit
    tree.updateStatus(id, "supported");
    expect(handler).toHaveBeenCalledOnce();
    const event = handler.mock.calls[0]![0] as TaskCompletedEvent;
    expect(event.type).toBe("task_completed");
    expect(event.taskId).toBe(id);
    expect(event.status).toBe("supported");
  });
});
