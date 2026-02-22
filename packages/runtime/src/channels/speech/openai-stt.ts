// OpenAI Whisper STT adapter -- speech-to-text via OpenAI Transcriptions API
// Uses native fetch, no SDK dependency

import type { SttAdapter, SttResult } from "@kilnai/core";
import { KilnError } from "@kilnai/core";

export interface OpenAiSttConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly language?: string;
}

export class OpenAiSttAdapter implements SttAdapter {
  readonly name = "openai-stt";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly language: string | undefined;

  constructor(config: OpenAiSttConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "whisper-1";
    this.language = config.language;
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<SttResult> {
    const ext = mimeTypeToExtension(mimeType);
    const blob = new Blob([audio.slice().buffer as ArrayBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", this.model);
    if (this.language) {
      formData.append("language", this.language);
    }
    formData.append("response_format", "verbose_json");

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new KilnError("STT_FAILED", `OpenAI STT API error ${response.status}: ${text}`, {
        context: { provider: "openai", model: this.model, status: response.status },
      });
    }

    const data = await response.json() as {
      text: string;
      duration?: number;
    };

    return {
      text: data.text,
      durationMs: data.duration ? Math.round(data.duration * 1000) : undefined,
    };
  }
}

function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType) {
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/mp3":
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
    case "audio/m4a":
      return "m4a";
    case "audio/ogg":
      return "ogg";
    case "audio/webm":
      return "webm";
    case "audio/flac":
      return "flac";
    default:
      return "wav";
  }
}
