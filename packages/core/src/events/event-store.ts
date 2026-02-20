import type { KilnEvent } from "./index.js";

/** Persistent event storage. Consumers implement this for their infrastructure (Postgres, SQLite, etc.). */
export interface EventStore {
  /** Persist an event. Called fire-and-forget from EventBus.emit(). */
  save(event: KilnEvent): Promise<void>;
  /** Retrieve all events for a session, ordered by id ascending. */
  getBySession(sessionId: string): Promise<KilnEvent[]>;
  /** Retrieve events after a given event id (for SSE reconnection). */
  getAfter(sessionId: string, afterId: string): Promise<KilnEvent[]>;
}
