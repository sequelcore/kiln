// WebChannel: wraps Hono WebSocket connections as a Channel adapter
// Session-scoped delivery: send() targets a session by userId, stream() is global.

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
 * Clients are tracked per sessionId for targeted delivery.
 * send()  -- delivers to the session matching response.userId, or all sessions if absent.
 * stream() -- always broadcasts to all sessions (engine events are global).
 * receive() -- delegates to the registered onMessage handler.
 */
export class WebChannel implements Channel {
  readonly name = "web";
  readonly defaultFormat: MessageFormat = "full";
  readonly supportedModalities: readonly Modality[] = ["text", "image", "audio", "file"];

  private readonly sessions = new Map<string, Set<WebSocketLike>>();
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  /** Register a handler for incoming WebSocket messages */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  /** Add a WebSocket client to the given session */
  addClient(ws: WebSocketLike, sessionId: string): void {
    let set = this.sessions.get(sessionId);
    if (!set) {
      set = new Set();
      this.sessions.set(sessionId, set);
    }
    set.add(ws);
  }

  /** Remove a WebSocket client from whichever session contains it */
  removeClient(ws: WebSocketLike): void {
    for (const [sessionId, set] of this.sessions) {
      if (set.delete(ws)) {
        if (set.size === 0) {
          this.sessions.delete(sessionId);
        }
        return;
      }
    }
  }

  /** Total number of connected clients across all sessions */
  get clientCount(): number {
    let total = 0;
    for (const set of this.sessions.values()) {
      total += set.size;
    }
    return total;
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

    if (response.userId) {
      this.sendToSession(response.userId, payload);
    } else {
      this.broadcastAll(payload);
    }
  }

  async stream(events: AsyncIterable<EngineEvent>): Promise<void> {
    for await (const event of events) {
      const payload = JSON.stringify({
        type: "event",
        event: event.type,
        data: event.payload,
        timestamp: event.timestamp,
      });
      this.broadcastAll(payload);
    }
  }

  /** Send to clients in a specific session */
  private sendToSession(sessionId: string, payload: string): void {
    const set = this.sessions.get(sessionId);
    if (!set) return;
    for (const client of set) {
      this.trySend(set, client, payload);
    }
  }

  /** Send to all clients across all sessions */
  private broadcastAll(payload: string): void {
    for (const set of this.sessions.values()) {
      for (const client of set) {
        this.trySend(set, client, payload);
      }
    }
  }

  private trySend(set: Set<WebSocketLike>, client: WebSocketLike, payload: string): void {
    try {
      if (client.readyState === 1) {
        client.send(payload);
      }
    } catch {
      set.delete(client);
    }
  }
}
