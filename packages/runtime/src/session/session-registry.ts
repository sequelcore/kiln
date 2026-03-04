import { ModeBSession } from "./mode-b-session.js";
import type { ModeBSessionConfig } from "./mode-b-session.js";
import type { ConversationEventEmitter } from "../gateway/conversation-event-emitter.js";

export class SessionRegistry {
  private readonly sessions = new Map<string, ModeBSession>();
  private readonly defaultIdleTimeoutMs?: number;
  eventEmitter?: ConversationEventEmitter;

  constructor(defaultIdleTimeoutMs?: number) {
    this.defaultIdleTimeoutMs = defaultIdleTimeoutMs;
  }

  getOrCreate(config: ModeBSessionConfig): ModeBSession {
    this.cleanup();
    const key = this.sessionKey(config.appName, config.userId, config.tenantId);
    const existing = this.sessions.get(key);
    if (existing && !existing.isExpired) {
      return existing;
    }

    const sessionConfig: ModeBSessionConfig =
      this.defaultIdleTimeoutMs !== undefined
        ? { ...config, idleTimeoutMs: config.idleTimeoutMs ?? this.defaultIdleTimeoutMs }
        : config;
    const session = new ModeBSession(sessionConfig);
    this.sessions.set(key, session);
    return session;
  }

  get(appName: string, userId: string, tenantId?: string): ModeBSession | undefined {
    const key = this.sessionKey(appName, userId, tenantId);
    return this.sessions.get(key);
  }

  remove(appName: string, userId: string, tenantId?: string): boolean {
    const key = this.sessionKey(appName, userId, tenantId);
    return this.sessions.delete(key);
  }

  /** Remove all sessions for a given tenant. Returns the number of sessions invalidated. */
  invalidateByTenant(appName: string, tenantId: string): number {
    const prefix = `${appName}:${tenantId}:`;
    let removed = 0;
    for (const key of this.sessions.keys()) {
      if (key.startsWith(prefix)) {
        this.sessions.delete(key);
        removed++;
      }
    }
    return removed;
  }

  activeCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      if (!session.isExpired) count++;
    }
    return count;
  }

  activeSessions(): readonly ModeBSession[] {
    const active: ModeBSession[] = [];
    for (const session of this.sessions.values()) {
      if (!session.isExpired) active.push(session);
    }
    return active;
  }

  cleanup(): number {
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (session.isExpired) {
        this.sessions.delete(key);
        removed++;

        if (this.eventEmitter && session.tenantId) {
          this.eventEmitter.emit({
            eventType: "SESSION_EXPIRED",
            tenantId: session.tenantId,
            channel: "unknown",
            externalUserId: session.userId,
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
    return removed;
  }

  private sessionKey(appName: string, userId: string, tenantId?: string): string {
    return tenantId ? `${appName}:${tenantId}:${userId}` : `${appName}:${userId}`;
  }
}
