// PolicyAdherenceScorer: evaluates whether output follows business policy rules

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class PolicyAdherenceScorer implements Scorer {
  readonly name = "policy-adherence";

  constructor(
    private readonly llm: ScorerLLM,
    private readonly policies: readonly string[],
  ) {}

  async score(input: EvalInput): Promise<EvalScore> {
    if (this.policies.length === 0) {
      return { name: this.name, score: 0, reasoning: "No policies configured" };
    }

    const policyList = this.policies.map((p, i) => `${i + 1}. ${p}`).join("\n");
    const prompt = `Evaluate policy adherence. Does the output comply with ALL of the following business policies?

Policies:
${policyList}

Input: ${input.input}
Output: ${input.output}

Score 1.0 if the output fully adheres to all policies. Score 0.0 if it violates any policy. Use intermediate scores for partial adherence.

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
