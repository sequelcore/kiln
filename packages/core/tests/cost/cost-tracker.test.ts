import { describe, it, expect } from "vitest";
import { CostTracker, MODEL_PRICING } from "../../src/cost/cost-tracker.js";
import { EventBus } from "../../src/events/event-bus.js";
import type { CostUpdateEvent } from "../../src/events/index.js";

function makeBus(): EventBus {
  return new EventBus();
}

describe("CostTracker", () => {
  it("records usage for a single role", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    tracker.record("architect", "claude-opus-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    const summary = tracker.summary;
    expect(summary.totalInputTokens).toBe(1000);
    expect(summary.totalOutputTokens).toBe(500);
    expect(summary.totalToolCalls).toBe(1);
    expect(summary.byRole["architect"]).toBeDefined();
    expect(summary.byRole["architect"]!.inputTokens).toBe(1000);
    expect(summary.byRole["architect"]!.outputTokens).toBe(500);
    expect(summary.byRole["architect"]!.calls).toBe(1);
  });

  it("computes correct USD cost without cache tokens", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    // Opus: $15/M input, $75/M output
    tracker.record("architect", "claude-opus-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    // Expected: (1M * 15 + 1M * 75) / 1M = $90
    expect(tracker.costForRole("architect")).toBeCloseTo(90, 6);
    expect(tracker.summary.totalCostUsd).toBeCloseTo(90, 6);
  });

  it("computes correct cache-aware pricing", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    // Sonnet: $3/M input, $15/M output
    // 1000 input, 200 cache read, 100 cache write => 700 uncached
    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
    });

    // uncachedInput = 1000 - 200 - 100 = 700
    // cost = (700 * 3 + 500 * 15 + 200 * 3 * 0.1 + 100 * 3 * 1.25) / 1_000_000
    //      = (2100 + 7500 + 60 + 375) / 1_000_000
    //      = 10035 / 1_000_000
    //      = 0.010035
    expect(tracker.costForRole("worker")).toBeCloseTo(0.010035, 8);
  });

  it("uncached input cannot go below zero", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    // cacheRead + cacheWrite > inputTokens
    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadTokens: 80,
      cacheWriteTokens: 50,
    });

    // uncachedInput = max(0, 100 - 80 - 50) = 0
    // cost = (0 * 3 + 200 * 15 + 80 * 3 * 0.1 + 50 * 3 * 1.25) / 1_000_000
    //      = (0 + 3000 + 24 + 187.5) / 1_000_000
    //      = 3211.5 / 1_000_000
    const cost = tracker.costForRole("worker");
    expect(cost).toBeCloseTo(0.0032115, 8);
  });

  it("accumulates across multiple records for the same role", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 300,
      outputTokens: 100,
      cacheReadTokens: 50,
      cacheWriteTokens: 0,
    });

    const summary = tracker.summary;
    expect(summary.totalInputTokens).toBe(800);
    expect(summary.totalOutputTokens).toBe(300);
    expect(summary.totalCacheReadTokens).toBe(50);
    expect(summary.totalToolCalls).toBe(2);
    expect(summary.byRole["worker"]!.calls).toBe(2);
  });

  it("tracks multiple roles independently", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    tracker.record("architect", "claude-opus-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.record("optimizer", "claude-haiku-4-5-20251001", {
      inputTokens: 500,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    const summary = tracker.summary;
    expect(summary.totalInputTokens).toBe(3500);
    expect(summary.totalOutputTokens).toBe(1600);
    expect(summary.totalToolCalls).toBe(3);
    expect(Object.keys(summary.byRole)).toHaveLength(3);

    // Verify per-role costs are different due to different pricing
    const architectCost = tracker.costForRole("architect");
    const workerCost = tracker.costForRole("worker");
    const optimizerCost = tracker.costForRole("optimizer");

    // architect: (1000*15 + 500*75) / 1M = 0.0525
    expect(architectCost).toBeCloseTo(0.0525, 6);
    // worker: (2000*3 + 1000*15) / 1M = 0.021
    expect(workerCost).toBeCloseTo(0.021, 6);
    // optimizer: (500*0.8 + 100*4) / 1M = 0.0008
    expect(optimizerCost).toBeCloseTo(0.0008, 6);

    expect(summary.totalCostUsd).toBeCloseTo(architectCost + workerCost + optimizerCost, 6);
  });

  it("summary returns zero totals when no usage recorded", () => {
    const bus = makeBus();
    const tracker = new CostTracker();
    const summary = tracker.summary;

    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.totalCacheReadTokens).toBe(0);
    expect(summary.totalCacheWriteTokens).toBe(0);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(Object.keys(summary.byRole)).toHaveLength(0);
  });

  it("reset clears all accumulated usage", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    tracker.record("architect", "claude-opus-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.reset();

    const summary = tracker.summary;
    expect(summary.totalInputTokens).toBe(0);
    expect(summary.totalOutputTokens).toBe(0);
    expect(summary.totalToolCalls).toBe(0);
    expect(summary.totalCostUsd).toBe(0);
    expect(Object.keys(summary.byRole)).toHaveLength(0);
    expect(tracker.costForRole("architect")).toBe(0);
  });

  it("costForRole returns 0 for unrecorded role", () => {
    const bus = makeBus();
    const tracker = new CostTracker();
    expect(tracker.costForRole("optimizer")).toBe(0);
  });

  it("unknown model uses zero pricing (no crash)", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    tracker.record("worker", "unknown-model-xyz", {
      inputTokens: 10000,
      outputTokens: 5000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    expect(tracker.costForRole("worker")).toBe(0);
    expect(tracker.summary.totalCostUsd).toBe(0);
    // Tokens are still tracked even without pricing
    expect(tracker.summary.totalInputTokens).toBe(10000);
    expect(tracker.summary.totalOutputTokens).toBe(5000);
    expect(tracker.summary.totalToolCalls).toBe(1);
  });

  it("MODEL_PRICING contains all Claude models", () => {
    expect(MODEL_PRICING.has("claude-opus-4-6")).toBe(true);
    expect(MODEL_PRICING.has("claude-sonnet-4-6")).toBe(true);
    expect(MODEL_PRICING.has("claude-haiku-4-5-20251001")).toBe(true);
  });

  it("MODEL_PRICING has correct rates", () => {
    const opus = MODEL_PRICING.get("claude-opus-4-6")!;
    expect(opus.inputRate).toBe(15);
    expect(opus.outputRate).toBe(75);
    expect(opus.cacheReadMultiplier).toBe(0.1);
    expect(opus.cacheWriteMultiplier).toBe(1.25);

    const sonnet = MODEL_PRICING.get("claude-sonnet-4-6")!;
    expect(sonnet.inputRate).toBe(3);
    expect(sonnet.outputRate).toBe(15);

    const haiku = MODEL_PRICING.get("claude-haiku-4-5-20251001")!;
    expect(haiku.inputRate).toBe(0.8);
    expect(haiku.outputRate).toBe(4);
  });

  it("Haiku cache-aware pricing is correct", () => {
    const bus = makeBus();
    const tracker = new CostTracker();

    // Haiku: $0.80/M input, $4/M output
    tracker.record("optimizer", "claude-haiku-4-5-20251001", {
      inputTokens: 10000,
      outputTokens: 2000,
      cacheReadTokens: 3000,
      cacheWriteTokens: 1000,
    });

    // uncached = max(0, 10000 - 3000 - 1000) = 6000
    // cost = (6000 * 0.8 + 2000 * 4 + 3000 * 0.8 * 0.1 + 1000 * 0.8 * 1.25) / 1M
    //      = (4800 + 8000 + 240 + 1000) / 1M
    //      = 14040 / 1M
    //      = 0.01404
    expect(tracker.costForRole("optimizer")).toBeCloseTo(0.01404, 8);
  });
});
