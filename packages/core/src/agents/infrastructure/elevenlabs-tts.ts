import type { TtsAdapter, TtsOptions, TtsResult } from "../../engine/domain/speech-config.js";
import { KilnError } from "../../engine/errors.js";
import { withRetry } from "./retry.js";

export interface ElevenLabsTtsConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly voice: string;
}

export class ElevenLabsTtsAdapter implements TtsAdapter {
  readonly name = "elevenlabs";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly voice: string;

  constructor(config: ElevenLabsTtsConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "eleven_multilingual_v2";
    this.voice = config.voice;
  }

  async synthesize(text: string, options: TtsOptions = {}): Promise<TtsResult> {
    const voice = options.voice ?? this.voice;
    const response = await withRetry(
      async () => {
        const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({
            text,
            model_id: this.model,
          }),
        });

        if (!res.ok) {
          const status = res.status;
          if (status === 429 || status >= 500) {
            const err = new Error(`ElevenLabs TTS returned ${status}`);
            (err as unknown as Record<string, number>).status = status;
            throw err;
          }
          const body = await res.text();
          throw new KilnError("TTS_FAILED", `ElevenLabs TTS error ${status}: ${body}`, {
            context: { provider: "elevenlabs", status },
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
      mimeType: response.headers.get("content-type") ?? "audio/mpeg",
    };
  }
}
