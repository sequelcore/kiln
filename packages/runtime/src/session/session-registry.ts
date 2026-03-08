import { KilnError } from "@kilnai/core";
import { ModeBSession } from "./mode-b-session.js";
import type { ModeBSessionConfig } from "./mode-b-session.js";
import type { ConversationEventEmitter } from "../gateway/conversation-event-emitter.js";
import type { SessionStore } from "./session-store.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";

export class SessionRegistry {
  private readonly store: SessionStore;
  private readonly defaultIdleTimeoutMs?: number;
  eventEmitter?: ConversationEventEmitter;
  onSessionExpired?: (session: ModeBSession) => void;

  constructor(defaultIdleTimeoutMs?: number, store?: SessionStore) {
    this.defaultIdleTimeoutMs = defaultIdleTimeoutMs;
    this.store = store ?? new InMemorySessionStore();
  }

  async getOrCreate(config: ModeBSessionConfig): Promise<ModeBSession> {
    await this.cleanup();
    const key = this.sessionKey(config.appName, config.userId, config.tenantId);
    const existing = await this.store.get(key);
    if (existing && !existing.isExpired) {
      return existing;
    }

    const sessionConfig: ModeBSessionConfig =
      this.defaultIdleTimeoutMs !== undefined
        ? { ...config, idleTimeoutMs: config.idleTimeoutMs ?? this.defaultIdleTimeoutMs }
        : config;
    const session = new ModeBSession(sessionConfig);
    await this.store.set(key, session);

    // Emit SESSION_STARTED for new sessions
    if (this.eventEmitter) {
      this.eventEmitter.emit({
        eventType: "SESSION_STARTED",
        tenantId: sessionConfig.tenantId,
        channel: "unknown",
        externalUserId: sessionConfig.userId,
        sessionId: session.id,
        schemaVersion: "1",
        timestamp: new Date().toISOString(),
      });
    }

    return session;
  }

  async get(appName: string, userId: string, tenantId: string): Promise<ModeBSession | undefined> {
    const key = this.sessionKey(appName, userId, tenantId);
    return this.store.get(key);
  }

  /**
   * Persist a mutated session back to the store. Required for non-reference stores (e.g. Redis).
   * Uses optimistic concurrency: checks that the stored version matches the version at load time.
   * Throws CONCURRENT_SESSION_MODIFICATION if the session was modified by another request.
   */
  async save(session: ModeBSession): Promise<void> {
    const key = this.sessionKey(session.appName, session.userId, session.tenantId);
    const stored = await this.store.get(key);
    if (stored && stored !== session && stored.version !== session.loadedVersion) {
      throw new KilnError("CONCURRENT_SESSION_MODIFICATION", `Session ${session.id} was modified concurrently (stored v${stored.version}, loaded v${session.loadedVersion})`, {
        context: { sessionId: session.id, storedVersion: stored.version, loadedVersion: session.loadedVersion },
        retryable: true,
      });
    }
    await this.store.set(key, session);
  }

  async remove(appName: string, userId: string, tenantId: string): Promise<boolean> {
    const key = this.sessionKey(appName, userId, tenantId);
    return this.store.delete(key);
  }

  /** Remove all sessions for a given tenant. Returns the number of sessions invalidated. */
  async invalidateByTenant(appName: string, tenantId: string): Promise<number> {
    const prefix = `${appName}:${tenantId}:`;
    return this.store.deleteByPrefix(prefix);
  }

  async activeCount(): Promise<number> {
    const allKeys = await this.store.keys();
    let count = 0;
    for (const key of allKeys) {
      const session = await this.store.get(key);
      if (session && !session.isExpired) count++;
    }
    return count;
  }

  async activeSessions(): Promise<readonly ModeBSession[]> {
    const allKeys = await this.store.keys();
    const active: ModeBSession[] = [];
    for (const key of allKeys) {
      const session = await this.store.get(key);
      if (session && !session.isExpired) active.push(session);
    }
    return active;
  }

  async cleanup(): Promise<number> {
    const allKeys = await this.store.keys();
    let removed = 0;
    for (const key of allKeys) {
      const session = await this.store.get(key);
      if (session && session.isExpired) {
        // Trigger contact memory extraction before deleting
        if (this.onSessionExpired) {
          try { this.onSessionExpired(session); } catch { /* fire-and-forget */ }
        }

        await this.store.delete(key);
        removed++;

        if (this.eventEmitter) {
          this.eventEmitter.emit({
            eventType: "SESSION_EXPIRED",
            tenantId: session.tenantId,
            channel: "unknown",
            externalUserId: session.userId,
            sessionId: session.id,
            schemaVersion: "1",
            timestamp: new Date().toISOString(),
          });

          this.eventEmitter.emit({
            eventType: "CONVERSATION_ABANDONED",
            tenantId: session.tenantId,
            channel: "unknown",
            externalUserId: session.userId,
            sessionId: session.id,
            schemaVersion: "1",
            closedBy: "session_timeout",
            turnCount: session.messageCount,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    return removed;
  }

  private sessionKey(appName: string, userId: string, tenantId: string): string {
    return `${appName}:${tenantId}:${userId}`;
  }
}
