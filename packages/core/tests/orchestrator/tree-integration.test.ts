import { describe, it, expect } from "vitest";
import { Orchestrator } from "../../src/orchestrator/orchestrator.js";
import type { ArchitectPlan, TaskEvaluation } from "../../src/orchestrator/orchestrator.js";
import type { OrchestratorConfig } from "../../src/orchestrator/index.js";
import type { TaskNode } from "../../src/tree/index.js";
import type { BatchResult } from "../../src/tree/index.js";
import { TaskTree } from "../../src/tree/index.js";

function makeConfig(overrides?: Partial<OrchestratorConfig>): Partial<OrchestratorConfig> {
  return {
    requireApproval: false,
    maxDepth: 3,
    parallelWorkers: 2,
    phases: ["analyze", "research", "architect", "implement", "verify", "synthesize"],
    ...overrides,
  };
}

function makePlan(tasks: ArchitectPlan["tasks"]): ArchitectPlan {
  return {
    tasks,
    approach: "Test approach",
    risks: ["risk-1"],
    estimatedComplexity: "medium",
  };
}

const successHandler = async (task: TaskNode, _workerIndex: number): Promise<BatchResult> => ({
  taskId: task.id,
  success: true,
  output: `Completed: ${task.statement}`,
  evidence: [`Evidence for ${task.statement}`],
  durationMs: 100,
});

