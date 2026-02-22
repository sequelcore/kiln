// WhatsAppChannel: WhatsApp Business API adapter
// Uses WhatsApp Cloud API (graph.facebook.com) via native fetch -- no SDK dependency

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality } from "@kilnai/core";
import { extractText, textParts } from "@kilnai/core";
import { formatForChannel } from "./message-formatter.js";

export interface WhatsAppConfig {
  readonly phoneNumberId: string;
  readonly accessToken: string;
  readonly verifyToken: string;
}

/**
 * Channel adapter for WhatsApp Business API.
 * receive() accepts parsed webhook messages from WhatsApp Cloud API.
 * send() posts text messages via graph.facebook.com.
 * stream() sends each engine event as a summarized text message.
 * verifyWebhook() handles the one-time webhook verification handshake.
 */
export class WhatsAppChannel implements Channel {
  readonly name = "whatsapp";
  readonly defaultFormat: MessageFormat = "short";
  readonly supportedModalities: readonly Modality[] = ["text", "image", "audio", "file"];

  private readonly config: WhatsAppConfig;
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: WhatsAppConfig) {
    this.config = config;
  }

  /** Register a handler for incoming messages (from parsed webhook payloads) */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async receive(message: IncomingMessage): Promise<void> {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  async send(response: OutgoingMessage): Promise<void> {
    const url = `https://graph.facebook.com/v21.0/${this.config.phoneNumberId}/messages`;

    // Send media parts first, then text
    for (const part of response.parts) {
      if (part.type === "image" && part.url) {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: response.target,
            type: "image",
            image: { link: part.url },
          }),
        });
      } else if (part.type === "audio" && part.url) {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: response.target,
            type: "audio",
            audio: { link: part.url },
          }),
        });
      } else if (part.type === "file" && part.url) {
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.config.accessToken}`,
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: response.target,
            type: "document",
            document: { link: part.url, filename: part.filename },
          }),
        });
      }
    }

    // Send text content
    const text = extractText(response.parts);
    if (text) {
      const formatted = formatForChannel(text, response.format ?? this.defaultFormat);
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: response.target,
          type: "text",
          text: { body: formatted },
        }),
      });
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

  /**
   * Verify a WhatsApp webhook subscription request.
   * Returns the challenge string if mode is "subscribe" and token matches, else null.
   */
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === "subscribe" && token === this.config.verifyToken) {
      return challenge;
    }
    return null;
  }
}
