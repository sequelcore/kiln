import { describe, it, expect } from "vitest";
import { CostTracker, MODEL_PRICING, STT_PRICING, EMBEDDING_PRICING } from "../../src/cost/cost-tracker.js";

describe("CostTracker model-keying", () => {
  it("accumulates by role:model tuple", () => {
    const tracker = new CostTracker();

    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.record("worker", "claude-haiku-4-5-20251001", {
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    const summary = tracker.summary;
    expect(Object.keys(summary.byRoleModel)).toHaveLength(2);
    expect(summary.byRoleModel["worker:claude-sonnet-4-6"]).toBeDefined();
    expect(summary.byRoleModel["worker:claude-haiku-4-5-20251001"]).toBeDefined();
    expect(summary.byRoleModel["worker:claude-sonnet-4-6"]!.inputTokens).toBe(1000);
    expect(summary.byRoleModel["worker:claude-haiku-4-5-20251001"]!.inputTokens).toBe(2000);
  });

  it("byRoleModel has correct keys with role and model", () => {
    const tracker = new CostTracker();

    tracker.record("architect", "claude-opus-4-6", {
      inputTokens: 500,
      outputTokens: 200,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    const summary = tracker.summary;
    const key = "architect:claude-opus-4-6";
    expect(summary.byRoleModel[key]).toBeDefined();
    expect(summary.byRoleModel[key]!.role).toBe("architect");
    expect(summary.byRoleModel[key]!.model).toBe("claude-opus-4-6");
    expect(summary.byRoleModel[key]!.inputTokens).toBe(500);
    expect(summary.byRoleModel[key]!.outputTokens).toBe(200);
    expect(summary.byRoleModel[key]!.calls).toBe(1);
  });

  it("byRole still aggregates across models (backward compat)", () => {
    const tracker = new CostTracker();

    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.record("worker", "claude-haiku-4-5-20251001", {
      inputTokens: 2000,
      outputTokens: 1000,
      cacheReadTokens: 100,
      cacheWriteTokens: 0,
    });

    const summary = tracker.summary;
    // byRole should have only 1 entry for "worker"
    expect(Object.keys(summary.byRole)).toHaveLength(1);
    expect(summary.byRole["worker"]).toBeDefined();
    expect(summary.byRole["worker"]!.inputTokens).toBe(3000);
    expect(summary.byRole["worker"]!.outputTokens).toBe(1500);
    expect(summary.byRole["worker"]!.cacheReadTokens).toBe(100);
    expect(summary.byRole["worker"]!.calls).toBe(2);
  });

  it("costForRole works across multiple models for the same role", () => {
    const tracker = new CostTracker();

    // Sonnet: $3/M input, $15/M output
    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    // Haiku: $0.8/M input, $4/M output
    tracker.record("worker", "claude-haiku-4-5-20251001", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    // Expected: sonnet cost ($3) + haiku cost ($0.80) = $3.80
    expect(tracker.costForRole("worker")).toBeCloseTo(3.8, 6);
  });

  it("recordEmbedding tracks embedding costs", () => {
    const tracker = new CostTracker();

    // text-embedding-3-small: $0.02/M tokens
    tracker.recordEmbedding("text-embedding-3-small", 1_000_000);

    const summary = tracker.summary;
    expect(summary.totalCostUsd).toBeCloseTo(0.02, 8);
  });

  it("recordEmbedding ignores unknown models", () => {
    const tracker = new CostTracker();

    tracker.recordEmbedding("unknown-embedding", 1_000_000);

    const summary = tracker.summary;
    expect(summary.totalCostUsd).toBe(0);
  });

  it("recordStt tracks STT costs", () => {
    const tracker = new CostTracker();

    // gpt-4o-transcribe: $0.006/min -- 60 seconds = 1 minute
    tracker.recordStt("gpt-4o-transcribe", 60);

    const summary = tracker.summary;
    expect(summary.totalCostUsd).toBeCloseTo(0.006, 8);
  });

  it("recordStt handles fractional minutes correctly", () => {
    const tracker = new CostTracker();

    // nova-3: $0.0043/min -- 30 seconds = 0.5 minutes
    tracker.recordStt("nova-3", 30);

    const summary = tracker.summary;
    expect(summary.totalCostUsd).toBeCloseTo(0.00215, 8);
  });

  it("recordStt ignores unknown models", () => {
    const tracker = new CostTracker();

    tracker.recordStt("unknown-stt", 120);

    const summary = tracker.summary;
    expect(summary.totalCostUsd).toBe(0);
  });

  it("totalCostUsd includes LLM + embedding + STT costs", () => {
    const tracker = new CostTracker();

    // LLM: Sonnet $3/M input
    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    // Embedding: $0.02/M tokens
    tracker.recordEmbedding("text-embedding-3-small", 1_000_000);

    // STT: $0.006/min * 1 min
    tracker.recordStt("gpt-4o-transcribe", 60);

    const summary = tracker.summary;
    // $3.00 + $0.02 + $0.006 = $3.026
    expect(summary.totalCostUsd).toBeCloseTo(3.026, 6);
  });

  it("reset clears embedding and STT costs", () => {
    const tracker = new CostTracker();

    tracker.recordEmbedding("text-embedding-3-small", 1_000_000);
    tracker.recordStt("gpt-4o-transcribe", 60);
    tracker.record("worker", "claude-sonnet-4-6", {
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });

    tracker.reset();

    const summary = tracker.summary;
    expect(summary.totalCostUsd).toBe(0);
    expect(Object.keys(summary.byRoleModel)).toHaveLength(0);
    expect(Object.keys(summary.byRole)).toHaveLength(0);
  });

  it("STT_PRICING has expected models", () => {
    expect(STT_PRICING.has("gpt-4o-transcribe")).toBe(true);
    expect(STT_PRICING.has("nova-3")).toBe(true);
    expect(STT_PRICING.get("gpt-4o-transcribe")!.ratePerMinute).toBe(0.006);
    expect(STT_PRICING.get("nova-3")!.ratePerMinute).toBe(0.0043);
  });

  it("EMBEDDING_PRICING has expected models", () => {
    expect(EMBEDDING_PRICING.has("text-embedding-3-small")).toBe(true);
    expect(EMBEDDING_PRICING.has("text-embedding-3-large")).toBe(true);
    expect(EMBEDDING_PRICING.get("text-embedding-3-small")!.ratePerMToken).toBe(0.02);
    expect(EMBEDDING_PRICING.get("text-embedding-3-large")!.ratePerMToken).toBe(0.13);
  });
});
