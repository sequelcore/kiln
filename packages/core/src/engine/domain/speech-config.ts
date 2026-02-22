// Engine primitive: Speech config -- STT/TTS interfaces for voice channel
// Zero external dependencies

/** Speech-to-text adapter interface */
export interface SttAdapter {
  readonly name: string;
  transcribe(audio: Uint8Array, mimeType: string): Promise<SttResult>;
}

/** Result from speech-to-text transcription */
export interface SttResult {
  readonly text: string;
  readonly confidence?: number;
  readonly durationMs?: number;
}

/** Text-to-speech adapter interface */
export interface TtsAdapter {
  readonly name: string;
  synthesize(text: string, options?: TtsOptions): Promise<TtsResult>;
}

/** Options for text-to-speech synthesis */
export interface TtsOptions {
  readonly voice?: string;
  readonly speed?: number;
  readonly format?: string;
}

/** Result from text-to-speech synthesis */
export interface TtsResult {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  readonly durationMs?: number;
}

/** Voice channel configuration */
export interface VoiceConfig {
  readonly stt: SttProviderConfig;
  readonly tts: TtsProviderConfig;
}

/** STT provider configuration from YAML */
export interface SttProviderConfig {
  readonly provider: "openai" | "deepgram";
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly language?: string;
}

/** TTS provider configuration from YAML */
export interface TtsProviderConfig {
  readonly provider: "openai" | "elevenlabs";
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly voice?: string;
}

/** Validate a VoiceConfig. Returns validation errors. */
export function validateVoiceConfig(config: VoiceConfig): readonly { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];

  if (!config.stt) {
    errors.push({ field: "voice.stt", message: "must be defined" });
  } else {
    const validSttProviders = ["openai", "deepgram"];
    if (!validSttProviders.includes(config.stt.provider)) {
      errors.push({ field: "voice.stt.provider", message: `must be one of: ${validSttProviders.join(", ")}` });
    }
  }

  if (!config.tts) {
    errors.push({ field: "voice.tts", message: "must be defined" });
  } else {
    const validTtsProviders = ["openai", "elevenlabs"];
    if (!validTtsProviders.includes(config.tts.provider)) {
      errors.push({ field: "voice.tts.provider", message: `must be one of: ${validTtsProviders.join(", ")}` });
    }
  }

  return errors;
}
