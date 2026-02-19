// CliChannel: wraps stdin/stdout as a Channel adapter
// Formalizes the existing run.ts console output as a Channel implementation

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat } from "@kilnai/core";
import { formatForChannel } from "./message-formatter.js";

/**
 * Channel adapter for CLI stdin/stdout.
 * receive() stores the message for the orchestrator to consume.
 * send() writes formatted output to stdout/stderr.
 * stream() writes each event as a formatted line to stdout.
 */
export class CliChannel implements Channel {
  readonly name = "cli";
  readonly defaultFormat: MessageFormat = "full";

  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  /** Register a handler for incoming messages (from stdin) */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async receive(message: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  async send(response: OutgoingMessage): Promise<void> {
    const formatted = formatForChannel(response.content, response.format ?? this.defaultFormat);
    process.stdout.write(formatted + "\n");
  }

  async stream(events: AsyncIterable<EngineEvent>): Promise<void> {
    for await (const event of events) {
      const line = `[${event.type}] ${JSON.stringify(event.payload)}`;
      process.stdout.write(line + "\n");
    }
  }
}
