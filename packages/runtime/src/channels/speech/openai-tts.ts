// OpenAI TTS adapter -- text-to-speech via OpenAI Audio Speech API
// Uses native fetch, no SDK dependency

import type { TtsAdapter, TtsOptions, TtsResult } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

export interface OpenAiTtsConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly voice?: string;
}

export class OpenAiTtsAdapter implements TtsAdapter {
  readonly name = "openai-tts";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly defaultVoice: string;

  constructor(config: OpenAiTtsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "tts-1";
    this.defaultVoice = config.voice ?? "alloy";
  }

  async synthesize(text: string, options?: TtsOptions): Promise<TtsResult> {
    const voice = options?.voice ?? this.defaultVoice;
    const speed = options?.speed ?? 1.0;
    const format = options?.format ?? "mp3";

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        voice,
        speed,
        response_format: format,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new KilnError("TTS_FAILED", `OpenAI TTS API error ${response.status}: ${errorText}`, {
        context: { provider: "openai", model: this.model, voice, status: response.status },
      });
    }

    const arrayBuffer = await response.arrayBuffer();
    const audio = new Uint8Array(arrayBuffer);

    const mimeType = format === "opus" ? "audio/opus"
      : format === "aac" ? "audio/aac"
      : format === "flac" ? "audio/flac"
      : format === "wav" ? "audio/wav"
      : format === "pcm" ? "audio/pcm"
      : "audio/mpeg";

    return {
      audio,
      mimeType,
    };
  }
}
