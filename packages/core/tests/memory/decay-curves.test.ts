import { describe, it, expect } from "vitest";
import {
  exponentialDecay,
  linearDecay,
  stepDecay,
  applyDecayCurve,
  shouldPrune,
  DEFAULT_DECAY_CONFIG,
} from "../../src/memory/decay-curves.js";
import type { DecayConfig } from "../../src/memory/decay-curves.js";

describe("exponentialDecay", () => {
  it("multiplies score by factor", () => {
    expect(exponentialDecay(1.0, 0.95)).toBeCloseTo(0.95);
    expect(exponentialDecay(0.5, 0.9)).toBeCloseTo(0.45);
  });

  it("decays to near-zero after many cycles", () => {
    let score = 1.0;
    for (let i = 0; i < 100; i++) score = exponentialDecay(score, 0.95);
    expect(score).toBeLessThan(0.01);
  });

  it("preserves zero score", () => {
    expect(exponentialDecay(0, 0.95)).toBe(0);
  });
});

describe("linearDecay", () => {
  it("subtracts factor from score", () => {
    expect(linearDecay(1.0, 0.1)).toBeCloseTo(0.9);
    expect(linearDecay(0.5, 0.1)).toBeCloseTo(0.4);
  });

  it("floors at zero", () => {
    expect(linearDecay(0.05, 0.1)).toBe(0);
    expect(linearDecay(0, 0.1)).toBe(0);
  });

  it("reaches zero in predictable steps", () => {
    let score = 1.0;
    let steps = 0;
    while (score > 0) {
      score = linearDecay(score, 0.25);
      steps++;
    }
    expect(steps).toBe(4); // 1.0 -> 0.75 -> 0.50 -> 0.25 -> 0.0
  });
});

describe("stepDecay", () => {
  it("returns 1 when age is within threshold", () => {
    expect(stepDecay(3, 7)).toBe(1); // 3 days < 7 day threshold
    expect(stepDecay(7, 7)).toBe(1); // exactly at threshold
  });

  it("returns 0 when age exceeds threshold", () => {
    expect(stepDecay(8, 7)).toBe(0);
    expect(stepDecay(30, 7)).toBe(0);
  });

  it("handles zero age", () => {
    expect(stepDecay(0, 7)).toBe(1);
  });
});

describe("applyDecayCurve", () => {
  it("routes to exponential", () => {
    const config: DecayConfig = { curve: "exponential", factor: 0.9, pruneThreshold: 0.01 };
    expect(applyDecayCurve(1.0, config)).toBeCloseTo(0.9);
  });

  it("routes to linear", () => {
    const config: DecayConfig = { curve: "linear", factor: 0.2, pruneThreshold: 0.01 };
    expect(applyDecayCurve(1.0, config)).toBeCloseTo(0.8);
  });

  it("routes to step with ageInDays", () => {
    const config: DecayConfig = { curve: "step", factor: 7, pruneThreshold: 0.01 };
    expect(applyDecayCurve(1.0, config, 3)).toBe(1);
    expect(applyDecayCurve(1.0, config, 10)).toBe(0);
  });

  it("step uses 0 ageInDays when not provided", () => {
    const config: DecayConfig = { curve: "step", factor: 7, pruneThreshold: 0.01 };
    expect(applyDecayCurve(1.0, config)).toBe(1); // 0 days < 7
  });
});

describe("shouldPrune", () => {
  it("returns true below threshold", () => {
    expect(shouldPrune(0.005, 0.01)).toBe(true);
  });

  it("returns false at or above threshold", () => {
    expect(shouldPrune(0.01, 0.01)).toBe(false);
    expect(shouldPrune(0.5, 0.01)).toBe(false);
  });
});

describe("DEFAULT_DECAY_CONFIG", () => {
  it("uses exponential curve with standard values", () => {
    expect(DEFAULT_DECAY_CONFIG.curve).toBe("exponential");
    expect(DEFAULT_DECAY_CONFIG.factor).toBe(0.95);
    expect(DEFAULT_DECAY_CONFIG.pruneThreshold).toBe(0.01);
  });
});
