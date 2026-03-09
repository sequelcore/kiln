// ContextRelevanceScorer: evaluates whether retrieved context chunks are relevant to the input query

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class ContextRelevanceScorer implements Scorer {
  readonly name = "context-relevance";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const chunks = input.context ?? [];
    if (chunks.length === 0) {
      return { name: this.name, score: 0, reasoning: "No context provided" };
    }

    const contextList = chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
    const prompt = `Evaluate context relevance. Are the retrieved context chunks relevant to the user's query? This measures retrieval quality, not answer quality.

Query: ${input.input}

Retrieved context:
${contextList}

Score 1.0 if all chunks are highly relevant to the query. Score 0.0 if none are relevant. Use intermediate scores based on the proportion and degree of relevance.

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
