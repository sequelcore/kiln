import type { FieldConfig } from "../domain/field-config.js";
import { DEFAULT_FIELD_CONFIG } from "../domain/field-config.js";
import type { FieldSignal, FieldSnapshot, FieldVector } from "../domain/field.js";
import type { FieldStore } from "../domain/field-store.js";

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.max(minValue, Math.min(maxValue, value));
}

function computeEntropy(regions: readonly FieldVector[]): number {
  const total = regions.reduce((sum, region) => sum + region.value, 0);
  if (total <= 0) return 0;

  return regions.reduce((entropy, region) => {
    if (region.value <= 0) return entropy;
    const probability = region.value / total;
    return entropy - probability * Math.log2(probability);
  }, 0);
}

export class InMemoryFieldStore implements FieldStore {
  private readonly config: Required<FieldConfig>;
  private readonly regions = new Map<string, FieldVector>();
  private readonly subscribers = new Set<(snapshot: FieldSnapshot) => void>();

  constructor(config?: FieldConfig) {
    this.config = { ...DEFAULT_FIELD_CONFIG, ...config };
  }

  async inject(signal: FieldSignal): Promise<void> {
    const current = this.regions.get(signal.regionId);
    const timestamp = signal.timestamp ?? Date.now();
    const nextValue = clamp(
      (current?.value ?? 0) + signal.delta,
      this.config.minValue,
      this.config.maxValue,
    );

    const next: FieldVector = {
      regionId: signal.regionId,
      value: nextValue,
      confidence: clamp(
        signal.confidence ?? current?.confidence ?? this.config.defaultConfidence,
        0,
        1,
      ),
      updatedAt: timestamp,
      source: signal.source,
    };

    this.regions.set(signal.regionId, next);
    this.emit();
  }

  async snapshot(): Promise<FieldSnapshot> {
    return this.buildSnapshot();
  }

  async queryRegion(regionId: string): Promise<FieldVector | null> {
    return this.regions.get(regionId) ?? null;
  }

  subscribe(cb: (snapshot: FieldSnapshot) => void): () => void {
    this.subscribers.add(cb);
    return () => {
      this.subscribers.delete(cb);
    };
  }

  private emit(): void {
    if (this.subscribers.size === 0) return;
    const snapshot = this.buildSnapshot();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }

  private buildSnapshot(): FieldSnapshot {
    const regions = [...this.regions.values()].sort((left, right) => {
      return right.value - left.value || right.updatedAt - left.updatedAt;
    });
    const dominantRegions = regions
      .slice(0, this.config.dominantRegionLimit)
      .map((region) => region.regionId);

    return {
      timestamp: Date.now(),
      regions: new Map(regions.map((region) => [region.regionId, region])),
      entropy: computeEntropy(regions),
      dominantRegions,
    };
  }
}
