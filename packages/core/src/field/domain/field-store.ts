import type { FieldSignal, FieldSnapshot, FieldVector } from "./field.js";

export interface FieldStore {
  inject(signal: FieldSignal): Promise<void>;
  snapshot(): Promise<FieldSnapshot>;
  queryRegion(regionId: string): Promise<FieldVector | null>;
  subscribe(cb: (snapshot: FieldSnapshot) => void): () => void;
}
