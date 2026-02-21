// CostScorer: scores token cost against a budget threshold

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class CostScorer implements Scorer {
  readonly name = "cost";

  constructor(private readonly maxCostUsd: number) {}

  async score(input: EvalInput): Promise<EvalScore> {
    if (input.costUsd === undefined) {
      return { name: this.name, score: 0, reasoning: "no cost data available" };
    }
    if (input.costUsd <= this.maxCostUsd) {
      return { name: this.name, score: 1, reasoning: `$${input.costUsd.toFixed(4)} within $${this.maxCostUsd.toFixed(2)} threshold` };
    }
    const score = Math.max(0, Math.min(1, this.maxCostUsd / input.costUsd));
    return { name: this.name, score, reasoning: `$${input.costUsd.toFixed(4)} exceeds $${this.maxCostUsd.toFixed(2)} threshold` };
  }
}
