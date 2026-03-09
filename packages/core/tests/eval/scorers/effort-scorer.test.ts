// Tests for EffortScorer

import { describe, it, expect } from "vitest";
import { EffortScorer } from "../../../src/eval/scorers/effort-scorer.js";

describe("EffortScorer", () => {
  it("scores with valid effort components", async () => {
    const scorer = new EffortScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: {
        effortComponents: {
          userTurns: 2,
          clarificationRequests: 0,
          toolErrors: 0,
          agentHandoffs: 0,
          escalated: false,
        },
      },
    });
    // 10/10 effort -> normalized to 1.0
    expect(result.score).toBe(1.0);
    expect(result.name).toBe("effort");
    expect(result.reasoning).toBe("Effort score: 10/10");
  });

  it("returns 0 when metadata is missing", async () => {
    const scorer = new EffortScorer();
    const result = await scorer.score({ input: "q", output: "hello" });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No effort components in metadata");
  });

  it("returns 0 when effortComponents is missing from metadata", async () => {
    const scorer = new EffortScorer();
    const result = await scorer.score({ input: "q", output: "hello", metadata: {} });
    expect(result.score).toBe(0);
    expect(result.reasoning).toBe("No effort components in metadata");
  });

  it("normalizes high-effort conversations to lower scores", async () => {
    const scorer = new EffortScorer();
    const result = await scorer.score({
      input: "q",
      output: "hello",
      metadata: {
        effortComponents: {
          userTurns: 20,
          clarificationRequests: 4,
          toolErrors: 5,
          agentHandoffs: 3,
          escalated: false,
        },
      },
    });
    // High effort = low score (bad experience)
    expect(result.score).toBeLessThan(0.5);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });

  it("applies escalation penalty", async () => {
    const scorer = new EffortScorer();

    const withoutEscalation = await scorer.score({
      input: "q",
      output: "hello",
      metadata: {
        effortComponents: {
          userTurns: 5,
          clarificationRequests: 1,
          toolErrors: 0,
          agentHandoffs: 0,
          escalated: false,
        },
      },
    });

    const withEscalation = await scorer.score({
      input: "q",
      output: "hello",
      metadata: {
        effortComponents: {
          userTurns: 5,
          clarificationRequests: 1,
          toolErrors: 0,
          agentHandoffs: 0,
          escalated: true,
        },
      },
    });

    // Escalation should reduce the score
    expect(withEscalation.score).toBeLessThan(withoutEscalation.score);
  });
});
