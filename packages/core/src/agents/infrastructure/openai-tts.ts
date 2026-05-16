import type { TtsAdapter, TtsOptions, TtsResult } from "../../engine/domain/speech-config.js";
import { KilnError } from "../../engine/errors.js";
import { withRetry } from "./retry.js";

export interface OpenAITtsConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly voice?: string;
}

const FORMAT_TO_MIME_TYPE: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  opus: "audio/ogg",
  pcm: "audio/pcm",
  wav: "audio/wav",
};

export class OpenAITtsAdapter implements TtsAdapter {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;

  constructor(config: OpenAITtsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini-tts";
    this.voice = config.voice ?? "alloy";
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<TtsResult> {
    const format = options.format ?? "mp3";
    const payload: Record<string, unknown> = {
      model: this.model,
      input: text,
      voice: options.voice ?? this.voice,
      response_format: format,
    };
    if (options.speed !== undefined) {
      payload.speed = options.speed;
    }

    const response = await withRetry(
      async () => {
        const res = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const status = res.status;
          if (status === 429 || status >= 500) {
            const err = new Error(`OpenAI TTS returned ${status}`);
            (err as unknown as Record<string, number>).status = status;
            throw err;
          }
          const body = await res.text();
          throw new KilnError("TTS_FAILED", `OpenAI TTS error ${status}: ${body}`, {
            context: { provider: "openai", status },
            retryable: false,
          });
        }

        return res;
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
      audio: new Uint8Array(await response.arrayBuffer()),
      mimeType: response.headers.get("content-type") ?? FORMAT_TO_MIME_TYPE[format] ?? "audio/mpeg",
    };
  }
}
