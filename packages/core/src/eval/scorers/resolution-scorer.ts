// ResolutionScorer: rule-based scorer mapping resolution status to eval score

import type { EvalInput, EvalScore, Scorer } from "../types.js";

const RESOLUTION_SCORES: Record<string, number> = {
  resolved: 1.0,
  partial: 0.5,
  ambiguous: 0.25,
  unresolved: 0.0,
};

export class ResolutionScorer implements Scorer {
  readonly name = "resolution";

  async score(input: EvalInput): Promise<EvalScore> {
    const resolution = input.metadata?.resolution as { status?: string; confidence?: number } | undefined;
    if (!resolution?.status) {
      return { name: this.name, score: 0, reasoning: "No resolution data in metadata" };
    }
    const score = RESOLUTION_SCORES[resolution.status] ?? 0;
    const confidence = resolution.confidence ?? 1.0;
    const weighted = score * confidence;
    return {
      name: this.name,
      score: weighted,
      reasoning: `Resolution: ${resolution.status} (confidence: ${confidence})`,
    };
  }
}
