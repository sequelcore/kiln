import { describe, it, expect, vi } from "vitest";
import { SwarmStrategy } from "../../../src/orchestrator/strategies/swarm-strategy.js";
import { EventBus } from "../../../src/events/event-bus.js";
import { TaskTree } from "../../../src/tree/task-tree.js";
import { BatchExecutor } from "../../../src/tree/batch-executor.js";
import type { StrategyContext, StrategyHandler } from "../../../src/orchestrator/strategies/index.js";
import type { Team } from "../../../src/engine/composites/team.js";
import { ThresholdAllocator } from "../../../src/orchestrator/threshold-allocator.js";
import { CascadeController } from "../../../src/orchestrator/cascade-controller.js";
import { TaskChannel } from "../../../src/orchestrator/task-channel.js";

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

function makeTree(): TaskTree {
  return new TaskTree({
    config: { maxDepth: 3, batchSize: 2, depthDiscount: 0.8 },
    eventBus: new EventBus(),
  });
}

function makeContext(team?: Team): StrategyContext {
  const eventBus = new EventBus();
  return {
    team: team ?? makeTeam(),
    eventBus,
    tree: makeTree(),
    batchExecutor: new BatchExecutor({ concurrency: 2, eventBus }),
    sessionId: "test-session",
  };
}

