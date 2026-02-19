// Decay curve strategies: pure functions for memory score decay
// Zero external dependencies

/** Decay curve strategy */
export type DecayCurve = "exponential" | "linear" | "step";

/** Decay configuration */
export interface DecayConfig {
  readonly curve: DecayCurve;
  readonly factor: number;
  readonly pruneThreshold: number;
}

/** Default decay configuration (matches existing behavior) */
export const DEFAULT_DECAY_CONFIG: DecayConfig = {
  curve: "exponential",
  factor: 0.95,
  pruneThreshold: 0.01,
};

/**
 * Apply exponential decay: score = score * factor.
 * Good default -- frequently accessed entries decay slower due to reinforce().
 */
export function exponentialDecay(score: number, factor: number): number {
  return score * factor;
}

/**
 * Apply linear decay: score = score - factor.
 * Constant rate of forgetting, regardless of current score.
 */
export function linearDecay(score: number, factor: number): number {
  return Math.max(0, score - factor);
}

/**
 * Apply step decay: score = 0 if age exceeds threshold (factor = max age in days).
 * Binary: an entry is either fully remembered or completely forgotten.
 */
export function stepDecay(ageInDays: number, factor: number): number {
  return ageInDays > factor ? 0 : 1;
}

/**
 * Apply the configured decay curve to a score.
 * For step decay, requires ageInDays parameter.
 */
export function applyDecayCurve(
  score: number,
  config: DecayConfig,
  ageInDays?: number,
): number {
  switch (config.curve) {
    case "exponential":
      return exponentialDecay(score, config.factor);
    case "linear":
      return linearDecay(score, config.factor);
    case "step":
      return stepDecay(ageInDays ?? 0, config.factor);
  }
}

/** Check if a score is below the prune threshold */
export function shouldPrune(score: number, threshold: number): boolean {
  return score < threshold;
}
