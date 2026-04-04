import type { FieldStore } from "./domain/field-store.js";
import type { FieldSignal, FieldVector } from "./domain/field.js";

export interface FieldInhibitorConfig {
  readonly intervalMs?: number;
  readonly inhibitionStrength?: number;
  readonly dominanceThreshold?: number;
  readonly maxSuppressedRegions?: number;
}

const DEFAULT: Required<FieldInhibitorConfig> = {
  intervalMs: 2_000,
  inhibitionStrength: 0.08,
  dominanceThreshold: 0.6,
  maxSuppressedRegions: 5,
};

export class FieldInhibitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly config: Required<FieldInhibitorConfig>;

  constructor(
    private readonly fieldStore: FieldStore,
    config?: FieldInhibitorConfig,
  ) {
    this.config = { ...DEFAULT, ...config };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, this.config.intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private async tick(): Promise<void> {
    const snapshot = await this.fieldStore.snapshot();
    if (snapshot.regions.size === 0) return;

    const regions = [...snapshot.regions.values()] as FieldVector[];
    const dominant = regions
      .filter((r) => r.value >= this.config.dominanceThreshold)
      .sort((a, b) => b.value - a.value);

    for (const dom of dominant) {
      const targets = regions
        .filter((r) => r.regionId !== dom.regionId && r.value > 0.02)
        .sort((a, b) => a.value - b.value)
        .slice(0, this.config.maxSuppressedRegions);

      for (const target of targets) {
        const signal: FieldSignal = {
          regionId: target.regionId,
          delta: -(this.config.inhibitionStrength * dom.value),
          source: "inhibition",
        };
        void this.fieldStore.inject(signal);
      }
    }
  }
}
