// ToolTrajectoryScorer: evaluates tool-use sequence efficiency and correctness

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

interface ToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
}

function extractToolCalls(metadata: Record<string, unknown> | undefined): ToolCall[] | undefined {
  if (!metadata) return undefined;
  const raw = metadata["toolCalls"];
  if (!Array.isArray(raw)) return undefined;
  const calls: ToolCall[] = [];
  for (const entry of raw) {
    if (typeof entry === "object" && entry !== null && typeof (entry as Record<string, unknown>)["name"] === "string") {
      calls.push(entry as ToolCall);
    }
  }
  return calls.length > 0 ? calls : undefined;
}

export class ToolTrajectoryScorer implements Scorer {
  readonly name = "tool-trajectory";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const toolCalls = extractToolCalls(input.metadata);
    if (!toolCalls) {
      return { name: this.name, score: 0, reasoning: "No tool calls in metadata" };
    }

    const trajectory = toolCalls
      .map((tc, i) => `Step ${i + 1}: ${tc.name}(${JSON.stringify(tc.args)}) -> ${tc.result}`)
      .join("\n");

    const prompt = `Evaluate tool-use trajectory. Was the sequence of tool calls efficient and appropriate for the task?

Task: ${input.input}
Final output: ${input.output}

Tool call sequence:
${trajectory}

Consider: Were unnecessary tools called? Was the order logical? Were the right tools selected? Could fewer calls have achieved the same result?

Score 1.0 for optimal tool use. Score 0.0 for completely inefficient or incorrect tool use.

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
