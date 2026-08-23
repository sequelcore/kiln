import { describe, it, expect, vi } from "vitest";
import { SupervisorStrategy } from "../../../src/orchestrator/strategies/supervisor-strategy.js";
import { EventBus } from "../../../src/events/event-bus.js";
import { TaskTree } from "../../../src/tree/task-tree.js";
import { BatchExecutor } from "../../../src/tree/batch-executor.js";
import type { StrategyContext, StrategyHandler } from "../../../src/orchestrator/strategies/index.js";
import type { Team } from "../../../src/engine/composites/team.js";
import type { HandoffRequestedEvent, HandoffCompletedEvent } from "../../../src/events/index.js";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    name: "dev",
    mode: "supervisor",
    manager: "architect",
    agents: {
      architect: { name: "Aria", role: "Architect", goal: "Design", tier: "reasoning", tools: [] },
      worker: { name: "Marcus", role: "Coder", goal: "Write code", tier: "coding", tools: [] },
      reviewer: { name: "Zoe", role: "Reviewer", goal: "Review code", tier: "fast", tools: [] },
    },
    capabilities: [],
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

describe("SupervisorStrategy", () => {
  it("delegates tasks to worker specified by manager", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task 1", 1);

    const callLog: string[] = [];
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      callLog.push(agentName);
      if (agentName === "architect") {
        // Manager decides to delegate to worker
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ assignTo: "worker", instructions: "implement this" }),
          evidence: [],
          durationMs: 5,
        };
      }
      // Worker executes
      return {
        taskId: task.id,
        success: true,
        output: "done",
        evidence: ["code written"],
        durationMs: 10,
      };
    });

    const strategy = new SupervisorStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(callLog).toEqual(["architect", "worker"]);
    expect(result[0]!.status).toBe("supported");
    expect(result[0]!.evidence).toContain("code written");
  });

  it("emits handoff events during delegation", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const handoffEvents: (HandoffRequestedEvent | HandoffCompletedEvent)[] = [];
    ctx.eventBus.on("handoff_requested", (e) => handoffEvents.push(e));
    ctx.eventBus.on("handoff_completed", (e) => handoffEvents.push(e));

    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      if (agentName === "architect") {
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ assignTo: "reviewer", instructions: "review" }),
          evidence: [],
          durationMs: 5,
        };
      }
      return { taskId: task.id, success: true, output: "ok", evidence: [], durationMs: 5 };
    });

    const strategy = new SupervisorStrategy();
    await strategy.execute(ctx, handler);

    expect(handoffEvents).toHaveLength(2);
    expect(handoffEvents[0]!.type).toBe("handoff_requested");
    expect((handoffEvents[0] as HandoffRequestedEvent).toAgent).toBe("reviewer");
    expect(handoffEvents[1]!.type).toBe("handoff_completed");
  });

  it("falls back to first worker when manager output is not valid JSON", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const agentCalls: string[] = [];
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      agentCalls.push(agentName);
      return { taskId: task.id, success: true, output: "not json", evidence: [], durationMs: 5 };
    });

    const strategy = new SupervisorStrategy();
    await strategy.execute(ctx, handler);

    // First call is manager, second is fallback to first worker (worker)
    expect(agentCalls[0]).toBe("architect");
    expect(agentCalls[1]).toBe("worker");
  });

  it("retries when worker fails, up to maxRetriesPerTask", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    let workerCallCount = 0;
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      if (agentName === "architect") {
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ assignTo: "worker", instructions: "try again" }),
          evidence: [],
          durationMs: 5,
        };
      }
      workerCallCount++;
      return { taskId: task.id, success: false, output: "failed", evidence: [], durationMs: 5 };
    });

    const strategy = new SupervisorStrategy({ maxRetriesPerTask: 1 });
    const result = await strategy.execute(ctx, handler);

    expect(workerCallCount).toBe(2); // initial + 1 retry
    expect(result[0]!.status).toBe("refuted");
  });

  it("throws when manager is not set", async () => {
    const team = makeTeam({ manager: undefined });
    const ctx = makeContext({ team });
    ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: true,
      output: "",
      evidence: [],
      durationMs: 5,
    }));

    const strategy = new SupervisorStrategy();
    await expect(strategy.execute(ctx, handler)).rejects.toThrow("requires a manager agent");
  });

  it("throws when no workers besides manager", async () => {
    const team = makeTeam({
      agents: {
        architect: { name: "Aria", role: "Architect", goal: "Design", tier: "reasoning", tools: [] },
      },
    });
    const ctx = makeContext({ team });
    ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: true,
      output: "",
      evidence: [],
      durationMs: 5,
    }));

    const strategy = new SupervisorStrategy();
    await expect(strategy.execute(ctx, handler)).rejects.toThrow("at least one worker");
  });
});