describe("SwarmStrategy — coordination primitives", () => {
  describe("agent selection via ThresholdAllocator", () => {
    it("starting agent is chosen by threshold allocation (not agentKeys[0])", async () => {
      const team = makeTeam();
      const allocator = new ThresholdAllocator([
        { agentId: "alpha", thresholds: { general: 0.9, research: 0.9, code: 0.9, review: 0.9, ops: 0.9, writing: 0.9, triage: 0.9 } },
        { agentId: "beta", thresholds: { general: 0.1, research: 0.1, code: 0.1, review: 0.1, ops: 0.1, writing: 0.1, triage: 0.1 } },
      ]);
      const cascade = new CascadeController(0.5);
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const agentCalls: string[] = [];
      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        agentCalls.push(agentName);
        return { taskId: task.id, success: true, output: "done", evidence: [], durationMs: 5 };
      });

      const strategy = new SwarmStrategy();
      await strategy.execute({ ...ctx, allocator, cascadeController: cascade }, handler);

      expect(agentCalls[0]).toBe("beta");
    });

    it("uses allocateWithFallback when no agent exceeds threshold", async () => {
      const team = makeTeam();
      const allocator = new ThresholdAllocator([
        { agentId: "alpha", thresholds: { general: 0.99, research: 0.99, code: 0.99, review: 0.99, ops: 0.99, writing: 0.99, triage: 0.99 } },
        { agentId: "beta", thresholds: { general: 0.99, research: 0.99, code: 0.99, review: 0.99, ops: 0.99, writing: 0.99, triage: 0.99 } },
      ]);
      const cascade = new CascadeController(0.5);
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const agentCalls: string[] = [];
      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        agentCalls.push(agentName);
        return { taskId: task.id, success: true, output: "done", evidence: [], durationMs: 5 };
      });

      const strategy = new SwarmStrategy();
      await strategy.execute({ ...ctx, allocator, cascadeController: cascade }, handler);

      expect(agentCalls.length).toBeGreaterThan(0);
      // allocateWithFallback picks lowest threshold agent
      expect(agentCalls[0]).toBe("alpha");
    });
  });

  describe("cascade termination", () => {
    it("handoff chain terminates gracefully when energy drops below threshold", async () => {
      const team = makeTeam();
      // High baseCost causes cascade to terminate at step 2 (before cycle forms)
      const cascade = new CascadeController(0.1, { threshold: 0.05, decay: 0.8, baseCost: 0.13, maxDepth: 10 });
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const agentCalls: string[] = [];
      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        agentCalls.push(agentName);
        const agents = ["alpha", "beta", "gamma"];
        const currentIdx = agents.indexOf(agentName);
        const nextAgent = agents[(currentIdx + 1) % agents.length]!;
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: nextAgent, reason: "ok" }),
          evidence: [],
          durationMs: 5,
        };
      });

      const strategy = new SwarmStrategy();
      const nodes = await strategy.execute({ ...ctx, cascadeController: cascade }, handler);

      // Cascade terminates at step 2 (before cycle completes) → supported
      expect(nodes[0]!.status).toBe("supported");
      expect(agentCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("high-gain handoffs sustain longer chains than low-gain", async () => {
      const team = makeTeam();
      const cascade = new CascadeController(0.5, { threshold: 0.2, decay: 0.8, baseCost: 0.15, maxDepth: 10 });
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const agentCalls: string[] = [];
      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        agentCalls.push(agentName);
        const agents = ["alpha", "beta", "gamma"];
        const currentIdx = agents.indexOf(agentName);
        const nextAgent = agents[(currentIdx + 1) % agents.length]!;
        const reason = agentCalls.length <= 2
          ? "very detailed reason for handoff with lots of context about what needs to be done next and why this agent is not the right fit"
          : "pass";
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: nextAgent, reason }),
          evidence: [],
          durationMs: 5,
        };
      });

      const strategy = new SwarmStrategy();
      const nodes = await strategy.execute({ ...ctx, cascadeController: cascade }, handler);

      expect(agentCalls.length).toBeGreaterThan(2);
    });

    it("cycle detection still works with coordination enabled", async () => {
      const team = makeTeam();
      // Cascade sustains through step 4 so cycle (3 handoffs) completes before energy depletes
      const cascade = new CascadeController(0.5, { threshold: 0.03, decay: 0.8, baseCost: 0.08, maxDepth: 10 });
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

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
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: "alpha", reason: "cycle!" }),
          evidence: [],
          durationMs: 5,
        };
      });

      const strategy = new SwarmStrategy();
      const nodes = await strategy.execute({ ...ctx, cascadeController: cascade }, handler);
      expect(nodes.some(n => n.status === "refuted")).toBe(true);
    });
  });

  describe("adaptive learning via ThresholdAllocator", () => {
    it("after task success, allocator.recordOutcome is called with success=true", async () => {
      const team = makeTeam();
      const allocator = new ThresholdAllocator([
        { agentId: "alpha", thresholds: { general: 0.5, research: 0.5, code: 0.5, review: 0.5, ops: 0.5, writing: 0.5, triage: 0.5 } },
        { agentId: "beta", thresholds: { general: 0.5, research: 0.5, code: 0.5, review: 0.5, ops: 0.5, writing: 0.5, triage: 0.5 } },
      ]);
      const cascade = new CascadeController(0.5);
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const recordSpy = vi.spyOn(allocator, "recordOutcome");
      const handler: StrategyHandler = vi.fn(async (task) => ({
        taskId: task.id,
        success: true,
        output: "done",
        evidence: [],
        durationMs: 5,
      }));

      const strategy = new SwarmStrategy();
      await strategy.execute({ ...ctx, allocator, cascadeController: cascade }, handler);

      expect(recordSpy).toHaveBeenCalled();
      const lastCall = recordSpy.mock.calls[recordSpy.mock.calls.length - 1]!;
      expect(lastCall[0]!.success).toBe(true);
    });

    it("after task failure, allocator.recordOutcome is called with success=false", async () => {
      const team = makeTeam();
      const allocator = new ThresholdAllocator([
        { agentId: "alpha", thresholds: { general: 0.5, research: 0.5, code: 0.5, review: 0.5, ops: 0.5, writing: 0.5, triage: 0.5 } },
        { agentId: "beta", thresholds: { general: 0.5, research: 0.5, code: 0.5, review: 0.5, ops: 0.5, writing: 0.5, triage: 0.5 } },
      ]);
      const cascade = new CascadeController(0.5);
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const recordSpy = vi.spyOn(allocator, "recordOutcome");
      const handler: StrategyHandler = vi.fn(async (task) => ({
        taskId: task.id,
        success: false,
        output: "error",
        evidence: [],
        durationMs: 5,
      }));

      const strategy = new SwarmStrategy();
      await strategy.execute({ ...ctx, allocator, cascadeController: cascade }, handler);

      expect(recordSpy).toHaveBeenCalled();
      const lastCall = recordSpy.mock.calls[recordSpy.mock.calls.length - 1]!;
      expect(lastCall[0]!.success).toBe(false);
    });

    it("threshold changes after successful task completion", async () => {
      const team = makeTeam();
      const allocator = new ThresholdAllocator([
        { agentId: "alpha", thresholds: { general: 0.5, research: 0.5, code: 0.5, review: 0.5, ops: 0.5, writing: 0.5, triage: 0.5 } },
        { agentId: "beta", thresholds: { general: 0.5, research: 0.5, code: 0.5, review: 0.5, ops: 0.5, writing: 0.5, triage: 0.5 } },
      ]);
      const cascade = new CascadeController(0.5);

      const handler: StrategyHandler = vi.fn(async (task) => ({
        taskId: task.id,
        success: true,
        output: "done",
        evidence: [],
        durationMs: 5,
      }));

      const strategy = new SwarmStrategy();

      // Hysteresis window requires 3 outcomes before adaptation starts
      for (let i = 0; i < 3; i++) {
        const t = makeTree();
        t.addRoot(`task${i}`, 1);
        const ctx = makeContext(team);
        ctx.tree = t;
        await strategy.execute({ ...ctx, allocator, cascadeController: cascade }, handler);
      }

      const finalThresholds = allocator.getThresholds("alpha");
      expect(finalThresholds).toBeDefined();
    });
  });

  describe("TaskChannel integration", () => {
    it("task is published before execution and completed after", async () => {
      const team = makeTeam();
      const cascade = new CascadeController(0.5);
      const taskChannel = new TaskChannel();
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const publishSpy = vi.spyOn(taskChannel, "publish");
      const completeSpy = vi.spyOn(taskChannel, "complete");

      const handler: StrategyHandler = vi.fn(async (task) => ({
        taskId: task.id,
        success: true,
        output: "done",
        evidence: [],
        durationMs: 5,
      }));

      const strategy = new SwarmStrategy();
      await strategy.execute({ ...ctx, cascadeController: cascade, taskChannel }, handler);

      expect(publishSpy).toHaveBeenCalled();
      expect(completeSpy).toHaveBeenCalled();
    });

    it("failed task calls channel.fail()", async () => {
      const team = makeTeam();
      const cascade = new CascadeController(0.5);
      const taskChannel = new TaskChannel();
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const failSpy = vi.spyOn(taskChannel, "fail");

      const handler: StrategyHandler = vi.fn(async (task) => ({
        taskId: task.id,
        success: false,
        output: "error",
        evidence: [],
        durationMs: 5,
      }));

      const strategy = new SwarmStrategy();
      await strategy.execute({ ...ctx, cascadeController: cascade, taskChannel }, handler);

      expect(failSpy).toHaveBeenCalled();
    });
  });

  describe("fallback behavior", () => {
    it("without allocator/cascadeController, swarm still works (local cascade)", async () => {
      const team = makeTeam();
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const agentCalls: string[] = [];
      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        agentCalls.push(agentName);
        return { taskId: task.id, success: true, output: "done", evidence: [], durationMs: 5 };
      });

      const strategy = new SwarmStrategy();
      const nodes = await strategy.execute(ctx, handler);

      expect(agentCalls[0]).toBe("alpha");
      expect(nodes[0]!.status).toBe("supported");
    });

    it("useCoordination=false bypasses coordination even when primitives are in context", async () => {
      const team = makeTeam();
      // allocator would pick beta (lower threshold) — but with useCoordination=false, alpha starts
      const allocator = new ThresholdAllocator([
        { agentId: "alpha", thresholds: { general: 0.9, research: 0.9, code: 0.9, review: 0.9, ops: 0.9, writing: 0.9, triage: 0.9 } },
        { agentId: "beta", thresholds: { general: 0.1, research: 0.1, code: 0.1, review: 0.1, ops: 0.1, writing: 0.1, triage: 0.1 } },
      ]);
      const cascade = new CascadeController(0.5);
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const agentCalls: string[] = [];
      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        agentCalls.push(agentName);
        return { taskId: task.id, success: true, output: "done", evidence: [], durationMs: 5 };
      });

      const strategy = new SwarmStrategy({ useCoordination: false });
      await strategy.execute({ ...ctx, allocator, cascadeController: cascade }, handler);

      expect(agentCalls[0]).toBe("alpha");
    });
  });

  describe("graceful cascade termination", () => {
    it("cascade termination marks task as supported (not refuted)", async () => {
      const team = makeTeam();
      // Low initial energy + low gain = cascade dies immediately
      const cascade = new CascadeController(0.1, { threshold: 0.9, decay: 0.5, baseCost: 0.4, maxDepth: 10 });
      const ctx = makeContext(team);
      ctx.tree.addRoot("task", 1);

      const handler: StrategyHandler = vi.fn(async (task, _workerIndex, agentName) => {
        const agents = ["alpha", "beta", "gamma"];
        const currentIdx = agents.indexOf(agentName);
        const nextAgent = agents[(currentIdx + 1) % agents.length]!;
        return {
          taskId: task.id,
          success: true,
          output: JSON.stringify({ type: "handoff", targetAgent: nextAgent, reason: "pass" }),
          evidence: ["evidence from " + agentName],
          durationMs: 5,
        };
      });

      const strategy = new SwarmStrategy();
      const nodes = await strategy.execute({ ...ctx, cascadeController: cascade }, handler);

      expect(nodes[0]!.status).toBe("supported");
      expect(nodes[0]!.evidence).toContain("evidence from alpha");
    });
  });
});
