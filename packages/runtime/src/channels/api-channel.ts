// ApiChannel: wraps REST API + Server-Sent Events as a Channel adapter
// Supports polling via response queue and real-time streaming via SSE connections

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat } from "@kiln/core";
import { formatForChannel } from "./message-formatter.js";

const MAX_QUEUE_SIZE = 100;

/** Minimal SSE writer interface (compatible with Hono and Node.js writable streams) */
export interface SseWriter {
  write(data: string): void;
  close(): void;
}

interface ApiChannelConfig {
  apiKey?: string;
}

/**
 * Channel adapter for REST API consumers with SSE streaming.
 * receive() accepts incoming API messages and invokes the registered handler.
 * send() queues responses for polling and broadcasts to SSE clients.
 * stream() forwards engine events to all connected SSE clients.
 */
export class ApiChannel implements Channel {
  readonly name = "api";
  readonly defaultFormat: MessageFormat = "structured";

  private readonly config: ApiChannelConfig;
  private readonly responseQueue: OutgoingMessage[] = [];
  private readonly sseClients = new Set<SseWriter>();
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: ApiChannelConfig = {}) {
    this.config = config;
  }

  /** Register a handler for incoming API messages */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async receive(message: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  async send(response: OutgoingMessage): Promise<void> {
    // Bounded queue: discard oldest when full
    if (this.responseQueue.length >= MAX_QUEUE_SIZE) {
      this.responseQueue.shift();
    }
    this.responseQueue.push(response);

    const formatted = formatForChannel(response.content, response.format ?? this.defaultFormat);
    const payload = `data: ${JSON.stringify({
      type: "message",
      content: formatted,
      target: response.target,
      userId: response.userId,
      threadId: response.threadId,
    })}\n\n`;

    this.broadcastSse(payload);
  }

  async stream(events: AsyncIterable<EngineEvent>): Promise<void> {
    for await (const event of events) {
      const payload = `data: ${JSON.stringify({
        type: "event",
        event: event.type,
        payload: event.payload,
        timestamp: event.timestamp,
      })}\n\n`;
      this.broadcastSse(payload);
    }
  }

  /** Add an SSE client connection */
  addSseClient(writer: SseWriter): void {
    this.sseClients.add(writer);
  }

  /** Remove an SSE client connection */
  removeSseClient(writer: SseWriter): void {
    this.sseClients.delete(writer);
  }

  /** Number of connected SSE clients */
  get sseClientCount(): number {
    return this.sseClients.size;
  }

  /** Returns and clears all queued responses (for REST polling) */
  pollResponses(): OutgoingMessage[] {
    return this.responseQueue.splice(0);
  }

  /** Returns true if no apiKey configured, or if key matches */
  validateApiKey(key: string): boolean {
    if (!this.config.apiKey) {
      return true;
    }
    return key === this.config.apiKey;
  }

  private broadcastSse(payload: string): void {
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}
