// ContainsScorer: checks if output contains required substrings (case-insensitive)

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class ContainsScorer implements Scorer {
  readonly name = "contains";

  constructor(private readonly substrings: readonly string[]) {}

  async score(input: EvalInput): Promise<EvalScore> {
    if (this.substrings.length === 0) {
      return { name: this.name, score: 1, reasoning: "no substrings to check" };
    }
    const lower = input.output.toLowerCase();
    const found: string[] = [];
    const missing: string[] = [];
    for (const sub of this.substrings) {
      if (lower.includes(sub.toLowerCase())) {
        found.push(sub);
      } else {
        missing.push(sub);
      }
    }
    const score = found.length / this.substrings.length;
    const reasoning = missing.length === 0
      ? `found all ${found.length} substrings`
      : `found ${found.length}/${this.substrings.length}, missing: ${missing.join(", ")}`;
    return { name: this.name, score, reasoning };
  }
}
