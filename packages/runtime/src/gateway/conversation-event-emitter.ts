// Conversation event emitter -- fire-and-forget POST to product backend
// Same pattern as reportUsage() in budget-middleware.ts

import type { ConversationEvent, ConversationEventBatch, EventsConfig } from "@kilnai/core";

/** Resolve headers: if value starts with $, look up process.env */
function resolveHeaders(config: EventsConfig): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      if (value) {
        headers[key] = value.startsWith("$")
          ? (process.env[value.slice(1)] ?? value)
          : value;
      }
    }
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ConversationEventEmitter {
  private readonly config: EventsConfig;
  private readonly headers: Record<string, string>;
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;

  constructor(config: EventsConfig) {
    this.config = config;
    this.headers = resolveHeaders(config);
    this.maxAttempts = config.retryAttempts ?? 3;
    this.baseBackoffMs = config.retryBackoffMs ?? 1000;
  }

  /** Emit a single conversation event. Fire-and-forget: logs errors, never throws. */
  emit(event: ConversationEvent): void {
    const batch: ConversationEventBatch = { events: [event] };
    this.postWithRetry(batch);
  }

  /** Emit multiple events in a single batch. Fire-and-forget. */
  emitBatch(events: readonly ConversationEvent[]): void {
    if (events.length === 0) return;
    const batch: ConversationEventBatch = { events };
    this.postWithRetry(batch);
  }

  private postWithRetry(batch: ConversationEventBatch): void {
    const body = JSON.stringify(batch);
    this.attemptPost(body, 1).catch((err) => {
      console.warn(`[events] POST error after ${this.maxAttempts} attempts:`, err);
    });
  }

  private async attemptPost(body: string, attempt: number): Promise<void> {
    try {
      const res = await fetch(this.config.webhook, {
        method: "POST",
        headers: this.headers,
        body,
      });
      if (res.ok) return;
      // Don't retry client errors (4xx)
      if (res.status < 500) {
        console.warn(`[events] POST failed: ${res.status} ${res.statusText} (not retrying)`);
        return;
      }
      // Retry server errors (5xx)
      if (attempt < this.maxAttempts) {
        const backoff = this.baseBackoffMs * Math.pow(2, attempt - 1);
        await sleep(backoff);
        return this.attemptPost(body, attempt + 1);
      }
      console.warn(`[events] POST failed after ${this.maxAttempts} attempts: ${res.status} ${res.statusText}`);
    } catch (err) {
      if (attempt < this.maxAttempts) {
        const backoff = this.baseBackoffMs * Math.pow(2, attempt - 1);
        await sleep(backoff);
        return this.attemptPost(body, attempt + 1);
      }
      throw err;
    }
  }
}
