// RoutingAccuracyScorer: rule-based scorer checking if the correct agent handled the message

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class RoutingAccuracyScorer implements Scorer {
  readonly name = "routing-accuracy";

  async score(input: EvalInput): Promise<EvalScore> {
    const expected = input.metadata?.expectedAgentId as string | undefined;
    if (!expected) {
      return { name: this.name, score: 0, reasoning: "No expectedAgentId in metadata" };
    }

    const actual = input.metadata?.activeAgentId as string | undefined;
    if (!actual) {
      return { name: this.name, score: 0, reasoning: "No activeAgentId in metadata" };
    }

    if (actual === expected) {
      return { name: this.name, score: 1, reasoning: `Correct: routed to "${actual}"` };
    }

    return { name: this.name, score: 0, reasoning: `Expected "${expected}", got "${actual}"` };
  }
}
