import { describe, it, expect } from "vitest";
import { computeEffortScore } from "../../src/enrichment/effort-score.js";
import type { EffortComponents } from "../../src/enrichment/types.js";

function makeComponents(overrides?: Partial<EffortComponents>): EffortComponents {
  return {
    userTurns: 2,
    clarificationRequests: 0,
    toolErrors: 0,
    agentHandoffs: 0,
    escalated: false,
    ...overrides,
  };
}

describe("computeEffortScore", () => {
  it("returns 10 for zero effort (2 user turns, no issues)", () => {
    expect(computeEffortScore(makeComponents())).toBe(10);
  });

  it("reduces score for excess user turns (0.3 per turn above 2, capped at 3)", () => {
    // 5 turns = 3 excess * 0.3 = 0.9 reduction
    expect(computeEffortScore(makeComponents({ userTurns: 5 }))).toBe(9.1);
    // 12 turns = 10 excess * 0.3 = 3.0 (capped at 3)
    expect(computeEffortScore(makeComponents({ userTurns: 12 }))).toBe(7);
    // 20 turns = 18 excess * 0.3 = 5.4 but capped at 3
    expect(computeEffortScore(makeComponents({ userTurns: 20 }))).toBe(7);
  });

  it("reduces score for clarification requests (0.5 each, capped at 2)", () => {
    expect(computeEffortScore(makeComponents({ clarificationRequests: 1 }))).toBe(9.5);
    expect(computeEffortScore(makeComponents({ clarificationRequests: 3 }))).toBe(8.5);
    // 5 * 0.5 = 2.5 but capped at 2
    expect(computeEffortScore(makeComponents({ clarificationRequests: 5 }))).toBe(8);
  });

  it("reduces score for tool errors (0.4 each, capped at 2)", () => {
    expect(computeEffortScore(makeComponents({ toolErrors: 1 }))).toBe(9.6);
    expect(computeEffortScore(makeComponents({ toolErrors: 3 }))).toBe(8.8);
    // 6 * 0.4 = 2.4 but capped at 2
    expect(computeEffortScore(makeComponents({ toolErrors: 6 }))).toBe(8);
  });

  it("reduces score for agent handoffs (0.5 each, capped at 1.5)", () => {
    expect(computeEffortScore(makeComponents({ agentHandoffs: 1 }))).toBe(9.5);
    expect(computeEffortScore(makeComponents({ agentHandoffs: 3 }))).toBe(8.5);
    // 4 * 0.5 = 2.0 but capped at 1.5
    expect(computeEffortScore(makeComponents({ agentHandoffs: 4 }))).toBe(8.5);
  });

  it("reduces score by 1.5 for escalation", () => {
    expect(computeEffortScore(makeComponents({ escalated: true }))).toBe(8.5);
  });

  it("returns low score for high effort scenario", () => {
    const score = computeEffortScore(
      makeComponents({
        userTurns: 15,
        clarificationRequests: 5,
        toolErrors: 6,
        agentHandoffs: 4,
        escalated: true,
      }),
    );
    // 10 - 3 - 2 - 2 - 1.5 - 1.5 = 0
    expect(score).toBe(0);
  });

  it("never goes below 0", () => {
    const score = computeEffortScore(
      makeComponents({
        userTurns: 100,
        clarificationRequests: 100,
        toolErrors: 100,
        agentHandoffs: 100,
        escalated: true,
      }),
    );
    expect(score).toBe(0);
  });

  it("does not penalize for 1 or 2 user turns", () => {
    expect(computeEffortScore(makeComponents({ userTurns: 1 }))).toBe(10);
    expect(computeEffortScore(makeComponents({ userTurns: 0 }))).toBe(10);
  });

  it("returns values with at most 2 decimal places", () => {
    const score = computeEffortScore(makeComponents({ userTurns: 3 }));
    // 1 excess * 0.3 = 0.3
    expect(score).toBe(9.7);
    const str = score.toString();
    const parts = str.split(".");
    if (parts.length > 1) {
      expect(parts[1].length).toBeLessThanOrEqual(2);
    }
  });
});
