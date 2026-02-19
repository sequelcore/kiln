// EventBridge: converts EventBus synchronous push -> AsyncIterable pull
// Bridges KilnEvent (orchestrator internal) to EngineEvent (channel primitive)

import type { KilnEvent, EventBus, StreamLevel } from "@kilnai/core";
import type { EngineEvent } from "@kilnai/core";
import { EVENT_LEVEL_MAP, LEVEL_HIERARCHY } from "@kilnai/core";

/** Convert a KilnEvent to an EngineEvent for channel consumption */
export function toEngineEvent(event: KilnEvent): EngineEvent {
  const { type, timestamp, sessionId, ...rest } = event;
  return {
    type,
    timestamp,
    payload: { sessionId, ...rest } as Record<string, unknown>,
  };
}

/**
 * Bridge between EventBus (synchronous push) and Channel.stream() (AsyncIterable pull).
 * Subscribes to EventBus.onAny(), converts events, and yields them as an async generator.
 * Bounded queue prevents unbounded memory growth if consumer is slower than producer.
 */
export class EventBridge {
  private readonly queue: EngineEvent[] = [];
  private readonly maxQueueSize: number;
  private resolve: (() => void) | null = null;
  private done = false;
  private unsubscribe: (() => void) | null = null;

  constructor(maxQueueSize = 1000) {
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Subscribe to an EventBus and start bridging events.
   * If level is provided, only events matching that level or coarser are bridged.
   */
  connect(eventBus: EventBus, level?: StreamLevel): void {
    const handler = (event: KilnEvent): void => {
      if (this.done) return;

      if (level) {
        const eventLevel = EVENT_LEVEL_MAP[event.type];
        const allowedLevels = LEVEL_HIERARCHY[level];
        if (!allowedLevels.includes(eventLevel)) {
          return;
        }
      }

      const engineEvent = toEngineEvent(event);
      if (this.queue.length < this.maxQueueSize) {
        this.queue.push(engineEvent);
      }
      // Wake up the async generator if it's waiting
      if (this.resolve) {
        this.resolve();
        this.resolve = null;
      }
    };

    eventBus.onAny(handler);
    this.unsubscribe = () => eventBus.offAny(handler);
  }

  /** Stop bridging and signal the async generator to complete */
  disconnect(): void {
    this.done = true;
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    // Wake up pending consumer so it can exit
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  /** Async generator that yields EngineEvents as they arrive */
  async *events(): AsyncGenerator<EngineEvent> {
    while (!this.done || this.queue.length > 0) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (!this.done) {
        // Wait for next event or disconnect
        await new Promise<void>((r) => {
          this.resolve = r;
        });
      }
    }
  }
}
