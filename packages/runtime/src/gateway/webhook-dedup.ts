// Gateway: WebhookDedup -- at-least-once delivery deduplication for Meta webhooks
// Tracks seen message IDs with TTL to prevent processing the same message twice

export class WebhookDedup {
  private readonly seen = new Map<string, number>(); // messageId -> expiresAt timestamp
  private readonly ttlMs: number;
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000);
  }

  /** Returns true if this messageId was already seen within the TTL window. */
  isDuplicate(messageId: string): boolean {
    const now = Date.now();

    const expiresAt = this.seen.get(messageId);
    if (expiresAt !== undefined) {
      if (now < expiresAt) return true;
      // Expired -- fall through to re-add
    }

    this.seen.set(messageId, now + this.ttlMs);
    return false;
  }

  /** Clear the periodic cleanup interval. */
  close(): void {
    clearInterval(this.cleanupInterval);
  }

  /** Remove entries that have expired. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [id, expiresAt] of this.seen) {
      if (now >= expiresAt) {
        this.seen.delete(id);
      }
    }
  }
}
