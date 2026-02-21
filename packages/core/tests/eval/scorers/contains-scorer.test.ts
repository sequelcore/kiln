// Tests for ContainsScorer

import { describe, it, expect } from "vitest";
import { ContainsScorer } from "../../../src/eval/scorers/contains-scorer.js";

describe("ContainsScorer", () => {
  it("scores 1.0 when all substrings found", async () => {
    const scorer = new ContainsScorer(["hello", "world"]);
    const result = await scorer.score({ input: "q", output: "hello world" });
    expect(result.score).toBe(1);
  });

  it("scores proportionally for partial matches", async () => {
    const scorer = new ContainsScorer(["hello", "world", "foo"]);
    const result = await scorer.score({ input: "q", output: "hello world" });
    expect(result.score).toBeCloseTo(2 / 3);
  });

  it("scores 0.0 when no substrings found", async () => {
    const scorer = new ContainsScorer(["foo", "bar"]);
    const result = await scorer.score({ input: "q", output: "hello world" });
    expect(result.score).toBe(0);
  });

  it("is case-insensitive", async () => {
    const scorer = new ContainsScorer(["HELLO", "World"]);
    const result = await scorer.score({ input: "q", output: "hello world" });
    expect(result.score).toBe(1);
  });

  it("scores 1.0 when empty substrings array", async () => {
    const scorer = new ContainsScorer([]);
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(1);
  });
});
