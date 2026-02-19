import { describe, it, expect, vi } from "vitest";
import { SequentialStrategy } from "../../../src/orchestrator/strategies/sequential-strategy.js";
import { EventBus } from "../../../src/events/event-bus.js";
import { TaskTree } from "../../../src/tree/task-tree.js";
import { BatchExecutor } from "../../../src/tree/batch-executor.js";
import type { StrategyContext, StrategyHandler } from "../../../src/orchestrator/strategies/index.js";
import type { Team } from "../../../src/engine/composites/team.js";
import type { BatchResult } from "../../../src/tree/index.js";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    name: "dev",
    agents: {
      worker: { name: "Marcus", role: "Coder", goal: "Write code", tier: "coding", tools: [] },
    },
    workflow: { phases: ["implement"], gates: {} },
    capabilities: [],
    qualityGates: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<StrategyContext> = {}): StrategyContext {
  const eventBus = new EventBus();
  const tree = new TaskTree({ config: { maxDepth: 3, batchSize: 2, depthDiscount: 0.8 }, eventBus });
  const batchExecutor = new BatchExecutor({ concurrency: 2, eventBus });
  return {
    team: makeTeam(),
    eventBus,
    tree,
    batchExecutor,
    sessionId: "test-session",
    ...overrides,
  };
}

function successResult(taskId: string): BatchResult {
  return { taskId, success: true, output: "done", evidence: ["evidence"], durationMs: 10 };
}

describe("SequentialStrategy", () => {
  it("processes all tasks until tree is complete", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task 1", 1);
    ctx.tree.addRoot("task 2", 1);

    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      expect(agentName).toBe("worker");
      return successResult(task.id);
    });

    const strategy = new SequentialStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(result).toHaveLength(2);
    expect(result.every((n) => n.status === "supported")).toBe(true);
  });

  it("uses the first agent key as default agent name", async () => {
    const team = makeTeam({
      agents: {
        alpha: { name: "Alpha", role: "Worker", goal: "Work", tier: "coding", tools: [] },
        beta: { name: "Beta", role: "Worker", goal: "Work", tier: "coding", tools: [] },
      },
    });
    const ctx = makeContext({ team });
    ctx.tree.addRoot("task", 1);

    const agentNames: string[] = [];
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      agentNames.push(agentName);
      return successResult(task.id);
    });

    const strategy = new SequentialStrategy();
    await strategy.execute(ctx, handler);

    expect(agentNames[0]).toBe("alpha");
  });

  it("marks failed tasks as refuted", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("failing task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: false,
      output: "error",
      evidence: [],
      durationMs: 5,
    }));

    const strategy = new SequentialStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(result[0]!.status).toBe("refuted");
  });

  it("returns empty array when tree has no tasks", async () => {
    const ctx = makeContext();

    const handler: StrategyHandler = vi.fn(async (task) => successResult(task.id));

    const strategy = new SequentialStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(result).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("records evidence on tasks", async () => {
    const ctx = makeContext();
    const taskId = ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: true,
      output: "ok",
      evidence: ["file changed", "test passed"],
      durationMs: 10,
    }));

    const strategy = new SequentialStrategy();
    await strategy.execute(ctx, handler);

    const node = ctx.tree.allNodes.find((n) => n.id === taskId)!;
    expect(node.evidence).toContain("file changed");
    expect(node.evidence).toContain("test passed");
  });
});
