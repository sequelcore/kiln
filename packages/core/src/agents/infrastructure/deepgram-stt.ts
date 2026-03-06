import type { SttAdapter, SttResult } from "../../engine/domain/speech-config.js";
import { KilnError } from "../../engine/errors.js";
import { withRetry } from "./retry.js";

export interface DeepgramSttConfig {
  readonly apiKey: string;
  readonly model?: string;
  readonly language?: string;
}

interface DeepgramResponse {
  results: {
    channels: Array<{
      alternatives: Array<{
        transcript: string;
        confidence: number;
      }>;
    }>;
  };
  metadata: {
    duration: number;
  };
}

export class DeepgramSttAdapter implements SttAdapter {
  readonly name = "deepgram";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly language: string | undefined;

  constructor(config: DeepgramSttConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "nova-3";
    this.language = config.language;
  }

  async transcribe(audio: Uint8Array, mimeType: string): Promise<SttResult> {
    let url = `https://api.deepgram.com/v1/listen?model=${this.model}`;
    if (this.language) {
      url += `&language=${this.language}`;
    }

    const data = await withRetry(
      async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Token ${this.apiKey}`,
            "Content-Type": mimeType,
          },
          body: audio.buffer as ArrayBuffer,
        });

        if (!response.ok) {
          const status = response.status;
          if (status === 429 || status >= 500) {
            const err = new Error(`Deepgram STT returned ${status}`);
            (err as unknown as Record<string, number>).status = status;
            throw err;
          }
          const body = await response.text();
          throw new KilnError("STT_FAILED", `Deepgram STT error ${status}: ${body}`, {
            context: { provider: "deepgram", status },
            retryable: false,
          });
        }

        return response.json() as Promise<DeepgramResponse>;
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

    const firstAlternative = data.results.channels[0]?.alternatives[0];
    return {
      text: firstAlternative?.transcript ?? "",
      confidence: firstAlternative?.confidence,
      durationMs: Math.round(data.metadata.duration * 1000),
    };
  }
}
