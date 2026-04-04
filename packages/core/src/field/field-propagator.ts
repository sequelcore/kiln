import type { FieldVector } from "./domain/field.js";
import type { FieldStore } from "./domain/field-store.js";

interface FieldPropagatorConfig {
  readonly intervalMs?: number;
  readonly decayRate?: number;
  readonly diffusionFactor?: number;
  readonly diffusionNeighbors?: number;
}

const DEFAULT_PROPAGATOR_CONFIG: Required<FieldPropagatorConfig> = {
  intervalMs: 1_000,
  decayRate: 0.05,
  diffusionFactor: 0.2,
  diffusionNeighbors: 3,
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

export class FieldPropagator {
  private timer: NodeJS.Timeout | null = null;
  private readonly config: Required<FieldPropagatorConfig>;

  constructor(
    private readonly fieldStore: FieldStore,
    config?: FieldPropagatorConfig,
  ) {
    this.config = { ...DEFAULT_PROPAGATOR_CONFIG, ...config };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const snapshot = await this.fieldStore.snapshot();
    if (snapshot.regions.size === 0) return;

    const regions = [...snapshot.regions.values()] as FieldVector[];
    const updates = this.computeUpdates(regions);
    for (const [regionId, delta] of updates.entries()) {
      if (Math.abs(delta) < 1e-6) continue;
      const signal = {
        regionId,
        delta,
        source: "propagation" as const,
      };
      void this.fieldStore.inject(signal);
    }
  }

  private computeUpdates(regions: FieldVector[]): Map<string, number> {
    const sorted = [...regions].sort((a, b) => b.value - a.value);
    const updates = new Map<string, number>();

    for (const region of sorted) {
      const decayed = clamp(region.value * (1 - this.config.decayRate));
      const diffusionAmount = decayed * this.config.diffusionFactor;
      const keep = decayed - diffusionAmount;
      updates.set(region.regionId, (updates.get(region.regionId) ?? 0) + (keep - region.value));

      const neighbors = sorted
        .filter((candidate) => candidate.regionId !== region.regionId)
        .slice(0, this.config.diffusionNeighbors);

      if (neighbors.length === 0) continue;
      const share = diffusionAmount / neighbors.length;
      for (const neighbor of neighbors) {
        updates.set(neighbor.regionId, (updates.get(neighbor.regionId) ?? 0) + share);
      }
    }

    return updates;
  }
}
