import { describe, it, expect } from "vitest";
import {
  DemandAllocator,
  DEFAULT_DEMAND_THRESHOLD,
  DEFAULT_DEMAND_THRESHOLDS,
  type AgentThresholds,
  type TaskDemand,
} from "../../src/orchestrator/demand-allocator.js";

describe("DemandAllocator", () => {
  describe("DEFAULT_DEMAND_THRESHOLDS", () => {
    it("has all 7 categories at 0.5", () => {
      expect(DEFAULT_DEMAND_THRESHOLD).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.research).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.code).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.review).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.ops).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.writing).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.triage).toBe(0.5);
      expect(DEFAULT_DEMAND_THRESHOLDS.general).toBe(0.5);
    });
  });

  describe("allocate", () => {
    it("single agent, demand above threshold → allocated", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
      ]);
      const demand: TaskDemand = { category: "code", demand: 0.5 };
      const result = allocator.allocate(demand);

      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("agent-1");
      expect(result!.margin).toBe(0.2);
    });

    it("single agent, demand below threshold → returns null", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.7 } },
      ]);
      const demand: TaskDemand = { category: "code", demand: 0.5 };
      const result = allocator.allocate(demand);

      expect(result).toBeNull();
    });

    it("two agents, both eligible → agent with lower threshold wins", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.2 } },
        { agentId: "agent-2", thresholds: { code: 0.4 } },
      ]);
      const demand: TaskDemand = { category: "code", demand: 0.5 };
      const result = allocator.allocate(demand);

      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("agent-1");
    });

    it("two agents, same threshold → first in roster wins", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
        { agentId: "agent-2", thresholds: { code: 0.3 } },
      ]);
      const demand: TaskDemand = { category: "code", demand: 0.5 };
      const result = allocator.allocate(demand);

      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("agent-1");
    });
  });

  describe("allocateWithFallback", () => {
    it("when no agent eligible → returns least-resistant agent", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.8 } },
        { agentId: "agent-2", thresholds: { code: 0.6 } },
      ]);
      const demand: TaskDemand = { category: "code", demand: 0.5 };
      const result = allocator.allocateWithFallback(demand);

      expect(result.agentId).toBe("agent-2");
      expect(result.margin).toBeLessThan(0);
    });
  });

  describe("recordOutcome", () => {
    it("appends to log", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: {} },
      ]);

      allocator.recordOutcome({
        agentId: "agent-1",
        category: "code",
        success: true,
        durationMs: 1000,
      });

      const outcomes = allocator.getOutcomes();
      expect(outcomes).toHaveLength(1);
      expect(outcomes[0].agentId).toBe("agent-1");
      expect(outcomes[0].success).toBe(true);
      expect(outcomes[0].durationMs).toBe(1000);
    });
  });

  describe("getThresholds", () => {
    it("returns copy (mutation-safe)", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
      ]);

      const thresholds = allocator.getThresholds("agent-1");
      expect(thresholds!.code).toBe(0.3);

      thresholds!.code = 0.9;

      const after = allocator.getThresholds("agent-1");
      expect(after!.code).toBe(0.3);
    });

    it("returns undefined for unknown agent", () => {
      const allocator = new DemandAllocator([]);
      const thresholds = allocator.getThresholds("unknown");

      expect(thresholds).toBeUndefined();
    });

    it("returns all categories with defaults merged", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
      ]);

      const thresholds = allocator.getThresholds("agent-1");
      expect(thresholds).toEqual({
        research: 0.5,
        code: 0.3,
        review: 0.5,
        ops: 0.5,
        writing: 0.5,
        triage: 0.5,
        general: 0.5,
      });
    });
  });

  describe("constructor", () => {
    it("merges with defaults", () => {
      const allocator = new DemandAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
      ]);

      const thresholds = allocator.getThresholds("agent-1");
      expect(thresholds!.code).toBe(0.3);
      expect(thresholds!.research).toBe(0.5);
      expect(thresholds!.general).toBe(0.5);
    });
  });
});
