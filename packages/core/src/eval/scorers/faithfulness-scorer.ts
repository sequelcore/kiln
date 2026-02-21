// FaithfulnessScorer: evaluates whether output stays faithful to provided context

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class FaithfulnessScorer implements Scorer {
  readonly name = "faithfulness";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const context = (input.context ?? []).join("\n");
    const prompt = `Evaluate faithfulness. Does the output stay faithful to the provided context? Only use information from the context.

Context:
${context || "(no context provided)"}

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
