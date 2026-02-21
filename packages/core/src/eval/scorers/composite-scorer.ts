// CompositeScorer: averages scores from multiple sub-scorers

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class CompositeScorer implements Scorer {
  readonly name: string;

  constructor(
    name: string,
    private readonly scorers: readonly Scorer[],
  ) {
    this.name = name;
  }

  async score(input: EvalInput): Promise<EvalScore> {
    if (this.scorers.length === 0) {
      return { name: this.name, score: 0, reasoning: "no sub-scorers configured" };
    }
    const results = await Promise.all(this.scorers.map((s) => s.score(input)));
    const avg = results.reduce((sum, r) => sum + r.score, 0) / results.length;
    const reasoning = results.map((r) => `${r.name}=${r.score.toFixed(2)}`).join(", ");
    return { name: this.name, score: avg, reasoning };
  }
}
