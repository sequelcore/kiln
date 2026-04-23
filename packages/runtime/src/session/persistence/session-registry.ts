import { KilnError } from "@kilnai/core";
import { RuntimeSession } from "../runtime-session.js";
import type { RuntimeSessionConfig } from "../runtime-session.js";
import type { ConversationEventEmitter } from "../../gateway/conversation-event-emitter.js";
import type { SessionStore } from "./session-store.js";
import { InMemorySessionStore } from "./in-memory-session-store.js";

export class SessionRegistry {
  private readonly store: SessionStore;
  private readonly defaultIdleTimeoutMs?: number;
  private readonly activeSessionIds = new Map<string, string>();
  eventEmitter?: ConversationEventEmitter;
  onSessionExpired?: (session: RuntimeSession) => void;

  constructor(defaultIdleTimeoutMs?: number, store?: SessionStore) {
    this.defaultIdleTimeoutMs = defaultIdleTimeoutMs;
    this.store = store ?? new InMemorySessionStore();
  }

  async getOrCreate(config: RuntimeSessionConfig): Promise<RuntimeSession> {
    await this.cleanup();
    const conversationKey = this.sessionKey(config.appName, config.userId, config.tenantId);
    const targetSessionId = config.sessionId ?? this.activeSessionIds.get(conversationKey);
    const existing = targetSessionId ? await this.store.get(targetSessionId) : undefined;
    if (existing && !existing.isExpired) {
      this.activeSessionIds.set(conversationKey, existing.id);
      return existing;
    }

    const sessionConfig: RuntimeSessionConfig =
      this.defaultIdleTimeoutMs !== undefined
        ? { ...config, idleTimeoutMs: config.idleTimeoutMs ?? this.defaultIdleTimeoutMs }
        : config;
    const session = new RuntimeSession(sessionConfig);
    await this.store.set(session.id, session);
    this.activeSessionIds.set(conversationKey, session.id);

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

  async get(appName: string, userId: string, tenantId: string): Promise<RuntimeSession | undefined> {
    const sessionId = this.activeSessionIds.get(this.sessionKey(appName, userId, tenantId));
    return sessionId ? this.store.get(sessionId) : undefined;
  }

  /**
   * Persist a mutated session back to the store. Required for non-reference stores (e.g. Redis).
   * Uses optimistic concurrency: checks that the stored version matches the version at load time.
   * Throws CONCURRENT_SESSION_MODIFICATION if the session was modified by another request.
   */
  async save(session: RuntimeSession): Promise<void> {
    const key = session.id;
    const stored = await this.store.get(key);
    if (stored && stored !== session && stored.version !== session.loadedVersion) {
      throw new KilnError("CONCURRENT_SESSION_MODIFICATION", `Session ${session.id} was modified concurrently (stored v${stored.version}, loaded v${session.loadedVersion})`, {
        context: { sessionId: session.id, storedVersion: stored.version, loadedVersion: session.loadedVersion },
        retryable: true,
      });
    }
    await this.store.set(key, session);
    this.activeSessionIds.set(this.sessionKey(session.appName, session.userId, session.tenantId), session.id);
  }

  async remove(appName: string, userId: string, tenantId: string): Promise<boolean> {
    const key = this.sessionKey(appName, userId, tenantId);
    const sessionId = this.activeSessionIds.get(key);
    this.activeSessionIds.delete(key);
    return sessionId ? this.store.delete(sessionId) : false;
  }

  async detachActive(appName: string, userId: string, tenantId: string): Promise<boolean> {
    const key = this.sessionKey(appName, userId, tenantId);
    const existed = this.activeSessionIds.has(key);
    this.activeSessionIds.delete(key);
    return existed;
  }

  /** Remove all sessions for a given tenant. Returns the number of sessions invalidated. */
  async invalidateByTenant(appName: string, tenantId: string): Promise<number> {
    const prefix = `${appName}:${tenantId}:`;
    for (const key of this.activeSessionIds.keys()) {
      if (key.startsWith(prefix)) {
        this.activeSessionIds.delete(key);
      }
    }
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

  async activeSessions(): Promise<readonly RuntimeSession[]> {
    const allKeys = await this.store.keys();
    const active: RuntimeSession[] = [];
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
        for (const [conversationKey, sessionId] of this.activeSessionIds) {
          if (sessionId === session.id) {
            this.activeSessionIds.delete(conversationKey);
          }
        }
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
