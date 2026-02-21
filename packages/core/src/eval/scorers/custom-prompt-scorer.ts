// CustomPromptScorer: evaluates output using a user-provided prompt template

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

export class CustomPromptScorer implements Scorer {
  readonly name: string;

  constructor(
    name: string,
    private readonly promptTemplate: string,
    private readonly llm: ScorerLLM,
  ) {
    this.name = name;
  }

  async score(input: EvalInput): Promise<EvalScore> {
    const context = (input.context ?? []).join("\n");
    const prompt = this.promptTemplate
      .replace(/\{\{input\}\}/g, input.input)
      .replace(/\{\{output\}\}/g, input.output)
      .replace(/\{\{expected\}\}/g, input.expected ?? "")
      .replace(/\{\{context\}\}/g, context);

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
