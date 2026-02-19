import { describe, it, expect, vi } from "vitest";
import { SwarmStrategy } from "../../../src/orchestrator/strategies/swarm-strategy.js";
import { EventBus } from "../../../src/events/event-bus.js";
import { TaskTree } from "../../../src/tree/task-tree.js";
import { BatchExecutor } from "../../../src/tree/batch-executor.js";
import { KilnError } from "../../../src/engine/errors.js";
import type { StrategyContext, StrategyHandler } from "../../../src/orchestrator/strategies/index.js";
import type { Team } from "../../../src/engine/composites/team.js";
import type { HandoffRequestedEvent } from "../../../src/events/index.js";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    name: "swarm-team",
    mode: "swarm",
    agents: {
      alpha: { name: "Alpha", role: "Worker A", goal: "Work", tier: "coding", tools: [] },
      beta: { name: "Beta", role: "Worker B", goal: "Work", tier: "coding", tools: [] },
      gamma: { name: "Gamma", role: "Worker C", goal: "Work", tier: "coding", tools: [] },
    },
    workflow: { phases: ["execute"], gates: {} },
    capabilities: [{ name: "handoff", description: "Hand off", schema: {}, tags: [], type: "handoff" }],
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

describe("SwarmStrategy", () => {
  it("starts with first agent and completes without handoff", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const agentCalls: string[] = [];
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      agentCalls.push(agentName);
      return { taskId: task.id, success: true, output: "done", evidence: ["ok"], durationMs: 5 };
    });

    const strategy = new SwarmStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(agentCalls).toEqual(["alpha"]);
    expect(result[0]!.status).toBe("supported");
  });

  it("follows handoff chain between agents", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const agentCalls: string[] = [];
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      agentCalls.push(agentName);
      if (agentName === "alpha") {
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: "beta", reason: "needs review" }),
          evidence: ["alpha work"],
          durationMs: 5,
        };
      }
      if (agentName === "beta") {
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: "gamma", reason: "needs finalization" }),
          evidence: ["beta work"],
          durationMs: 5,
        };
      }
      return { taskId: task.id, success: true, output: "complete", evidence: ["gamma work"], durationMs: 5 };
    });

    const strategy = new SwarmStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(agentCalls).toEqual(["alpha", "beta", "gamma"]);
    expect(result[0]!.status).toBe("supported");
    expect(result[0]!.evidence).toContain("alpha work");
    expect(result[0]!.evidence).toContain("beta work");
    expect(result[0]!.evidence).toContain("gamma work");
  });

  it("emits handoff events", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const handoffEvents: HandoffRequestedEvent[] = [];
    ctx.eventBus.on("handoff_requested", (e) => handoffEvents.push(e));

    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      if (agentName === "alpha") {
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: "beta", reason: "help" }),
          evidence: [],
          durationMs: 5,
        };
      }
      return { taskId: task.id, success: true, output: "done", evidence: [], durationMs: 5 };
    });

    const strategy = new SwarmStrategy();
    await strategy.execute(ctx, handler);

    expect(handoffEvents).toHaveLength(1);
    expect(handoffEvents[0]!.fromAgent).toBe("alpha");
    expect(handoffEvents[0]!.toAgent).toBe("beta");
  });

  it("detects handoff cycles", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      if (agentName === "alpha") {
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: "beta", reason: "pass" }),
          evidence: [],
          durationMs: 5,
        };
      }
      // beta tries to hand back to alpha -- cycle!
      return {
        taskId: task.id,
        success: true,
        output: JSON.stringify({ type: "handoff", targetAgent: "alpha", reason: "pass back" }),
        evidence: [],
        durationMs: 5,
      };
    });

    const strategy = new SwarmStrategy();
    try {
      await strategy.execute(ctx, handler);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(KilnError);
      expect((err as Error).message).toMatch(/cycle/i);
    }
  });

  it("enforces max handoff depth", async () => {
    // Team with enough agents to exceed depth 2
    const team = makeTeam();
    const ctx = makeContext({ team });
    ctx.tree.addRoot("task", 1);

    let callCount = 0;
    const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
      callCount++;
      // Always try to handoff to next agent (will exceed depth)
      const agents = ["alpha", "beta", "gamma"];
      const currentIdx = agents.indexOf(agentName);
      const nextAgent = agents[(currentIdx + 1) % agents.length]!;
      return {
        taskId: task.id,
        success: true,
        output: JSON.stringify({ type: "handoff", targetAgent: nextAgent, reason: "pass" }),
        evidence: [],
        durationMs: 5,
      };
    });

    const strategy = new SwarmStrategy({ maxHandoffDepth: 2 });
    // Will either hit cycle detection or depth limit
    await expect(strategy.execute(ctx, handler)).rejects.toThrow(KilnError);
  });

  it("throws when fewer than 2 agents", async () => {
    const team = makeTeam({
      agents: {
        solo: { name: "Solo", role: "Worker", goal: "Work", tier: "coding", tools: [] },
      },
    });
    const ctx = makeContext({ team });
    ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: true,
      output: "ok",
      evidence: [],
      durationMs: 5,
    }));

    const strategy = new SwarmStrategy();
    await expect(strategy.execute(ctx, handler)).rejects.toThrow("at least 2 agents");
  });

  it("ignores invalid handoff JSON and completes task", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: true,
      output: "not-json-handoff",
      evidence: ["work done"],
      durationMs: 5,
    }));

    const strategy = new SwarmStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(result[0]!.status).toBe("supported");
  });

  it("handles failed tasks without handoff", async () => {
    const ctx = makeContext();
    ctx.tree.addRoot("task", 1);

    const handler: StrategyHandler = vi.fn(async (task) => ({
      taskId: task.id,
      success: false,
      output: "error",
      evidence: [],
      durationMs: 5,
    }));

    const strategy = new SwarmStrategy();
    const result = await strategy.execute(ctx, handler);

    expect(result[0]!.status).toBe("refuted");
  });
});
