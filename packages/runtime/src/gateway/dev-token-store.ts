export interface DevToken {
  readonly token: string;
  readonly userId: string;
  readonly createdAt: number;
  lastActivityAt: number;
}

export class DevTokenStore {
  private readonly tokens = new Map<string, DevToken>();
  private readonly ttlMs: number;

  constructor(ttlMs = 30 * 60 * 1000) {
    this.ttlMs = ttlMs;
  }

  issue(userId: string): string {
    const token = crypto.randomUUID();
    const now = Date.now();
    this.tokens.set(token, { token, userId, createdAt: now, lastActivityAt: now });
    return token;
  }

  validate(token: string): { valid: boolean; userId?: string } {
    const entry = this.tokens.get(token);
    if (!entry) return { valid: false };
    if (Date.now() - entry.lastActivityAt > this.ttlMs) {
      this.tokens.delete(token);
      return { valid: false };
    }
    entry.lastActivityAt = Date.now();
    return { valid: true, userId: entry.userId };
  }

  revoke(token: string): boolean {
    return this.tokens.delete(token);
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [t, entry] of this.tokens) {
      if (now - entry.lastActivityAt > this.ttlMs) {
        this.tokens.delete(t);
        removed++;
      }
    }
    return removed;
  }
}
