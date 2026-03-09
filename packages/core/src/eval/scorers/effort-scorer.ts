// EffortScorer: rule-based scorer bridging enrichment effort score into eval framework

import type { EvalInput, EvalScore, Scorer } from "../types.js";
import { computeEffortScore } from "../../enrichment/effort-score.js";
import type { EffortComponents } from "../../enrichment/types.js";

export class EffortScorer implements Scorer {
  readonly name = "effort";

  async score(input: EvalInput): Promise<EvalScore> {
    const components = input.metadata?.effortComponents as EffortComponents | undefined;
    if (!components) {
      return { name: this.name, score: 0, reasoning: "No effort components in metadata" };
    }
    const rawScore = computeEffortScore(components);
    const normalized = rawScore / 10; // 0-10 -> 0-1
    return { name: this.name, score: normalized, reasoning: `Effort score: ${rawScore}/10` };
  }
}
