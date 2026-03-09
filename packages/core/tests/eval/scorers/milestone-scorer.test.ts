// Tests for MilestoneScorer

import { describe, it, expect } from "vitest";
import { MilestoneScorer } from "../../../src/eval/scorers/milestone-scorer.js";

describe("MilestoneScorer", () => {
  it("returns 1 when all milestones completed", async () => {
    const scorer = new MilestoneScorer();
    const result = await scorer.score({
      input: "Process the refund",
      output: "Refund completed.",
      metadata: {
        milestones: [
          { name: "identify-order", completed: true },
          { name: "verify-eligibility", completed: true },
          { name: "process-refund", completed: true },
        ],
      },
    });
    expect(result.score).toBe(1);
    expect(result.reasoning).toBe("3/3 milestones completed");
  });

  it("returns fraction for partial completion", async () => {
    const scorer = new MilestoneScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        milestones: [
          { name: "step-1", completed: true },
          { name: "step-2", completed: false },
          { name: "step-3", completed: true },
          { name: "step-4", completed: false },
        ],
      },
    });
    expect(result.score).toBe(0.5);
    expect(result.reasoning).toContain("2/4 milestones completed");
    expect(result.reasoning).toContain("missed: step-2, step-4");
  });

  it("returns 0 when no milestones completed", async () => {
    const scorer = new MilestoneScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        milestones: [
          { name: "step-1", completed: false },
          { name: "step-2", completed: false },
        ],
      },
    });
    expect(result.score).toBe(0);
    expect(result.reasoning).toContain("0/2 milestones completed");
  });

  it("returns 0 when no metadata", async () => {
    const scorer = new MilestoneScorer();
    const result = await scorer.score({ input: "q", output: "a" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No milestones in metadata");
  });

  it("returns 0 when milestones is not an array", async () => {
    const scorer = new MilestoneScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: { milestones: "not an array" },
    });
    expect(result.score).toBe(0);
  });

  it("filters invalid milestone entries", async () => {
    const scorer = new MilestoneScorer();
    const result = await scorer.score({
      input: "q",
      output: "a",
      metadata: {
        milestones: [
          { name: "valid", completed: true },
          { name: "missing-completed" },
          42,
          null,
        ],
      },
    });
    // Only 1 valid milestone, and it's completed
    expect(result.score).toBe(1);
    expect(result.reasoning).toBe("1/1 milestones completed");
  });
});
