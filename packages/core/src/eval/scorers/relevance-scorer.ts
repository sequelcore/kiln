// RelevanceScorer: evaluates whether output is relevant to the input

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class RelevanceScorer implements Scorer {
  readonly name = "relevance";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const prompt = `Evaluate relevance. Is the output relevant and responsive to the input?

Input: ${input.input}
Output: ${input.output}

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
