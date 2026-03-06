import type { SttAdapter, SttResult } from "../../engine/domain/speech-config.js";
import { KilnError } from "../../engine/errors.js";
import { withRetry } from "./retry.js";

export interface OpenAISttConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly language?: string;
}

const MIME_TO_EXT: Record<string, string> = {
  "audio/ogg": "audio.ogg",
  "audio/mpeg": "audio.mp3",
  "audio/mp3": "audio.mp3",
  "audio/wav": "audio.wav",
  "audio/webm": "audio.webm",
  "audio/mp4": "audio.mp4",
  "audio/flac": "audio.flac",
};

export class OpenAISttAdapter implements SttAdapter {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly language: string | undefined;

  constructor(config: OpenAISttConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-transcribe";
    this.language = config.language;
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<SttResult> {
    const filename = MIME_TO_EXT[mimeType] ?? "audio.bin";
    const formData = new FormData();
    formData.append("file", new Blob([audio.buffer as ArrayBuffer], { type: mimeType }), filename);
    formData.append("model", this.model);
    formData.append("response_format", "verbose_json");
    if (this.language) {
      formData.append("language", this.language);
    }

    const data = await withRetry(
      async () => {
        const response = await fetch(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: { Authorization: `Bearer ${this.apiKey}` },
            body: formData,
          },
        );

        if (!response.ok) {
          const status = response.status;
          if (status === 429 || status >= 500) {
            const err = new Error(`OpenAI STT returned ${status}`);
            (err as unknown as Record<string, number>).status = status;
            throw err;
          }
          const body = await response.text();
          throw new KilnError("STT_FAILED", `OpenAI STT error ${status}: ${body}`, {
            context: { provider: "openai", status },
            retryable: false,
          });
        }

        return response.json() as Promise<{ text: string; duration?: number }>;
      },
      {
        maxRetries: 3,
        baseDelayMs: 1000,
        isRetryable: (error: unknown) =>
          !(error instanceof KilnError) &&
          error instanceof Error &&
          "status" in error,
      },
    );

    return {
      text: data.text,
      confidence: undefined,
      durationMs: data.duration ? Math.round(data.duration * 1000) : undefined,
    };
  }
}
