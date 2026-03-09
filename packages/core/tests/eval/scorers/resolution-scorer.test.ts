// Tests for ResolutionScorer

import { describe, it, expect } from "vitest";
import { ResolutionScorer } from "../../../src/eval/scorers/resolution-scorer.js";

describe("ResolutionScorer", () => {
  it("scores resolved as 1.0", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "resolved", confidence: 1.0 } },
    });
    expect(result.score).toBe(1.0);
    expect(result.name).toBe("resolution");
    expect(result.reasoning).toBe("Resolution: resolved (confidence: 1)");
  });

  it("scores partial as 0.5", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "partial", confidence: 1.0 } },
    });
    expect(result.score).toBe(0.5);
  });

  it("scores ambiguous as 0.25", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "ambiguous", confidence: 1.0 } },
    });
    expect(result.score).toBe(0.25);
  });

  it("scores unresolved as 0.0", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "unresolved", confidence: 1.0 } },
    });
    expect(result.score).toBe(0.0);
  });

  it("applies confidence weighting", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "resolved", confidence: 0.8 } },
    });
    expect(result.score).toBeCloseTo(0.8); // 1.0 * 0.8
    expect(result.reasoning).toBe("Resolution: resolved (confidence: 0.8)");
  });

  it("defaults confidence to 1.0 when not provided", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "partial" } },
    });
    expect(result.score).toBe(0.5); // 0.5 * 1.0
  });

  it("returns 0 when metadata is missing", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No resolution data in metadata");
  });

  it("returns 0 when resolution is missing from metadata", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({ input: "q", output: "hello", metadata: {} });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No resolution data in metadata");
  });

  it("returns 0 for unknown status", async () => {
    const scorer = new ResolutionScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: { resolution: { status: "unknown-status", confidence: 1.0 } },
    });
    expect(result.score).toBe(0);
  });
});
