// HandoffQualityScorer: LLM-as-judge for context preservation across agent handoffs

import type { EvalInput, EvalScore, Scorer, ScorerLLM } from "../types.js";
import { parseLLMResponse } from "./parse-llm-response.js";

interface HandoffEvent {
  readonly fromAgent: string;
  readonly toAgent: string;
  readonly summary?: string;
  readonly reason?: string;
}

function extractHandoffs(metadata: Record<string, unknown> | undefined): HandoffEvent[] | undefined {
  if (!metadata) return undefined;
  const raw = metadata["handoffHistory"];
  if (!Array.isArray(raw)) return undefined;
  const events: HandoffEvent[] = [];
  for (const entry of raw) {
    if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)["fromAgent"] === "string" &&
      typeof (entry as Record<string, unknown>)["toAgent"] === "string"
    ) {
      events.push(entry as HandoffEvent);
    }
  }
  return events.length > 0 ? events : undefined;
}

export class HandoffQualityScorer implements Scorer {
  readonly name = "handoff-quality";

  constructor(private readonly llm: ScorerLLM) {}

  async score(input: EvalInput): Promise<EvalScore> {
    const handoffs = extractHandoffs(input.metadata);
    if (!handoffs) {
      return { name: this.name, score: 0, reasoning: "No handoff history in metadata" };
    }

    const handoffLog = handoffs
      .map((h, i) => {
        const parts = [`Handoff ${i + 1}: ${h.fromAgent} -> ${h.toAgent}`];
        if (h.reason) parts.push(`  Reason: ${h.reason}`);
        if (h.summary) parts.push(`  Summary: ${h.summary}`);
        return parts.join("\n");
      })
      .join("\n\n");

    const prompt = `Evaluate the quality of agent handoffs in this conversation. Was context preserved across each agent switch?

User query: ${input.input}
Final output: ${input.output}

Handoff history:
${handoffLog}

Evaluate:
1. Was the handoff reason appropriate (correct agent for the task)?
2. Was the context summary accurate and complete?
3. Did the receiving agent pick up seamlessly without re-asking for information?
4. Was any critical context lost during the handoff?

Score 1.0 for seamless handoffs with full context preservation. Score 0.0 for complete context loss.

Respond EXACTLY in this format:
SCORE: <number from 0.0 to 1.0>
REASONING: <one sentence explanation>`;

    const response = await this.llm.evaluate(prompt);
    const { score, reasoning } = parseLLMResponse(response, this.name);
    return { name: this.name, score, reasoning };
  }
}
