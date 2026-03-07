// EmailChannel: Email adapter for AI-powered email replies
// Uses pluggable EmailTransport for outbound delivery

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality } from "@kilnai/core";
import { extractText, textParts } from "@kilnai/core";
import type { EmailTransport, OutboundEmail } from "./email-api.js";
import { renderEmailHtml, renderEmailPlainText } from "./email-template.js";

export interface EmailChannelConfig {
  readonly transport: EmailTransport;
  readonly fromAddress: string;
  readonly fromName?: string;
}

/**
 * Channel adapter for email.
 * receive() accepts parsed inbound emails (from webhook providers).
 * send() renders HTML + plain text and delivers via the configured transport.
 * stream() buffers events and sends as a single email (email is non-streaming).
 */
export class EmailChannel implements Channel {
  readonly name = "email";
  readonly defaultFormat: MessageFormat = "full";
  readonly supportedModalities: readonly Modality[] = ["text", "file"];

  private readonly config: EmailChannelConfig;
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: EmailChannelConfig) {
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
    const text = extractText(response.parts);
    if (!text) return;

    const to = response.metadata?.to as string | undefined;
    const subject = (response.metadata?.subject as string | undefined) ?? "Re: Your message";
    const inReplyTo = response.metadata?.inReplyTo as string | undefined;
    const references = response.metadata?.references as string | undefined;
    const branding = response.metadata?.branding as Record<string, string> | undefined;

    const email: OutboundEmail = {
      from: this.config.fromAddress,
      fromName: this.config.fromName,
      to: to ?? response.target,
      subject,
      htmlBody: renderEmailHtml(text, branding),
      textBody: renderEmailPlainText(text),
      inReplyTo,
      references,
    };

    await this.config.transport.send(email);
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
