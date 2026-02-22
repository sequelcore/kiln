// WebChannel: wraps Hono WebSocket connections as a Channel adapter
// Formalizes the existing ws.ts + session-state.ts pattern as a Channel implementation

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality } from "@kilnai/core";
import { extractText } from "@kilnai/core";
import { formatForChannel } from "./message-formatter.js";

/** Minimal WebSocket interface (compatible with Hono WSContext) */
export interface WebSocketLike {
  send(data: string): void;
  readonly readyState: number;
}

/**
 * Channel adapter for WebSocket connections.
 * Manages multiple concurrent client connections.
 * receive() accepts parsed messages from WebSocket onMessage.
 * send() broadcasts formatted output to all connected clients.
 * stream() sends each event as JSON to all connected clients.
 */
export class WebChannel implements Channel {
  readonly name = "web";
  readonly defaultFormat: MessageFormat = "full";
  readonly supportedModalities: readonly Modality[] = ["text", "image", "audio", "file"];

  private readonly clients = new Set<WebSocketLike>();
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  /** Register a handler for incoming WebSocket messages */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Add a WebSocket client */
  addClient(ws: WebSocketLike): void {
    this.clients.add(ws);
  }

  /** Remove a WebSocket client */
  removeClient(ws: WebSocketLike): void {
    this.clients.delete(ws);
  }

  /** Number of connected clients */
  get clientCount(): number {
    return this.clients.size;
  }

  async receive(message: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  async send(response: OutgoingMessage): Promise<void> {
    const text = extractText(response.parts);
    const formatted = formatForChannel(text, response.format ?? this.defaultFormat);
    const payload = JSON.stringify({
      type: "output",
      text: formatted,
      parts: response.parts,
      target: response.target,
      userId: response.userId,
      threadId: response.threadId,
    });
    this.broadcast(payload);
  }

  async stream(events: AsyncIterable<EngineEvent>): Promise<void> {
    for await (const event of events) {
      const payload = JSON.stringify({
        type: "event",
        event: event.type,
        data: event.payload,
        timestamp: event.timestamp,
      });
      this.broadcast(payload);
    }
  }

  /** Broadcast a raw string payload to all connected clients */
  private broadcast(payload: string): void {
    for (const client of this.clients) {
      try {
        if (client.readyState === 1) {
          client.send(payload);
        }
      } catch {
        this.clients.delete(client);
      }
    }
  }
}
