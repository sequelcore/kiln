// LatencyScorer: scores response time against a threshold

import type { EvalInput, EvalScore, Scorer } from "../types.js";

export class LatencyScorer implements Scorer {
  readonly name = "latency";

  constructor(private readonly maxLatencyMs: number) {}

  async score(input: EvalInput): Promise<EvalScore> {
    if (input.durationMs === undefined) {
      return { name: this.name, score: 0, reasoning: "no duration data available" };
    }
    if (input.durationMs <= this.maxLatencyMs) {
      return { name: this.name, score: 1, reasoning: `${input.durationMs}ms within ${this.maxLatencyMs}ms threshold` };
    }
    const score = Math.max(0, Math.min(1, this.maxLatencyMs / input.durationMs));
    return { name: this.name, score, reasoning: `${input.durationMs}ms exceeds ${this.maxLatencyMs}ms threshold` };
  }
}
