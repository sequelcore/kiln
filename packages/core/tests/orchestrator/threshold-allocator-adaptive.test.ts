import { describe, it, expect } from "vitest";
import {
  ThresholdAllocator,
  DEFAULT_ADAPTIVE_CONFIG,
  type TaskDemand,
} from "../../src/orchestrator/threshold-allocator.js";

describe("ThresholdAllocator Adaptive Mode (8.3e)", () => {
  describe("DEFAULT_ADAPTIVE_CONFIG", () => {
    it("has correct defaults", () => {
      expect(DEFAULT_ADAPTIVE_CONFIG.alpha).toBe(0.1);
      expect(DEFAULT_ADAPTIVE_CONFIG.successDelta).toBe(-0.05);
      expect(DEFAULT_ADAPTIVE_CONFIG.failureDelta).toBe(0.08);
      expect(DEFAULT_ADAPTIVE_CONFIG.floor).toBe(0.05);
      expect(DEFAULT_ADAPTIVE_CONFIG.ceiling).toBe(0.95);
      expect(DEFAULT_ADAPTIVE_CONFIG.hysteresisWindow).toBe(3);
    });
  });

  describe("hysteresis protection", () => {
    it("no adaptation until hysteresisWindow outcomes recorded", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5);
    });

    it("adaptation triggers on outcome after hysteresisWindow", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThan(0.5);
    });
  });

  describe("successful outcome lowers threshold", () => {
    it("success decreases threshold for that category", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 4; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThan(0.5);
      expect(allocator.getThresholds("agent-1")!.code).toBeCloseTo(0.49, 2);
    });

    it("multiple successes compound threshold decrease", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 6; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThanOrEqual(0.48);
      expect(allocator.getThresholds("agent-1")!.code).toBeGreaterThanOrEqual(0.47);
    });
  });

  describe("failed outcome raises threshold", () => {
    it("failure increases threshold for that category", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 3; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: false });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5 + 0.1 * 0.08);
    });
  });

  describe("floor constraint", () => {
    it("threshold never goes below floor", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.1 } },
      ], { floor: 0.05 });

      for (let i = 0; i < 20; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBeGreaterThanOrEqual(0.05);
      expect(allocator.getThresholds("agent-1")!.code).toBeCloseTo(0.05, 5);
    });
  });

  describe("ceiling constraint", () => {
    it("threshold never goes above ceiling", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.9 } },
      ], { ceiling: 0.95 });

      for (let i = 0; i < 20; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: false });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThanOrEqual(0.95);
      expect(allocator.getThresholds("agent-1")!.code).toBeCloseTo(0.95, 5);
    });
  });

  describe("alpha controls adaptation speed", () => {
    it("higher alpha produces larger threshold changes", () => {
      const slow = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ], { alpha: 0.05 });

      const fast = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ], { alpha: 0.3 });

      for (let i = 0; i < 4; i++) {
        slow.recordOutcome({ agentId: "agent-1", category: "code", success: true });
        fast.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(slow.getThresholds("agent-1")!.code).toBeGreaterThan(fast.getThresholds("agent-1")!.code);
    });
  });

  describe("per-agent per-category isolation", () => {
    it("agent A success on code doesn't affect agent A on review", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5, review: 0.5 } },
      ]);

      for (let i = 0; i < 5; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThan(0.5);
      expect(allocator.getThresholds("agent-1")!.review).toBe(0.5);
    });

    it("agent A success doesn't affect agent B", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
        { agentId: "agent-2", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 5; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThan(0.5);
      expect(allocator.getThresholds("agent-2")!.code).toBe(0.5);
    });
  });

  describe("resetAdaptation", () => {
    it("resetAdaptation(agentId) resets specific agent to initial thresholds", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
        { agentId: "agent-2", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 5; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
        allocator.recordOutcome({ agentId: "agent-2", category: "code", success: false });
      }

      allocator.resetAdaptation("agent-1");

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5);
      expect(allocator.getThresholds("agent-2")!.code).toBeGreaterThan(0.5);
      expect(allocator.getOutcomes().filter((o) => o.agentId === "agent-1")).toHaveLength(0);
      expect(allocator.getOutcomes().filter((o) => o.agentId === "agent-2")).toHaveLength(5);
    });

    it("resetAdaptation() resets all agents", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
        { agentId: "agent-2", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 5; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
        allocator.recordOutcome({ agentId: "agent-2", category: "code", success: false });
      }

      allocator.resetAdaptation();

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5);
      expect(allocator.getThresholds("agent-2")!.code).toBe(0.5);
      expect(allocator.getOutcomes()).toHaveLength(0);
    });

    it("resetAdaptation respects custom initial thresholds", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
      ]);

      for (let i = 0; i < 5; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      allocator.resetAdaptation("agent-1");

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.3);
    });
  });

  describe("allocate uses adapted thresholds", () => {
    it("agent becomes eligible after threshold lowered by learning", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 4; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      const threshold = allocator.getThresholds("agent-1")!.code;
      expect(threshold).toBeLessThan(0.5);

      const demand: TaskDemand = { category: "code", demand: threshold + 0.01 };
      const result = allocator.allocate(demand);
      expect(result).not.toBeNull();
      expect(result!.agentId).toBe("agent-1");
    });

    it("agent becomes ineligible after threshold raised by failures", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ]);

      for (let i = 0; i < 13; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: false });
      }

      const threshold = allocator.getThresholds("agent-1")!.code;
      expect(threshold).toBeGreaterThan(0.5);

      const demand: TaskDemand = { category: "code", demand: 0.5 };
      expect(allocator.allocate(demand)).toBeNull();
    });

    it("agents with lower adapted thresholds win allocation", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.3 } },
        { agentId: "agent-2", thresholds: { code: 0.3 } },
      ]);

      for (let i = 0; i < 3; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
        allocator.recordOutcome({ agentId: "agent-2", category: "code", success: false });
      }

      const demand: TaskDemand = { category: "code", demand: 0.5 };
      const result = allocator.allocate(demand);

      expect(result!.agentId).toBe("agent-1");
    });
  });

  describe("custom adaptiveConfig overrides", () => {
    it("custom alpha", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ], { alpha: 0.5 });

      for (let i = 0; i < 3; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5 + 0.5 * (-0.05));
    });

    it("custom successDelta and failureDelta", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ], { successDelta: -0.1, failureDelta: 0.15 });

      for (let i = 0; i < 3; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
        allocator.recordOutcome({ agentId: "agent-1", category: "review", success: false });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5 + 0.1 * (-0.1));
      expect(allocator.getThresholds("agent-1")!.review).toBe(0.5 + 0.1 * 0.15);
    });

    it("custom hysteresisWindow", () => {
      const allocator = new ThresholdAllocator([
        { agentId: "agent-1", thresholds: { code: 0.5 } },
      ], { hysteresisWindow: 5 });

      for (let i = 0; i < 4; i++) {
        allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });
      }

      expect(allocator.getThresholds("agent-1")!.code).toBe(0.5);

      allocator.recordOutcome({ agentId: "agent-1", category: "code", success: true });

      expect(allocator.getThresholds("agent-1")!.code).toBeLessThan(0.5);
    });
  });
});
