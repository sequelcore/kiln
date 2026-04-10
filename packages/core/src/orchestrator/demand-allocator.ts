/**
 * Demand allocator for task-category specialization.
 *
 * Each agent has an allocation threshold per task category (0-1).
 * When task demand exceeds the agent's threshold for that category, the agent picks it up.
 * Agents with lower thresholds for a category are more likely to claim it. This produces
 * emergent specialization without central coordination.
 *
 * Among eligible agents, the one with the lowest threshold wins (most specialized).
 * Ties are broken by agent order in the team roster.
 *
 * Adaptive mode (Phase 8.3e): thresholds evolve via EMA based on task outcomes.
 * Successful outcomes lower thresholds (agent becomes more responsive to that category).
 * Failed outcomes raise thresholds (agent becomes less responsive to that category).
 * Hysteresis window prevents adaptation until sufficient data is collected.
 */

export type TaskCategory =
  | "research"
  | "code"
  | "review"
  | "ops"
  | "writing"
  | "triage"
  | "general";

export interface TaskDemand {
  readonly category: TaskCategory;
  readonly demand: number;
}

export interface AgentThresholds {
  readonly agentId: string;
  readonly thresholds: Readonly<Record<TaskCategory, number>>;
}

export interface AllocationResult {
  readonly agentId: string;
  readonly category: TaskCategory;
  readonly demand: number;
  readonly agentThreshold: number;
  readonly margin: number;
}

export interface TaskOutcome {
  readonly agentId: string;
  readonly category: TaskCategory;
  readonly success: boolean;
  readonly durationMs?: number;
}

export interface AdaptiveConfig {
  readonly alpha: number;
  readonly successDelta: number;
  readonly failureDelta: number;
  readonly floor: number;
  readonly ceiling: number;
  readonly hysteresisWindow: number;
}

export const DEFAULT_ADAPTIVE_CONFIG: AdaptiveConfig = Object.freeze({
  alpha: 0.1,
  successDelta: -0.05,
  failureDelta: 0.08,
  floor: 0.05,
  ceiling: 0.95,
  hysteresisWindow: 3,
});

export const DEFAULT_DEMAND_THRESHOLD = 0.5;

export const DEFAULT_DEMAND_THRESHOLDS: Readonly<Record<TaskCategory, number>> = {
  research: DEFAULT_DEMAND_THRESHOLD,
  code: DEFAULT_DEMAND_THRESHOLD,
  review: DEFAULT_DEMAND_THRESHOLD,
  ops: DEFAULT_DEMAND_THRESHOLD,
  writing: DEFAULT_DEMAND_THRESHOLD,
  triage: DEFAULT_DEMAND_THRESHOLD,
  general: DEFAULT_DEMAND_THRESHOLD,
};

export class DemandAllocator {
  private readonly agents: Map<string, Record<TaskCategory, number>>;
  private readonly initialThresholds: Map<string, Record<TaskCategory, number>>;
  private readonly outcomes: TaskOutcome[];
  private readonly adaptive: AdaptiveConfig;

  constructor(agentConfigs: readonly AgentThresholds[], adaptiveConfig?: Partial<AdaptiveConfig>) {
    this.agents = new Map();
    this.initialThresholds = new Map();
    this.outcomes = [];
    this.adaptive = {
      ...DEFAULT_ADAPTIVE_CONFIG,
      ...adaptiveConfig,
    };

    for (const config of agentConfigs) {
      const merged = { ...DEFAULT_DEMAND_THRESHOLDS, ...config.thresholds };
      this.agents.set(config.agentId, { ...merged });
      this.initialThresholds.set(config.agentId, { ...merged });
    }
  }

  allocate(demand: TaskDemand): AllocationResult | null {
    let best: AllocationResult | null = null;

    for (const [agentId, thresholds] of this.agents) {
      const agentThreshold = thresholds[demand.category];
      if (demand.demand > agentThreshold) {
        const margin = demand.demand - agentThreshold;
        if (best === null || agentThreshold < best.agentThreshold) {
          best = {
            agentId,
            category: demand.category,
            demand: demand.demand,
            agentThreshold,
            margin,
          };
        }
      }
    }

    return best;
  }

  allocateWithFallback(demand: TaskDemand): AllocationResult {
    const result = this.allocate(demand);
    if (result) return result;

    let fallback: AllocationResult | null = null;
    for (const [agentId, thresholds] of this.agents) {
      const agentThreshold = thresholds[demand.category];
      if (fallback === null || agentThreshold < fallback.agentThreshold) {
        fallback = {
          agentId,
          category: demand.category,
          demand: demand.demand,
          agentThreshold,
          margin: demand.demand - agentThreshold,
        };
      }
    }

    return fallback!;
  }

  recordOutcome(outcome: TaskOutcome): void {
    this.outcomes.push(outcome);
    this.adaptThreshold(outcome.agentId, outcome.category, outcome.success);
  }

  getThresholds(agentId: string): Readonly<Record<TaskCategory, number>> | undefined {
    const thresholds = this.agents.get(agentId);
    return thresholds ? { ...thresholds } : undefined;
  }

  getOutcomes(): readonly TaskOutcome[] {
    return [...this.outcomes];
  }

  resetAdaptation(agentId?: string): void {
    if (agentId !== undefined) {
      const initial = this.initialThresholds.get(agentId);
      if (initial) {
        this.agents.set(agentId, { ...initial });
      }
      for (let i = this.outcomes.length - 1; i >= 0; i--) {
        const outcome = this.outcomes[i];
        if (outcome && outcome.agentId === agentId) {
          this.outcomes.splice(i, 1);
        }
      }
    } else {
      for (const [id, initial] of this.initialThresholds) {
        this.agents.set(id, { ...initial });
      }
      this.outcomes.splice(0, this.outcomes.length);
    }
  }

  private adaptThreshold(agentId: string, category: TaskCategory, success: boolean): void {
    const count = this.outcomes.filter(
      (o) => o.agentId === agentId && o.category === category,
    ).length;

    if (count < this.adaptive.hysteresisWindow) {
      return;
    }

    const thresholds = this.agents.get(agentId);
    if (!thresholds) {
      return;
    }

    const delta = success ? this.adaptive.successDelta : this.adaptive.failureDelta;
    const current = thresholds[category];
    let newThreshold = current + this.adaptive.alpha * delta;

    newThreshold = Math.max(this.adaptive.floor, Math.min(this.adaptive.ceiling, newThreshold));

    thresholds[category] = newThreshold;
  }
}