describe("Orchestrator tree integration", () => {
  it("loadPlan populates tree from Architect plan (root tasks)", () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Add auth module", priority: 1.0, parentId: null },
      { id: "t2", statement: "Add rate limiter", priority: 0.8, parentId: null },
    ]);

    const mapping = orch.loadPlan(plan);

    expect(mapping.size).toBe(2);
    expect(orch.tree.roots).toHaveLength(2);

    const rootStatements = orch.tree.roots.map((r) => r.statement);
    expect(rootStatements).toContain("Add auth module");
    expect(rootStatements).toContain("Add rate limiter");
  });

  it("loadPlan handles tasks with parentId relationships", () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Add auth module", priority: 1.0, parentId: null },
      { id: "t2", statement: "Implement JWT validation", priority: 0.9, parentId: "t1" },
    ]);

    const mapping = orch.loadPlan(plan);

    expect(mapping.size).toBe(2);
    expect(orch.tree.roots).toHaveLength(1);
    expect(orch.tree.allNodes).toHaveLength(2);

    const childTreeId = mapping.get("t2")!;
    const child = orch.tree.getNode(childTreeId)!;
    expect(child.statement).toBe("Implement JWT validation");
    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(mapping.get("t1"));
  });

  it("loadPlan returns id mapping (plan IDs -> tree IDs)", () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "plan-a", statement: "Task A", priority: 1.0, parentId: null },
      { id: "plan-b", statement: "Task B", priority: 0.5, parentId: null },
      { id: "plan-c", statement: "Sub-task of A", priority: 0.7, parentId: "plan-a" },
    ]);

    const mapping = orch.loadPlan(plan);

    expect(mapping.size).toBe(3);
    expect(mapping.has("plan-a")).toBe(true);
    expect(mapping.has("plan-b")).toBe(true);
    expect(mapping.has("plan-c")).toBe(true);

    // Tree IDs are UUIDs, different from plan IDs
    for (const [planId, treeId] of mapping) {
      expect(treeId).not.toBe(planId);
      expect(orch.tree.getNode(treeId)).toBeDefined();
    }
  });

  it("runImplementLoop selects batch and executes handler", async () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Single task", priority: 1.0, parentId: null },
    ]);
    orch.loadPlan(plan);

    const executed: string[] = [];
    const handler = async (task: TaskNode, _workerIndex: number): Promise<BatchResult> => {
      executed.push(task.statement);
      return {
        taskId: task.id,
        success: true,
        output: `Done: ${task.statement}`,
        evidence: [`Evidence for ${task.statement}`],
        durationMs: 50,
      };
    };

    const nodes = await orch.runImplementLoop(handler);

    expect(executed).toEqual(["Single task"]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.status).toBe("supported");
  });

  it("runImplementLoop processes multiple batches until complete", async () => {
    const orch = new Orchestrator(makeConfig({ parallelWorkers: 1 }));
    const plan = makePlan([
      { id: "t1", statement: "First", priority: 1.0, parentId: null },
      { id: "t2", statement: "Second", priority: 0.9, parentId: null },
      { id: "t3", statement: "Third", priority: 0.8, parentId: null },
    ]);
    orch.loadPlan(plan);

    const batches: string[][] = [];
    let currentBatch: string[] = [];

    const handler = async (task: TaskNode, _workerIndex: number): Promise<BatchResult> => {
      currentBatch.push(task.statement);
      return {
        taskId: task.id,
        success: true,
        output: `Done: ${task.statement}`,
        evidence: [`Evidence for ${task.statement}`],
        durationMs: 10,
      };
    };

    // Wrap to track batches (each selectBatch call picks batchSize=1)
    const nodes = await orch.runImplementLoop(async (task, wi) => {
      const result = await handler(task, wi);
      // After each result we'll see batches processed one at a time
      batches.push([task.statement]);
      return result;
    });

    expect(nodes).toHaveLength(3);
    expect(batches).toHaveLength(3);
    // All tasks should be supported
    for (const node of nodes) {
      expect(node.status).toBe("supported");
    }
  });

  it("runImplementLoop handles mixed success/failure results", async () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Good task", priority: 1.0, parentId: null },
      { id: "t2", statement: "Bad task", priority: 0.9, parentId: null },
    ]);
    orch.loadPlan(plan);

    const handler = async (task: TaskNode, _workerIndex: number): Promise<BatchResult> => ({
      taskId: task.id,
      success: task.statement === "Good task",
      output: task.statement,
      evidence: [`Evidence for ${task.statement}`],
      durationMs: 10,
    });

    const nodes = await orch.runImplementLoop(handler);

    const good = nodes.find((n) => n.statement === "Good task")!;
    const bad = nodes.find((n) => n.statement === "Bad task")!;

    expect(good.status).toBe("supported");
    expect(bad.status).toBe("refuted");
  });

  it("evaluateResult applies deepen action (creates child task)", () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Root task", priority: 1.0, parentId: null },
    ]);
    const mapping = orch.loadPlan(plan);
    const rootTreeId = mapping.get("t1")!;

    const evaluation: TaskEvaluation = {
      action: "deepen",
      newTask: { statement: "Sub-task of root", priority: 0.9 },
    };

    const childId = orch.evaluateResult(rootTreeId, evaluation);

    expect(childId).not.toBeNull();
    const child = orch.tree.getNode(childId!)!;
    expect(child.statement).toBe("Sub-task of root");
    expect(child.depth).toBe(1);
    expect(child.parentId).toBe(rootTreeId);
  });

  it("evaluateResult applies branch action (creates sibling)", () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Original approach", priority: 1.0, parentId: null },
    ]);
    const mapping = orch.loadPlan(plan);
    const originalTreeId = mapping.get("t1")!;

    const evaluation: TaskEvaluation = {
      action: "branch",
      newTask: { statement: "Alternative approach", priority: 0.8 },
    };

    const siblingId = orch.evaluateResult(originalTreeId, evaluation);

    expect(siblingId).not.toBeNull();
    const sibling = orch.tree.getNode(siblingId!)!;
    expect(sibling.statement).toBe("Alternative approach");
    expect(sibling.depth).toBe(0); // same depth as original
    expect(sibling.parentId).toBeNull(); // root-level sibling
  });

  it("evaluateResult applies prune action (rejects task)", () => {
    const orch = new Orchestrator(makeConfig());
    const plan = makePlan([
      { id: "t1", statement: "Unproductive task", priority: 1.0, parentId: null },
    ]);
    const mapping = orch.loadPlan(plan);
    const taskTreeId = mapping.get("t1")!;

    const evaluation: TaskEvaluation = {
      action: "prune",
    };

    const result = orch.evaluateResult(taskTreeId, evaluation);

    expect(result).toBeNull();
    const node = orch.tree.getNode(taskTreeId)!;
    expect(node.status).toBe("rejected");
  });

  it("tree getter exposes TaskTree", () => {
    const orch = new Orchestrator(makeConfig());

    expect(orch.tree).toBeInstanceOf(TaskTree);
    expect(orch.tree.allNodes).toHaveLength(0);
    expect(orch.tree.isComplete).toBe(true);

    const plan = makePlan([
      { id: "t1", statement: "A task", priority: 1.0, parentId: null },
    ]);
    orch.loadPlan(plan);

    expect(orch.tree.allNodes).toHaveLength(1);
    expect(orch.tree.isComplete).toBe(false);
  });
});
