/**
 * Chain governor for handoff continuation control.
 *
 * Model: A(t+1) = decay * A(t) + gain - cost
 * - A(0) initialized from task complexity
 * - Each handoff step applies decay, adds estimated gain, subtracts cost
 * - Chain continues only if A(t+1) >= threshold AND hard depth limit not exceeded
 *
 * Inspired by neural field theory: subcritical systems self-extinguish,
 * supercritical systems are caught by the hard limit.
 */

/** Configuration for chain-governance behavior */
export interface ChainGovernorConfig {
  /** Decay factor per handoff step (0-1). Lower = faster damping. Default 0.8 */
  readonly decay: number;
  /** Minimum energy to allow continuation. Default 0.2 */
  readonly threshold: number;
  /** Hard maximum handoff depth (safety net). Default 10 */
  readonly maxDepth: number;
  /** Base cost per handoff step (tokens + latency proxy). Default 0.15 */
  readonly baseCost: number;
}

export const DEFAULT_CHAIN_GOVERNOR_CONFIG: Readonly<ChainGovernorConfig> = {
  decay: 0.8,
  threshold: 0.2,
  maxDepth: 10,
  baseCost: 0.15,
};

/** Snapshot of energy state at a point in the chain */
export interface ChainGovernorSnapshot {
  readonly step: number;
  readonly energy: number;
  readonly gain: number;
  readonly cost: number;
  readonly allowed: boolean;
}

export class ChainGovernor {
  private readonly config: ChainGovernorConfig;
  private energy: number;
  private step: number;
  private readonly history: ChainGovernorSnapshot[];

  /**
   * @param initialComplexity - complexity score (0-1) to seed initial energy
   * @param config - chain-governance configuration (merged with defaults)
   */
  constructor(initialComplexity: number, config?: Partial<ChainGovernorConfig>) {
    this.config = { ...DEFAULT_CHAIN_GOVERNOR_CONFIG, ...config };
    // Initial energy: complexity determines starting fuel
    // Scale to 0.3-1.0 range so even low-complexity tasks get some runway
    this.energy = 0.3 + initialComplexity * 0.7;
    this.step = 0;
    this.history = [];
  }

  /**
   * Propose a handoff step. Returns whether the chain should continue.
   *
   * @param gain - estimated information gain from this handoff (0-1).
   *   High gain = agent has strong reason to hand off (new capability needed).
   *   Low gain = speculative or repeated handoff.
   * @returns true if handoff is allowed, false if chain should terminate
   */
  shouldContinue(gain: number): boolean {
    this.step++;

    const cost = this.config.baseCost;
    const nextEnergy = this.config.decay * this.energy + gain - cost;
    const allowed = nextEnergy >= this.config.threshold && this.step <= this.config.maxDepth;

    this.history.push({
      step: this.step,
      energy: nextEnergy,
      gain,
      cost,
      allowed,
    });

    this.energy = Math.max(0, nextEnergy); // clamp to non-negative
    return allowed;
  }

  /** Current energy level */
  currentEnergy(): number {
    return this.energy;
  }

  /** Current step count */
  currentStep(): number {
    return this.step;
  }

  /** Full history of chain decisions */
  getHistory(): readonly ChainGovernorSnapshot[] {
    return [...this.history];
  }

  /** Whether the chain has been terminated (last decision was false) */
  isTerminated(): boolean {
    const last = this.history[this.history.length - 1];
    return last !== undefined && !last.allowed;
  }

  /** Returns the active config (may differ from DEFAULT_CHAIN_GOVERNOR_CONFIG) */
  getConfig(): Readonly<ChainGovernorConfig> {
    return this.config;
  }
}
