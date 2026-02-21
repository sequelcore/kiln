// ExactMatchScorer: binary comparison of output vs expected value

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class ExactMatchScorer implements Scorer {
  readonly name = "exact-match";

  async score(input: EvalInput): Promise<EvalScore> {
    if (input.expected === undefined) {
      return { name: this.name, score: 0, reasoning: "no expected value provided" };
    }
    const matches = input.output === input.expected;
    return {
      name: this.name,
      score: matches ? 1 : 0,
      reasoning: matches ? "exact match" : "output does not match expected",
    };
  }
}
