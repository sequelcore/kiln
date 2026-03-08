import type { EventStore, KilnEvent } from "@kilnai/core";

/**
 * Fan-out EventStore that delegates to multiple sinks.
 * Uses Promise.allSettled to ensure all sinks are called.
 */
export class CompositeEventStore implements EventStore {
  private readonly stores: readonly EventStore[];

  constructor(stores: readonly EventStore[]) {
    this.stores = stores;
  }

  async save(event: KilnEvent): Promise<void> {
    await Promise.allSettled(this.stores.map((s) => s.save(event)));
  }

  async getBySession(sessionId: string): Promise<KilnEvent[]> {
    // Delegate to first store that doesn't reject
    for (const store of this.stores) {
      try {
        return await store.getBySession(sessionId);
      } catch {
        // Try next store
      }
    }
    return [];
  }

  async getAfter(sessionId: string, afterId: string): Promise<KilnEvent[]> {
    for (const store of this.stores) {
      try {
        return await store.getAfter(sessionId, afterId);
      } catch {
        // Try next store
      }
    }
    return [];
  }
}
