import type { EventBus } from "../events/event-bus.js";
import { FieldUpdater } from "./field-updater.js";
import { FieldPropagator } from "./field-propagator.js";
import { FieldInhibitor } from "./field-inhibitor.js";
import type { FieldInhibitorConfig } from "./field-inhibitor.js";
import { StabilityMonitor } from "./stability-monitor.js";
import type { StabilityConfig } from "./stability-monitor.js";
import { InMemoryFieldStore } from "./infrastructure/in-memory-field-store.js";
import type { FieldSnapshot } from "./domain/field.js";
import type { FieldStore } from "./domain/field-store.js";

const fieldStore: FieldStore = new InMemoryFieldStore();
let latestSnapshot: FieldSnapshot | null = null;
let updater: FieldUpdater | null = null;
const propagator = new FieldPropagator(fieldStore);
let inhibitor: FieldInhibitor | null = null;
let stabilityMonitor: StabilityMonitor | null = null;

fieldStore.snapshot().then((snapshot) => {
  latestSnapshot = snapshot;
});
fieldStore.subscribe((snapshot) => {
  latestSnapshot = snapshot;
});

export function getFieldStore(): FieldStore {
  return fieldStore;
}

export function getFieldStrength(regionId: string): number {
  return latestSnapshot?.regions.get(regionId)?.value ?? 0;
}

export function attachFieldUpdater(eventBus: EventBus): FieldUpdater {
  if (!updater) {
    updater = new FieldUpdater({ eventBus, fieldStore });
  }
  return updater;
}

export function startFieldPropagator(): FieldPropagator {
  propagator.start();
  return propagator;
}

export function stopFieldPropagator(): void {
  propagator.stop();
}

export function startFieldInhibitor(config?: FieldInhibitorConfig): FieldInhibitor {
  if (!inhibitor) {
    inhibitor = new FieldInhibitor(fieldStore, config);
  }
  inhibitor.start();
  return inhibitor;
}

export function stopFieldInhibitor(): void {
  inhibitor?.stop();
}

export function startStabilityMonitor(config?: StabilityConfig): StabilityMonitor {
  if (!stabilityMonitor) {
    stabilityMonitor = new StabilityMonitor(fieldStore, config);
  }
  stabilityMonitor.start();
  return stabilityMonitor;
}

export function stopStabilityMonitor(): void {
  stabilityMonitor?.stop();
}
