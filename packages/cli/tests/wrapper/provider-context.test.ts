import { describe, expect, it } from "vitest";
import { ProviderContextTracker } from "../../src/wrapper/provider-context.js";

describe("ProviderContextTracker", () => {
  it("accumulates input and output tokens", () => {
    const tracker = new ProviderContextTracker({
      maxContextTokens: 1000,
      compactionThreshold: 0.85,
    });

    expect(tracker.totalTokens).toBe(0);
    expect(tracker.compactionThresholdTokens).toBe(850);
    expect(tracker.update(120, 30)).toBe(150);
    expect(tracker.update(40, 10)).toBe(200);
    expect(tracker.totalTokens).toBe(200);
  });

  it("triggers compaction when threshold is reached or exceeded", () => {
    const tracker = new ProviderContextTracker({
      maxContextTokens: 1000,
      compactionThreshold: 0.5,
      initialTokens: 450,
    });

    expect(tracker.shouldTriggerCompaction()).toBe(false);
    expect(tracker.shouldTriggerCompaction(49)).toBe(false);
    expect(tracker.shouldTriggerCompaction(50)).toBe(true);

    tracker.update(20, 30);
    expect(tracker.shouldTriggerCompaction()).toBe(true);
  });

  it("handles boundary values at threshold", () => {
    const tracker = new ProviderContextTracker({
      maxContextTokens: 100,
      compactionThreshold: 0.8,
      initialTokens: 99,
    });

    expect(tracker.compactionThresholdTokens).toBe(80);
    expect(tracker.shouldTriggerCompaction()).toBe(true);

    tracker.reset(79);
    expect(tracker.shouldTriggerCompaction()).toBe(false);
    expect(tracker.shouldTriggerCompaction(1)).toBe(true);
    tracker.update(1, 0);
    expect(tracker.totalTokens).toBe(80);
    expect(tracker.shouldTriggerCompaction()).toBe(true);
  });
});
