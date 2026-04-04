import type { FieldStore } from "./domain/field-store.js";

export interface StabilityConfig {
  readonly checkIntervalMs?: number;
  readonly runawayThreshold?: number;
  readonly starvationThreshold?: number;
  readonly onRunaway?: (regionId: string, value: number) => void;
  readonly onStarvation?: (meanValue: number) => void;
  readonly onStabilized?: () => void;
}

type StabilityStatus = "stable" | "runaway" | "starvation";

const DEFAULT_CHECK_INTERVAL = 3_000;
const DEFAULT_RUNAWAY_THRESHOLD = 0.85;
const DEFAULT_STARVATION_THRESHOLD = 0.05;

export class StabilityMonitor {
  private timer: NodeJS.Timeout | null = null;
  private status: StabilityStatus = "stable";
  private readonly config: Required<Omit<StabilityConfig, "onRunaway" | "onStarvation" | "onStabilized">> & StabilityConfig;

  constructor(
    private readonly fieldStore: FieldStore,
    config?: StabilityConfig,
  ) {
    this.config = {
      checkIntervalMs: config?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL,
      runawayThreshold: config?.runawayThreshold ?? DEFAULT_RUNAWAY_THRESHOLD,
      starvationThreshold: config?.starvationThreshold ?? DEFAULT_STARVATION_THRESHOLD,
      onRunaway: config?.onRunaway,
      onStarvation: config?.onStarvation,
      onStabilized: config?.onStabilized,
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.check(); }, this.config.checkIntervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  getStatus(): StabilityStatus {
    return this.status;
  }

  private async check(): Promise<void> {
    const snapshot = await this.fieldStore.snapshot();
    if (snapshot.regions.size === 0) { this.transition("stable"); return; }

    const regions = [...snapshot.regions.values()];
    const mean = regions.reduce((sum, r) => sum + r.value, 0) / regions.length;

    const runawayRegion = regions.find((r) => r.value >= this.config.runawayThreshold);
    let next: StabilityStatus = "stable";

    if (runawayRegion && snapshot.entropy < 1.0) {
      next = "runaway";
    } else if (mean < this.config.starvationThreshold) {
      next = "starvation";
    }

    const prev = this.status;
    this.status = next;

    if (next !== prev) {
      if (next === "runaway" && runawayRegion) {
        this.config.onRunaway?.(runawayRegion.regionId, runawayRegion.value);
      } else if (next === "starvation") {
        this.config.onStarvation?.(mean);
      } else if (next === "stable") {
        this.config.onStabilized?.();
      }
    }
  }

  private transition(next: StabilityStatus): void {
    if (next !== this.status) {
      this.status = next;
      if (next === "stable") this.config.onStabilized?.();
    }
  }
}
