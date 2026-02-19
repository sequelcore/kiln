import type { EventType, EventMap, KilnEvent, StreamLevel } from "./index.js";
import { EVENT_LEVEL_MAP, LEVEL_HIERARCHY } from "./index.js";

// Internal handler type -- type safety is enforced at on()/off() boundaries
type InternalHandler = (event: KilnEvent) => void;

/**
 * Typed pub/sub event bus for orchestrator communication.
 * Synchronous handlers only -- events are notifications, not commands.
 */
export class EventBus {
  private readonly handlers = new Map<EventType, Set<InternalHandler>>();
  private readonly anyHandlers = new Set<InternalHandler>();
  private readonly buffer: (KilnEvent | undefined)[];
  private readonly maxHistory: number;
  private writePointer = 0;
  private count = 0;

  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory;
    this.buffer = new Array<KilnEvent | undefined>(maxHistory);
  }

  /** Subscribe to a specific event type */
  on<T extends EventType>(type: T, handler: (event: EventMap[T]) => void): void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as InternalHandler);
  }

  /** Unsubscribe from a specific event type */
  off<T extends EventType>(type: T, handler: (event: EventMap[T]) => void): void {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler as InternalHandler);
      if (set.size === 0) this.handlers.delete(type);
    }
  }

  /** Emit an event to all subscribers of its type and all onAny subscribers */
  emit(event: KilnEvent): void {
    // Write to ring buffer
    this.buffer[this.writePointer] = event;
    this.writePointer = (this.writePointer + 1) % this.maxHistory;
    if (this.count < this.maxHistory) this.count++;

    // Notify type-specific handlers
    const set = this.handlers.get(event.type);
    if (set) {
      for (const handler of set) {
        handler(event);
      }
    }

    // Notify wildcard handlers
    for (const handler of this.anyHandlers) {
      handler(event);
    }
  }

  /** Subscribe to all events */
  onAny(handler: (event: KilnEvent) => void): void {
    this.anyHandlers.add(handler);
  }

  /** Unsubscribe from all events */
  offAny(handler: (event: KilnEvent) => void): void {
    this.anyHandlers.delete(handler);
  }

  /**
   * Subscribe to events matching a streaming level.
   * Subscribing to "phase" includes "state" + "phase" events.
   */
  onLevel(level: StreamLevel, handler: (event: KilnEvent) => void): void {
    const levels = LEVEL_HIERARCHY[level];
    const types = new Set<EventType>();

    for (const [type, eventLevel] of Object.entries(EVENT_LEVEL_MAP)) {
      if (levels.includes(eventLevel)) {
        types.add(type as EventType);
      }
    }

    for (const type of types) {
      this.on(type, handler);
    }
  }

  /** Return recent events from the ring buffer, oldest first */
  history(limit?: number): readonly KilnEvent[] {
    const total = Math.min(limit ?? this.count, this.count);
    if (total === 0) return [];

    const result: KilnEvent[] = [];

    // Start reading from the oldest entry within the requested limit
    const startOffset = this.count < this.maxHistory
      ? this.count - total
      : this.writePointer + (this.count - total);

    for (let i = 0; i < total; i++) {
      const idx = (startOffset + i) % this.maxHistory;
      const event = this.buffer[idx];
      if (event) result.push(event);
    }

    return result;
  }

  /** Clear all subscriptions and history */
  clear(): void {
    this.handlers.clear();
    this.anyHandlers.clear();
    this.buffer.fill(undefined);
    this.writePointer = 0;
    this.count = 0;
  }
}
