// HallucinationScorer: evaluates whether output contains claims NOT in context (inverted)

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class HallucinationScorer implements Scorer {
  readonly name = "hallucination";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const context = (input.context ?? []).join("\n");
    const prompt = `Evaluate hallucination. Does the output contain claims or information NOT present in the provided context? Rate 0.0 if all claims are grounded in context, 1.0 if completely fabricated.

Context:
${context || "(no context provided)"}

Input: ${input.input}
Output: ${input.output}

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0 where 0=no hallucination, 1=complete hallucination>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score: llmScore, reasoning } = parseLLMResponse(response, this.name);
    if (llmScore === 0 && reasoning.includes("failed to parse")) {
      return { name: this.name, score: 0, reasoning: "LLM response parsing failed, assuming unsafe" };
    }
    const score = 1 - llmScore;
    return { name: this.name, score, reasoning: `inverted: ${reasoning}` };
  }
}
