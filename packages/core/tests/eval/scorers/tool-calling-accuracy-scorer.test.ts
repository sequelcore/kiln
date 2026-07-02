// Tests for ToolCallingAccuracyScorer

import { describe, it, expect } from "vitest";
import { ToolCallingAccuracyScorer } from "../../../src/eval/scorers/tool-calling-accuracy-scorer.js";

describe("ToolCallingAccuracyScorer", () => {
  it("returns perfect score when all expected calls match", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "Look up order #123",
      output: "Order shipped",
      metadata: {
        expectedToolCalls: [
          { name: "lookup_order", args: { orderId: "123" } },
        ],
        toolCalls: [
          { name: "lookup_order", args: { orderId: "123" }, result: "shipped" },
        ],
      },
    });
    expect(result.name).toBe("tool-calling-accuracy");
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain("expected-call recall=1.00");
  });

  it("ignores explicitly allowed extra tool calls", async () => {
    const scorer = new ToolCallingAccuracyScorer();

    await expect(scorer.score({
      input: "Find docs",
      output: "done",
      metadata: {
        expectedToolCalls: [{ name: "grep" }],
        allowedExtraToolCalls: ["read"],
        toolCalls: [{ name: "grep" }, { name: "read" }],
      },
    })).resolves.toMatchObject({
      score: 1,
    });
  });

  it("returns 0 when no expectedToolCalls in metadata", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No expectedToolCalls in metadata");
  });

  it("returns 0 when no actual tool calls were made", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [{ name: "search" }],
      },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("0/1 expected calls made");
  });

  it("does not penalize outcome correctness for extra supporting tool calls", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [{ name: "search" }],
        toolCalls: [
          { name: "search", args: {}, result: "found" },
          { name: "unrelated", args: {}, result: "x" },
        ],
      },
    });
    expect(result.score).toBe(1);
    expect(result.reasoning).toContain("extra observed outside correctness: unrelated");
  });

  it("handles missed tool calls (recall < 1)", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [{ name: "search" }, { name: "read" }],
        toolCalls: [{ name: "search", args: {}, result: "found" }],
      },
    });
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toContain("missed: read");
  });

  it("matches args correctly", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [{ name: "search", args: { q: "test" } }],
        toolCalls: [{ name: "search", args: { q: "wrong" }, result: "x" }],
      },
    });
    // name matches but args don't -> no match -> precision=0, recall=0
    expect(result.score).toBe(0);
  });

  it("ignores args when expected has no args", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [{ name: "search" }],
        toolCalls: [{ name: "search", args: { q: "anything" }, result: "x" }],
      },
    });
    expect(result.score).toBe(1);
  });

  it("handles multiple expected and actual with partial matches", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [
          { name: "search", args: { q: "test" } },
          { name: "read", args: { id: "1" } },
          { name: "write", args: { id: "1", data: "x" } },
        ],
        toolCalls: [
          { name: "search", args: { q: "test" }, result: "found" },
          { name: "read", args: { id: "1" }, result: "content" },
          { name: "delete", args: { id: "2" }, result: "ok" },
        ],
      },
    });
    // 2 matches out of 3 expected; extra calls are reported but not mixed into correctness.
    expect(result.score).toBeCloseTo(0.67, 1);
    expect(result.reasoning).toContain("missed: write");
    expect(result.reasoning).toContain("extra observed outside correctness: delete");
  });

  it("rejects invalid expectedToolCalls entries", async () => {
    const scorer = new ToolCallingAccuracyScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        expectedToolCalls: [42, null, "not an object"],
      },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No expectedToolCalls in metadata");
  });
});
