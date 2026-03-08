// Complexity scorer: stateless function that estimates query complexity
// Runs in <1ms, used by model router to select appropriate model tier

import type { ComplexityScore, ComplexityClass } from "../engine/domain/model-router.js";

export interface ComplexityScorerInput {
  readonly messageText: string;
  readonly toolCount: number;
  readonly turnDepth: number;
}

const REASONING_MARKERS = [
  "step by step",
  "analyze",
  "architect",
  "debug",
  "refactor",
  "compare",
  "evaluate",
  "explain why",
  "reason about",
];

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;

export function scoreComplexity(input: ComplexityScorerInput): ComplexityScore {
  // 5 signals with weights
  const tokenEstimate = Math.ceil(input.messageText.length / 4);
  const tokenScore = Math.min(1, tokenEstimate / 2000);

  const hasTools = input.toolCount > 0;
  const toolScore = hasTools ? Math.min(1, input.toolCount / 10) : 0;

  const hasCodeBlocks = CODE_BLOCK_PATTERN.test(input.messageText);
  const codeScore = hasCodeBlocks ? 1 : 0;

  const lowerMessage = input.messageText.toLowerCase();
  const hasReasoningMarkers = REASONING_MARKERS.some((m) => lowerMessage.includes(m));
  const reasoningScore = hasReasoningMarkers ? 1 : 0;

  const turnScore = Math.min(1, input.turnDepth / 20);

  // Weighted combination
  const score =
    tokenScore * 0.3 +
    toolScore * 0.25 +
    codeScore * 0.2 +
    reasoningScore * 0.15 +
    turnScore * 0.1;

  const complexityClass = classifyComplexity(score);

  return {
    score,
    class: complexityClass,
    signals: {
      tokenCount: tokenEstimate,
      hasTools,
      toolCount: input.toolCount,
      hasCodeBlocks,
      hasReasoningMarkers,
      turnDepth: input.turnDepth,
    },
  };
}

function classifyComplexity(score: number): ComplexityClass {
  if (score < 0.2) return "trivial";
  if (score < 0.4) return "simple";
  if (score < 0.6) return "moderate";
  if (score < 0.8) return "complex";
  return "expert";
}
