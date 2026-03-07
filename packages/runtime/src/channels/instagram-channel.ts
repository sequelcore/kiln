// InstagramChannel: Instagram DM API adapter
// Uses Instagram Graph API via shared API client

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality } from "@kilnai/core";
import { extractText, textParts } from "@kilnai/core";
import { toInstagramFormat } from "./message-formatter.js";
import { sendInstagramMessage, sendInstagramMediaMessage } from "./instagram-api.js";

export interface InstagramConfig {
  readonly pageId: string;
  readonly accessToken: string;
}

/**
 * Channel adapter for Instagram DM API.
 * receive() accepts parsed webhook messages from Instagram.
 * send() posts text/image messages via graph.facebook.com.
 * stream() sends each engine event as a summarized text message.
 */
export class InstagramChannel implements Channel {
  readonly name = "instagram";
  readonly defaultFormat: MessageFormat = "short";
  readonly supportedModalities: readonly Modality[] = ["text", "image"];

  private readonly config: InstagramConfig;
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: InstagramConfig) {
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
    const { pageId, accessToken } = this.config;
    const to = response.target;

    // Send image parts first
    for (const part of response.parts) {
      if (part.type === "image" && part.url) {
        await sendInstagramMediaMessage(pageId, accessToken, to, part.url, "image");
      }
    }

    // Send text content
    const text = extractText(response.parts);
    if (text) {
      const formatted = toInstagramFormat(text);
      await sendInstagramMessage(pageId, accessToken, to, formatted);
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
