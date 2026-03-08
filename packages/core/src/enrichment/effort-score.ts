import type { EffortComponents } from "./types.js";

/**
 * Compute Customer Effort Score (0-10 scale, 10 = zero effort).
 * Rule-based, no LLM calls, deterministic.
 */
export function computeEffortScore(components: EffortComponents): number {
  const base = 10;
  const result =
    base -
    Math.min(3, Math.max(0, components.userTurns - 2) * 0.3) -
    Math.min(2, components.clarificationRequests * 0.5) -
    Math.min(2, components.toolErrors * 0.4) -
    Math.min(1.5, components.agentHandoffs * 0.5) -
    (components.escalated ? 1.5 : 0);
  return Math.max(0, Math.round(result * 100) / 100); // 2 decimal places
}
