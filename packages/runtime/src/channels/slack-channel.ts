// SlackChannel: Slack Bot Events API + Web API adapter
// Uses Slack Web API (slack.com/api) via native fetch -- no SDK dependency
// Request signature verification uses shared HMAC-SHA256 utility

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality } from "@kilnai/core";
import { extractText, textParts } from "@kilnai/core";
import { formatForChannel } from "./message-formatter.js";
import { verifyHmacSha256 } from "../utils/hmac.js";

export interface SlackConfig {
  readonly botToken: string;
  readonly signingSecret: string;
}

/**
 * Channel adapter for Slack Bot Events API + Web API.
 * receive() accepts parsed event payloads from Slack Events API.
 * send() posts messages via chat.postMessage with optional thread_ts.
 * stream() posts each engine event as a message.
 * verifyRequest() validates Slack request signatures using HMAC-SHA256.
 */
export class SlackChannel implements Channel {
  readonly name = "slack";
  readonly defaultFormat: MessageFormat = "full";
  readonly supportedModalities: readonly Modality[] = ["text", "image", "file"];

  private readonly config: SlackConfig;
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: SlackConfig) {
    this.config = config;
  }

  /** Register a handler for incoming messages (from parsed Slack event payloads) */
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
    const formatted = formatForChannel(text, response.format ?? this.defaultFormat);

    const body: Record<string, unknown> = {
      channel: response.target,
      text: formatted,
    };

    if (response.threadId !== undefined) {
      body.thread_ts = response.threadId;
    }

    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.botToken}`,
      },
      body: JSON.stringify(body),
    });
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
   * Verify a Slack request signature.
   * Computes HMAC-SHA256 of "v0:{timestamp}:{body}" with the signing secret
   * and compares it to the provided signature using a timing-safe comparison.
   */
  verifyRequest(timestamp: string, body: string, signature: string): boolean {
    const payload = `v0:${timestamp}:${body}`;
    const sig = signature.startsWith("v0=") ? signature.slice(3) : signature;
    return verifyHmacSha256(this.config.signingSecret, payload, sig);
  }
}
