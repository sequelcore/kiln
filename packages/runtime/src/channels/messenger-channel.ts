// MessengerChannel: Facebook Messenger Platform adapter
// Uses Messenger Send API via shared API client

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality } from "@kilnai/core";
import { extractText, textParts } from "@kilnai/core";
import { toMessengerFormat } from "./message-formatter.js";
import { sendMessengerMessage, sendMessengerMediaMessage } from "./messenger-api.js";

export interface MessengerConfig {
  readonly accessToken: string;
}

/**
 * Channel adapter for Facebook Messenger.
 * receive() accepts parsed webhook messages from Messenger Platform.
 * send() posts text/image messages via graph.facebook.com/me/messages.
 * stream() sends each engine event as a summarized text message.
 */
export class MessengerChannel implements Channel {
  readonly name = "messenger";
  readonly defaultFormat: MessageFormat = "short";
  readonly supportedModalities: readonly Modality[] = ["text", "image"];

  private readonly config: MessengerConfig;
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: MessengerConfig) {
    this.config = config;
  }

  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async receive(message: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  async send(response: OutgoingMessage): Promise<void> {
    const { accessToken } = this.config;
    const to = response.target;

    // Send image parts first
    for (const part of response.parts) {
      if (part.type === "image" && part.url) {
        await sendMessengerMediaMessage(accessToken, to, part.url, "image");
      }
    }

    // Send text content
    const text = extractText(response.parts);
    if (text) {
      const formatted = toMessengerFormat(text);
      await sendMessengerMessage(accessToken, to, formatted);
    }
  }

  async stream(events: AsyncIterable<EngineEvent>): Promise<void> {
    for await (const event of events) {
      await this.send({
        parts: textParts(`[${event.type}] ${JSON.stringify(event.payload)}`),
        target: "stream",
        format: this.defaultFormat,
      });
    }
  }
}
