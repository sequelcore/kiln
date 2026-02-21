// CoherenceScorer: evaluates whether output is internally consistent and well-structured

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class CoherenceScorer implements Scorer {
  readonly name = "coherence";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const prompt = `Evaluate coherence. Is the output internally consistent and well-structured?

Output: ${input.output}

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
