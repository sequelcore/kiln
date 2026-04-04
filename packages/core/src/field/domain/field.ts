export type FieldSignalSource = "event" | "propagation" | "inhibition" | "decay";

export interface FieldVector {
  readonly regionId: string;
  readonly value: number;
  readonly confidence: number;
  readonly updatedAt: number;
  readonly source: FieldSignalSource;
}

export interface FieldSignal {
  readonly regionId: string;
  readonly delta: number;
  readonly confidence?: number;
  readonly source: FieldSignalSource;
  readonly timestamp?: number;
}

export interface FieldSnapshot {
  readonly timestamp: number;
  readonly regions: ReadonlyMap<string, FieldVector>;
  readonly entropy: number;
  readonly dominantRegions: readonly string[];
}
