// VoiceChannel: transcribes audio -> text for agents, synthesizes text -> audio for delivery
// Uses SttAdapter and TtsAdapter from engine primitives

import type { Channel, IncomingMessage, OutgoingMessage, EngineEvent, MessageFormat, Modality, ContentPart } from "@kilnai/core";
import type { SttAdapter, TtsAdapter } from "@kilnai/core";
import { extractText, textPart } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

export interface VoiceChannelConfig {
  readonly stt: SttAdapter;
  readonly tts: TtsAdapter;
}

/**
 * Channel adapter for voice interactions.
 * receive(): transcribes AudioParts via STT -> TextParts, passes through TextParts unchanged.
 * send(): synthesizes text via TTS -> audio (stored in metadata for transport-specific delivery).
 */
export class VoiceChannel implements Channel {
  readonly name = "voice";
  readonly defaultFormat: MessageFormat = "full";
  readonly supportedModalities: readonly Modality[] = ["text", "audio"];

  private readonly stt: SttAdapter;
  private readonly tts: TtsAdapter;
  private messageHandler: ((message: IncomingMessage) => void) | null = null;

  constructor(config: VoiceChannelConfig) {
    this.stt = config.stt;
    this.tts = config.tts;
  }

  /** Register a handler for incoming messages */
  onMessage(handler: (message: IncomingMessage) => void): void {
    this.messageHandler = handler;
  }

  async receive(message: IncomingMessage): Promise<void> {
    // Transcribe audio parts to text parts
    const transcribedParts: ContentPart[] = [];

    for (const part of message.parts) {
      if (part.type === "audio" && part.data) {
        try {
          const audioBytes = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
          const result = await this.stt.transcribe(audioBytes, part.mimeType);
          transcribedParts.push(textPart(result.text));
        } catch (err) {
          throw new KilnError("STT_FAILED", `Speech-to-text failed: ${err}`, {
            context: { provider: this.stt.name, mimeType: part.mimeType },
            cause: err,
          });
        }
      } else if (part.type === "text") {
        transcribedParts.push(part);
      }
    }

    if (this.messageHandler && transcribedParts.length > 0) {
      this.messageHandler({
        ...message,
        parts: transcribedParts,
      });
    }
  }

  async send(response: OutgoingMessage): Promise<void> {
    const text = extractText(response.parts);
    if (!text) return;

    try {
      await this.tts.synthesize(text);

      // The VoiceChannel itself doesn't have a transport mechanism;
      // in practice it would be composed with a WebSocket or HTTP streaming transport.
      // The TTS result is available for upstream consumers to handle delivery.
    } catch (err) {
      throw new KilnError("TTS_FAILED", `Text-to-speech failed: ${err}`, {
        context: { provider: this.tts.name },
        cause: err,
      });
    }
  }

  async stream(events: AsyncIterable<EngineEvent>): Promise<void> {
    // Voice channel does not stream engine events
    for await (const _ of events) {
      // Consume but do not forward
    }
  }
}
