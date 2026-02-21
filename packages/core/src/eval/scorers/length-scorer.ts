// LengthScorer: scores output length against min/max constraints

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class LengthScorer implements Scorer {
  readonly name = "length";

  constructor(
    private readonly minLength?: number,
    private readonly maxLength?: number,
  ) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const len = input.output.length;
    if (this.minLength === undefined && this.maxLength === undefined) {
      return { name: this.name, score: 1, reasoning: "no length constraints" };
    }
    if (this.minLength !== undefined && len < this.minLength) {
      const score = Math.max(0, Math.min(1, len / this.minLength));
      return { name: this.name, score, reasoning: `length ${len} below minimum ${this.minLength}` };
    }
    if (this.maxLength !== undefined && len > this.maxLength) {
      const score = Math.max(0, Math.min(1, this.maxLength / len));
      return { name: this.name, score, reasoning: `length ${len} above maximum ${this.maxLength}` };
    }
    return { name: this.name, score: 1, reasoning: `length ${len} within range` };
  }
}
