// Grounding Rail: post-generation LLM judge that verifies response is grounded in retrieved chunks.
// Tier 2 safety rail -- premium feature for regulated industries.

import type { ProviderAdapter } from "../agents/index.js";
import { extractText, textParts } from "../engine/domain/content.js";

export interface GroundingResult {
  readonly grounded: boolean;
  readonly confidence: number;
  readonly ungroundedClaims: readonly string[];
  readonly durationMs: number;
  readonly model: string;
}

const SYSTEM_PROMPT = `You are a factual accuracy verifier.

Compare the AI Response against the provided Reference Chunks. Identify any claims in the response that are NOT supported by the reference chunks.

Output ONLY valid JSON in this exact format:
{"grounded": boolean, "confidence": number, "ungroundedClaims": string[]}

Rules:
- confidence: 0.0 (completely ungrounded) to 1.0 (fully grounded)
- ungroundedClaims: list specific factual claims not supported by the chunks
- Only flag specific factual claims. Conversational filler, greetings, and hedging ("I think", "based on the information") are NOT claims.
- Be conservative: when in doubt, mark as grounded.`;

const OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    grounded: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    ungroundedClaims: { type: "array", items: { type: "string" } },
  },
  required: ["grounded", "confidence", "ungroundedClaims"],
};

/** Extracts a JSON object from text, falling back to regex if direct parse fails. */
function parseJudgeOutput(text: string): { grounded: boolean; confidence: number; ungroundedClaims: string[] } | null {
  try {
    return JSON.parse(text) as { grounded: boolean; confidence: number; ungroundedClaims: string[] };
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as { grounded: boolean; confidence: number; ungroundedClaims: string[] };
    } catch {
      return null;
    }
  }
}

/** Stateless post-generation rail: uses an LLM judge to verify response is grounded in retrieved chunks. */
export class GroundingRail {
  async evaluate(
    response: string,
    chunks: readonly string[],
    provider: ProviderAdapter,
    model?: string,
  ): Promise<GroundingResult> {
    if (!response || chunks.length === 0) {
      return { grounded: true, confidence: 1, ungroundedClaims: [], durationMs: 0, model: "none" };
    }

    const resolvedModel = model ?? provider.name;
    const start = Date.now();

    const chunkBlock = chunks.map((c, i) => `[${i + 1}] ${c}`).join("\n\n");
    const userText = `Reference Chunks:\n${chunkBlock}\n\nAI Response:\n${response}`;

    const result = await provider.createMessage({
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", parts: textParts(userText) }],
      outputSchema: OUTPUT_SCHEMA,
      maxTokens: 512,
    });

    const durationMs = Date.now() - start;
    const raw = extractText(result.parts);
    const parsed = parseJudgeOutput(raw);

    if (!parsed) {
      // Fail-open: check was inconclusive, zero confidence signals consumers
      return { grounded: true, confidence: 0, ungroundedClaims: [], durationMs, model: resolvedModel };
    }

    return {
      grounded: parsed.grounded,
      confidence: parsed.confidence,
      ungroundedClaims: parsed.ungroundedClaims,
      durationMs,
      model: resolvedModel,
    };
  }
}
