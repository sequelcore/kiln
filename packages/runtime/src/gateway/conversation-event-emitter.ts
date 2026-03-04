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

export class ConversationEventEmitter {
  private readonly config: EventsConfig;
  private readonly headers: Record<string, string>;

  constructor(config: EventsConfig) {
    this.config = config;
    this.headers = resolveHeaders(config);
  }

  /** Emit a single conversation event. Fire-and-forget: logs errors, never throws. */
  emit(event: ConversationEvent): void {
    const batch: ConversationEventBatch = { events: [event] };
    this.postBatch(batch);
  }

  /** Emit multiple events in a single batch. Fire-and-forget. */
  emitBatch(events: readonly ConversationEvent[]): void {
    if (events.length === 0) return;
    const batch: ConversationEventBatch = { events };
    this.postBatch(batch);
  }

  private postBatch(batch: ConversationEventBatch): void {
    fetch(this.config.webhook, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(batch),
    }).then((res) => {
      if (!res.ok) {
        console.warn(`[events] POST failed: ${res.status} ${res.statusText}`);
      }
    }).catch((err) => {
      console.warn(`[events] POST error:`, err);
    });
  }
}
