// MultiTurnConsistencyScorer: LLM-as-judge for context retention across conversation turns

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

interface ConversationTurn {
  readonly role: string;
  readonly content: string;
}

function extractConversationHistory(metadata: Record<string, unknown> | undefined): ConversationTurn[] | undefined {
  if (!metadata) return undefined;
  const raw = metadata["conversationHistory"];
  if (!Array.isArray(raw)) return undefined;
  const turns: ConversationTurn[] = [];
  for (const entry of raw) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)["role"] === "string" &&
      typeof (entry as Record<string, unknown>)["content"] === "string"
    ) {
      turns.push(entry as ConversationTurn);
    }
  }
  return turns.length >= 2 ? turns : undefined;
}

export class MultiTurnConsistencyScorer implements Scorer {
  readonly name = "multi-turn-consistency";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const history = extractConversationHistory(input.metadata);
    if (!history) {
      return { name: this.name, score: 0, reasoning: "No conversation history in metadata (need >= 2 turns)" };
    }

    const transcript = history.map((t) => `[${t.role}]: ${t.content}`).join("\n");

    const prompt = `Evaluate context retention across this multi-turn conversation. Did the assistant maintain awareness of previously stated facts, requests, and context throughout the conversation?

Conversation:
${transcript}

Final output: ${input.output}

Evaluate:
1. Does the assistant contradict earlier statements?
2. Does it forget previously provided information?
3. Does it ask questions already answered?
4. Does it maintain a coherent understanding of the user's evolving needs?

Score 1.0 for perfect context retention. Score 0.0 for complete context loss.

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
