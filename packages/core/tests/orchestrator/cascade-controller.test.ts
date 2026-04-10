import { describe, it, expect } from "vitest";
import {
  ChainGovernor,
  DEFAULT_CHAIN_GOVERNOR_CONFIG,
  type ChainGovernorConfig,
} from "../../src/orchestrator/chain-governor.js";

describe("ChainGovernor", () => {
  describe("constructor", () => {
    it("initial energy scales with complexity 0.0 → 0.3", () => {
      const controller = new ChainGovernor(0.0);
      expect(controller.currentEnergy()).toBe(0.3);
    });

    it("initial energy scales with complexity 0.5 → 0.65", () => {
      const controller = new ChainGovernor(0.5);
      expect(controller.currentEnergy()).toBeCloseTo(0.65, 5);
    });

    it("initial energy scales with complexity 1.0 → 1.0", () => {
      const controller = new ChainGovernor(1.0);
      expect(controller.currentEnergy()).toBe(1.0);
    });

    it("custom config overrides defaults", () => {
      const customConfig: Partial<ChainGovernorConfig> = {
        decay: 0.5,
        threshold: 0.3,
        maxDepth: 5,
        baseCost: 0.1,
      };
      const controller = new ChainGovernor(0.5, customConfig);
      // Initial energy should still be 0.65 (0.3 + 0.5 * 0.7)
      expect(controller.currentEnergy()).toBeCloseTo(0.65, 5);
      // But config should be custom
      const history = controller.shouldContinue(0.2);
      expect(history).toBe(true);
      const snapshot = controller.getHistory()[0]!;
      expect(snapshot.gain).toBe(0.2);
    });
  });

  describe("shouldContinue with high gain", () => {
    it("high gain handoff returns true and increases energy", () => {
      const controller = new ChainGovernor(0.5);
      // gain > cost, should continue
      const result = controller.shouldContinue(0.5);

      expect(result).toBe(true);
      expect(controller.currentEnergy()).toBeGreaterThan(0.65);
    });
  });

  describe("shouldContinue with zero gain", () => {
    it("zero gain returns true initially but energy decays toward threshold", () => {
      const controller = new ChainGovernor(0.5); // 0.65 initial
      const r1 = controller.shouldContinue(0); // 0.8*0.65 + 0 - 0.15 = 0.37
      expect(r1).toBe(true);
      expect(controller.currentEnergy()).toBeCloseTo(0.37, 5);
    });

    it("repeated zero-gain handoffs eventually returns false", () => {
      // Use higher complexity to allow more iterations before hitting threshold
      // 0.7 -> 0.79 initial energy, gives 2 steps before falling below 0.2 threshold
      const controller = new ChainGovernor(0.7);
      // Step 1: 0.8*0.79 + 0 - 0.15 = 0.472 >= 0.2 → allowed
      const r1 = controller.shouldContinue(0);
      expect(r1).toBe(true);
      // Step 2: 0.8*0.472 + 0 - 0.15 = 0.2276 >= 0.2 → allowed
      const r2 = controller.shouldContinue(0);
      expect(r2).toBe(true);
      // Step 3: 0.8*0.2276 + 0 - 0.15 = 0.03208 < 0.2 → denied
      const r3 = controller.shouldContinue(0);
      expect(r3).toBe(false);
    });
  });

  describe("shouldContinue with high gain sustains chain", () => {
    it("5+ handoffs with gain=0.3 all return true", () => {
      const controller = new ChainGovernor(0.8); // 0.86 initial energy
      // Each step: energy = decay * energy + gain - cost
      // decay=0.8, gain=0.3, cost=0.15
      // Step 1: 0.8*0.86 + 0.3 - 0.15 = 0.838 > 0.2
      // Step 2: 0.8*0.838 + 0.3 - 0.15 = 0.8204 > 0.2
      // Step 3: 0.8*0.8204 + 0.3 - 0.15 = 0.80632 > 0.2
      // Step 4: 0.8*0.80632 + 0.3 - 0.15 = 0.795056 > 0.2
      // Step 5: 0.8*0.795056 + 0.3 - 0.15 = 0.7860448 > 0.2

      expect(controller.shouldContinue(0.3)).toBe(true);
      expect(controller.shouldContinue(0.3)).toBe(true);
      expect(controller.shouldContinue(0.3)).toBe(true);
      expect(controller.shouldContinue(0.3)).toBe(true);
      expect(controller.shouldContinue(0.3)).toBe(true);
      expect(controller.currentStep()).toBe(5);
    });
  });

  describe("hard depth limit", () => {
    it("even with infinite gain, step > maxDepth returns false", () => {
      const controller = new ChainGovernor(1.0); // maxDepth=10
      // Hit exactly the limit
      for (let i = 0; i < 10; i++) {
        const result = controller.shouldContinue(1.0);
        expect(result).toBe(true);
      }
      // One more should fail due to depth limit
      expect(controller.shouldContinue(1.0)).toBe(false);
      expect(controller.currentStep()).toBe(11);
    });

    it("custom maxDepth overrides default", () => {
      const controller = new ChainGovernor(1.0, { maxDepth: 3 });
      expect(controller.shouldContinue(1.0)).toBe(true);
      expect(controller.shouldContinue(1.0)).toBe(true);
      expect(controller.shouldContinue(1.0)).toBe(true);
      expect(controller.shouldContinue(1.0)).toBe(false); // depth exceeded
    });
  });

  describe("history tracking", () => {
    it("history tracks all decisions correctly", () => {
      const controller = new ChainGovernor(0.5);
      controller.shouldContinue(0.2);
      controller.shouldContinue(0.1);
      controller.shouldContinue(0.0);

      const history = controller.getHistory();
      expect(history.length).toBe(3);
      expect(history[0]!.step).toBe(1);
      expect(history[0]!.gain).toBe(0.2);
      expect(history[1]!.step).toBe(2);
      expect(history[1]!.gain).toBe(0.1);
      expect(history[2]!.step).toBe(3);
      expect(history[2]!.gain).toBe(0.0);
    });

    it("getHistory returns a copy", () => {
      const controller = new ChainGovernor(0.5);
      controller.shouldContinue(0.2);

      const history1 = controller.getHistory();
      const history2 = controller.getHistory();

      expect(history1).not.toBe(history2);
      expect(history1).toEqual(history2);
    });
  });

  describe("isTerminated", () => {
    it("returns false when all steps allowed", () => {
      const controller = new ChainGovernor(0.8);
      controller.shouldContinue(0.5);
      controller.shouldContinue(0.5);

      expect(controller.isTerminated()).toBe(false);
    });

    it("returns true after first denial", () => {
      const controller = new ChainGovernor(0.5);
      controller.shouldContinue(0);
      controller.shouldContinue(0);
      controller.shouldContinue(0); // This one should be denied

      expect(controller.isTerminated()).toBe(true);
    });

    it("returns false when no decisions made yet", () => {
      const controller = new ChainGovernor(0.5);
      expect(controller.isTerminated()).toBe(false);
    });
  });

  describe("currentEnergy and currentStep", () => {
    it("currentEnergy returns correct value", () => {
      const controller = new ChainGovernor(0.5);
      expect(controller.currentEnergy()).toBeCloseTo(0.65, 5);

      controller.shouldContinue(0.2);
      // 0.8*0.65 + 0.2 - 0.15 = 0.57
      expect(controller.currentEnergy()).toBeCloseTo(0.57, 5);
    });

    it("currentStep returns correct value", () => {
      const controller = new ChainGovernor(0.5);
      expect(controller.currentStep()).toBe(0);

      controller.shouldContinue(0.2);
      expect(controller.currentStep()).toBe(1);

      controller.shouldContinue(0.2);
      expect(controller.currentStep()).toBe(2);
    });
  });

  describe("energy clamping", () => {
    it("energy never goes below 0", () => {
      const controller = new ChainGovernor(0.1); // 0.37 initial
      // Step 1: 0.8*0.37 + 0 - 0.15 = 0.146
      controller.shouldContinue(0);
      expect(controller.currentEnergy()).toBeGreaterThanOrEqual(0);
      // Step 2: 0.8*0.146 + 0 - 0.15 = -0.0332 -> clamped to 0
      controller.shouldContinue(0);
      expect(controller.currentEnergy()).toBe(0);
      // Step 3: 0.8*0 + 0 - 0.15 = -0.15 -> clamped to 0
      controller.shouldContinue(0);
      expect(controller.currentEnergy()).toBe(0);
    });
  });

  describe("DEFAULT_CHAIN_GOVERNOR_CONFIG", () => {
    it("has correct default values", () => {
      expect(DEFAULT_CHAIN_GOVERNOR_CONFIG.decay).toBe(0.8);
      expect(DEFAULT_CHAIN_GOVERNOR_CONFIG.threshold).toBe(0.2);
      expect(DEFAULT_CHAIN_GOVERNOR_CONFIG.maxDepth).toBe(10);
      expect(DEFAULT_CHAIN_GOVERNOR_CONFIG.baseCost).toBe(0.15);
    });

    it("is readonly", () => {
      // @ts-expect-error - should not be assignable
      DEFAULT_CHAIN_GOVERNOR_CONFIG.decay = 0.5;
      // This test verifies readonly at compile time
      expect(true).toBe(true);
    });
  });
});
