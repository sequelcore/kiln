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
  readonly language?: string;
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
  readonly defaults?: VoiceDefaultsConfig;
  readonly ttsProfiles?: Readonly<Record<string, VoiceTtsProfileConfig>>;
  readonly policy?: VoicePolicyConfig;
}

export interface VoiceDefaultsConfig {
  readonly ttsProfile?: string;
}

export interface VoiceTtsProfileConfig {
  readonly style: string;
  readonly voice?: string;
  readonly language?: string;
  readonly speed?: number;
  readonly speedRange?: readonly [number, number];
  readonly format?: string;
  readonly intents?: Partial<Record<VoiceTtsIntentId, VoiceTtsIntentConfig>>;
}

export interface VoiceTtsIntentConfig {
  readonly delivery: string;
  readonly appliesWhen: readonly string[];
  readonly voice?: string;
  readonly language?: string;
  readonly speed?: number;
  readonly format?: string;
}

export const VALID_STT_PROVIDERS = ["openai", "deepgram", "whisper-local"] as const;

export type SttProviderId = (typeof VALID_STT_PROVIDERS)[number];

export const VALID_TTS_PROVIDERS = ["openai", "elevenlabs", "kokoro-local"] as const;

export type TtsProviderId = (typeof VALID_TTS_PROVIDERS)[number];

export const VALID_VOICE_TTS_INTENTS = ["neutral", "calm", "brief", "careful"] as const;

export type VoiceTtsIntentId = (typeof VALID_VOICE_TTS_INTENTS)[number];

export const VALID_VOICE_SURFACES = [
  "api",
  "web",
  "whatsapp",
  "messenger",
  "instagram",
  "gui",
  "tui",
  "cli",
  "sdk",
  "widget",
  "recorder",
] as const;

export type VoiceSurface = (typeof VALID_VOICE_SURFACES)[number];

export const VALID_VOICE_INPUT_MODES = ["audio-part", "microphone", "file"] as const;

export type VoiceInputMode = (typeof VALID_VOICE_INPUT_MODES)[number];

export const VALID_VOICE_OUTPUT_MODES = ["audio-response", "transcript-only", "artifact-only", "audio-on-demand"] as const;

export type VoiceOutputMode = (typeof VALID_VOICE_OUTPUT_MODES)[number];

export const VALID_VOICE_FAILURE_MODES = ["fail-open", "fail-closed"] as const;

export type VoiceFailureMode = (typeof VALID_VOICE_FAILURE_MODES)[number];

export interface VoicePolicyConfig {
  readonly defaultInputFailureMode?: VoiceFailureMode;
  readonly defaultOutputFailureMode?: VoiceFailureMode;
  readonly artifacts?: VoiceArtifactPolicy;
  readonly surfaces?: Partial<Record<VoiceSurface, VoiceSurfacePolicy>>;
}

export interface VoiceArtifactPolicy {
  readonly storeSourceAudio?: boolean;
  readonly storeTranscripts?: boolean;
  readonly storeSynthesizedAudio?: boolean;
  readonly retentionMaxArtifacts?: number;
}

export interface VoiceSurfacePolicy {
  readonly enabled?: boolean;
  readonly input?: VoiceInputPolicy;
  readonly output?: VoiceOutputPolicy;
}

export interface VoiceInputPolicy {
  readonly modes?: readonly VoiceInputMode[];
  readonly failureMode?: VoiceFailureMode;
}

export interface VoiceOutputPolicy {
  readonly modes?: readonly VoiceOutputMode[];
  readonly failureMode?: VoiceFailureMode;
}

/** STT provider configuration from YAML */
export interface SttProviderConfig {
  readonly provider: SttProviderId;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly language?: string;
  readonly command?: string;
  readonly commandEnv?: string;
  readonly args?: readonly string[];
  readonly modelPath?: string;
  readonly modelPathEnv?: string;
  readonly device?: string;
  readonly timeoutMs?: number;
}

/** TTS provider configuration from YAML */
export interface TtsProviderConfig {
  readonly provider: TtsProviderId;
  readonly model?: string;
  readonly apiKeyEnv?: string;
  readonly voice?: string;
  readonly command?: string;
  readonly commandEnv?: string;
  readonly args?: readonly string[];
  readonly modelPath?: string;
  readonly modelPathEnv?: string;
  readonly device?: string;
  readonly timeoutMs?: number;
  readonly format?: string;
}

/** Validate a VoiceConfig. Returns validation errors. */
export function validateVoiceConfig(config: VoiceConfig): readonly { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];

  if (!config.stt) {
    errors.push({ field: "voice.stt", message: "must be defined" });
  } else {
    if (!VALID_STT_PROVIDERS.includes(config.stt.provider)) {
      errors.push({ field: "voice.stt.provider", message: `must be one of: ${VALID_STT_PROVIDERS.join(", ")}` });
    }
    validateOptionalStringArray(config.stt.args, "voice.stt.args", errors);
    validateOptionalPositiveInteger(config.stt.timeoutMs, "voice.stt.timeoutMs", errors);
  }

  if (!config.tts) {
    errors.push({ field: "voice.tts", message: "must be defined" });
  } else {
    if (!VALID_TTS_PROVIDERS.includes(config.tts.provider)) {
      errors.push({ field: "voice.tts.provider", message: `must be one of: ${VALID_TTS_PROVIDERS.join(", ")}` });
    }
    validateOptionalStringArray(config.tts.args, "voice.tts.args", errors);
    validateOptionalPositiveInteger(config.tts.timeoutMs, "voice.tts.timeoutMs", errors);
  }

  if (config.defaults) {
    validateVoiceDefaults(config.defaults, config.ttsProfiles, errors);
  }

  if (config.ttsProfiles) {
    validateVoiceTtsProfiles(config.ttsProfiles, errors);
  }

  if (config.policy) {
    errors.push(...validateVoicePolicy(config.policy));
  }

  return errors;
}

function validateVoiceDefaults(
  defaults: VoiceDefaultsConfig,
  ttsProfiles: Readonly<Record<string, VoiceTtsProfileConfig>> | undefined,
  errors: { field: string; message: string }[],
): void {
  if (defaults.ttsProfile !== undefined) {
    if (typeof defaults.ttsProfile !== "string" || defaults.ttsProfile.trim() === "") {
      errors.push({ field: "voice.defaults.ttsProfile", message: "must be a non-empty string" });
    } else if (!ttsProfiles?.[defaults.ttsProfile]) {
      errors.push({
        field: "voice.defaults.ttsProfile",
        message: `references unknown TTS profile "${defaults.ttsProfile}"`,
      });
    }
  }
}

function validateVoiceTtsProfiles(
  profiles: Readonly<Record<string, VoiceTtsProfileConfig>>,
  errors: { field: string; message: string }[],
): void {
  if (!isRecord(profiles)) {
    errors.push({ field: "voice.ttsProfiles", message: "must be an object" });
    return;
  }

  for (const [profileName, profile] of Object.entries(profiles)) {
    if (profileName.trim() === "") {
      errors.push({ field: "voice.ttsProfiles", message: "profile names must be non-empty strings" });
      continue;
    }
    if (!isRecord(profile)) {
      errors.push({ field: `voice.ttsProfiles.${profileName}`, message: "must be an object" });
      continue;
    }

    const profileConfig = profile as VoiceTtsProfileConfig;
    const basePath = `voice.ttsProfiles.${profileName}`;
    validateRequiredNonEmptyString(profileConfig.style, `${basePath}.style`, errors);
    validateOptionalNonEmptyString(profileConfig.voice, `${basePath}.voice`, errors);
    validateOptionalNonEmptyString(profileConfig.language, `${basePath}.language`, errors);
    validateOptionalNonEmptyString(profileConfig.format, `${basePath}.format`, errors);
    validateOptionalPositiveNumber(profileConfig.speed, `${basePath}.speed`, errors);

    if (profileConfig.speedRange !== undefined) {
      validateSpeedRange(profileConfig.speedRange, `${basePath}.speedRange`, errors);
      if (profileConfig.speed !== undefined) {
        validateSpeedWithinRange(profileConfig.speed, profileConfig.speedRange, `${basePath}.speed`, errors);
      }
    }

    if (profileConfig.intents !== undefined) {
      validateVoiceTtsIntents(profileConfig.intents, profileConfig.speedRange, `${basePath}.intents`, errors);
    }
  }
}

function validateVoiceTtsIntents(
  intents: Readonly<Record<string, VoiceTtsIntentConfig>>,
  speedRange: readonly [number, number] | undefined,
  path: string,
  errors: { field: string; message: string }[],
): void {
  if (!isRecord(intents)) {
    errors.push({ field: path, message: "must be an object" });
    return;
  }

  for (const [intentName, intent] of Object.entries(intents)) {
    if (intentName.trim() === "") {
      errors.push({ field: path, message: "intent names must be non-empty strings" });
      continue;
    }
    if (!VALID_VOICE_TTS_INTENTS.includes(intentName as VoiceTtsIntentId)) {
      errors.push({ field: `${path}.${intentName}`, message: `must be one of: ${VALID_VOICE_TTS_INTENTS.join(", ")}` });
      continue;
    }
    if (!isRecord(intent)) {
      errors.push({ field: `${path}.${intentName}`, message: "must be an object" });
      continue;
    }

    const intentConfig = intent as VoiceTtsIntentConfig;
    validateRequiredNonEmptyString(intentConfig.delivery, `${path}.${intentName}.delivery`, errors);
    validateRequiredNonEmptyStringArray(intentConfig.appliesWhen, `${path}.${intentName}.appliesWhen`, errors);
    validateOptionalNonEmptyString(intentConfig.voice, `${path}.${intentName}.voice`, errors);
    validateOptionalNonEmptyString(intentConfig.language, `${path}.${intentName}.language`, errors);
    validateOptionalNonEmptyString(intentConfig.format, `${path}.${intentName}.format`, errors);
    validateOptionalPositiveNumber(intentConfig.speed, `${path}.${intentName}.speed`, errors);
    if (intentConfig.speed !== undefined && speedRange !== undefined) {
      validateSpeedWithinRange(intentConfig.speed, speedRange, `${path}.${intentName}.speed`, errors);
    }
  }
}

function validateSpeedRange(
  range: readonly [number, number],
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (!Array.isArray(range) || range.length !== 2 || !Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] <= 0 || range[1] <= 0 || range[0] > range[1]) {
    errors.push({ field, message: "must be [min, max] positive numbers" });
  }
}

function validateSpeedWithinRange(
  speed: number,
  range: readonly [number, number],
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (Array.isArray(range) && range.length === 2 && Number.isFinite(range[0]) && Number.isFinite(range[1]) && (speed < range[0] || speed > range[1])) {
    errors.push({ field, message: `must be within speedRange [${range[0]}, ${range[1]}]` });
  }
}

function validateVoicePolicy(policy: VoicePolicyConfig): readonly { field: string; message: string }[] {
  const errors: { field: string; message: string }[] = [];

  validateOptionalFailureMode(policy.defaultInputFailureMode, "voice.policy.defaultInputFailureMode", errors);
  validateOptionalFailureMode(policy.defaultOutputFailureMode, "voice.policy.defaultOutputFailureMode", errors);

  if (policy.artifacts !== undefined) {
    if (!isRecord(policy.artifacts)) {
      errors.push({ field: "voice.policy.artifacts", message: "must be an object" });
    } else {
      validateArtifactPolicy(policy.artifacts, errors);
    }
  }

  if (policy.surfaces !== undefined) {
    if (!isRecord(policy.surfaces)) {
      errors.push({ field: "voice.policy.surfaces", message: "must be an object" });
      return errors;
    }

    for (const [surface, surfacePolicy] of Object.entries(policy.surfaces)) {
      if (!isValidVoiceSurface(surface)) {
        errors.push({
          field: `voice.policy.surfaces.${surface}`,
          message: `must be one of: ${VALID_VOICE_SURFACES.join(", ")}`,
        });
        continue;
      }

      if (!isRecord(surfacePolicy)) {
        errors.push({ field: `voice.policy.surfaces.${surface}`, message: "must be an object" });
        continue;
      }

      validateSurfacePolicy(surface, surfacePolicy as VoiceSurfacePolicy, errors);
    }
  }

  return errors;
}

function validateArtifactPolicy(
  artifacts: VoiceArtifactPolicy,
  errors: { field: string; message: string }[],
): void {
  const retention = artifacts.retentionMaxArtifacts;
  if (retention !== undefined && (!Number.isInteger(retention) || retention < 1)) {
    errors.push({
      field: "voice.policy.artifacts.retentionMaxArtifacts",
      message: "must be a positive integer",
    });
  }

  validateOptionalBoolean(artifacts.storeSourceAudio, "voice.policy.artifacts.storeSourceAudio", errors);
  validateOptionalBoolean(artifacts.storeTranscripts, "voice.policy.artifacts.storeTranscripts", errors);
  validateOptionalBoolean(artifacts.storeSynthesizedAudio, "voice.policy.artifacts.storeSynthesizedAudio", errors);
}

function validateSurfacePolicy(
  surface: VoiceSurface,
  policy: VoiceSurfacePolicy,
  errors: { field: string; message: string }[],
): void {
  const basePath = `voice.policy.surfaces.${surface}`;
  validateOptionalBoolean(policy.enabled, `${basePath}.enabled`, errors);

  if (policy.input !== undefined) {
    if (!isRecord(policy.input)) {
      errors.push({ field: `${basePath}.input`, message: "must be an object" });
    } else {
      const input = policy.input as VoiceInputPolicy;
      validateModes(input.modes, VALID_VOICE_INPUT_MODES, `${basePath}.input.modes`, errors);
      validateOptionalFailureMode(input.failureMode, `${basePath}.input.failureMode`, errors);
    }
  }

  if (policy.output !== undefined) {
    if (!isRecord(policy.output)) {
      errors.push({ field: `${basePath}.output`, message: "must be an object" });
    } else {
      const output = policy.output as VoiceOutputPolicy;
      validateModes(output.modes, VALID_VOICE_OUTPUT_MODES, `${basePath}.output.modes`, errors);
      validateOptionalFailureMode(output.failureMode, `${basePath}.output.failureMode`, errors);
    }
  }
}

function validateModes(
  modes: readonly string[] | undefined,
  validModes: readonly string[],
  path: string,
  errors: { field: string; message: string }[],
): void {
  if (modes === undefined) return;

  if (!Array.isArray(modes)) {
    errors.push({ field: path, message: "must be an array" });
    return;
  }

  if (modes.length === 0) {
    errors.push({ field: path, message: "must not be empty" });
    return;
  }

  for (let i = 0; i < modes.length; i++) {
    const mode = modes[i];
    if (typeof mode !== "string" || !validModes.includes(mode)) {
      errors.push({ field: `${path}[${i}]`, message: `must be one of: ${validModes.join(", ")}` });
    }
  }
}

function validateOptionalFailureMode(
  mode: string | undefined,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (mode !== undefined && !VALID_VOICE_FAILURE_MODES.includes(mode as VoiceFailureMode)) {
    errors.push({ field, message: `must be one of: ${VALID_VOICE_FAILURE_MODES.join(", ")}` });
  }
}

function validateOptionalBoolean(
  value: boolean | undefined,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (value !== undefined && typeof value !== "boolean") {
    errors.push({ field, message: "must be a boolean" });
  }
}

function validateOptionalStringArray(
  value: readonly string[] | undefined,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (value === undefined) return;

  if (!Array.isArray(value)) {
    errors.push({ field, message: "must be an array" });
    return;
  }

  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      errors.push({ field: `${field}[${i}]`, message: "must be a string" });
    }
  }
}

function validateOptionalNonEmptyString(
  value: string | undefined,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
    errors.push({ field, message: "must be a non-empty string" });
  }
}

function validateRequiredNonEmptyString(
  value: string,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (typeof value !== "string" || value.trim() === "") {
    errors.push({ field, message: "must be a non-empty string" });
  }
}

function validateRequiredNonEmptyStringArray(
  value: readonly string[],
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (!Array.isArray(value)) {
    errors.push({ field, message: "must be an array" });
    return;
  }
  if (value.length === 0) {
    errors.push({ field, message: "must not be empty" });
    return;
  }
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (typeof entry !== "string" || entry.trim() === "") {
      errors.push({ field: `${field}[${i}]`, message: "must be a non-empty string" });
    }
  }
}

function validateOptionalPositiveNumber(
  value: number | undefined,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (value !== undefined && (!Number.isFinite(value) || value <= 0)) {
    errors.push({ field, message: "must be a positive number" });
  }
}

function validateOptionalPositiveInteger(
  value: number | undefined,
  field: string,
  errors: { field: string; message: string }[],
): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    errors.push({ field, message: "must be a positive integer" });
  }
}

function isValidVoiceSurface(surface: string): surface is VoiceSurface {
  return VALID_VOICE_SURFACES.includes(surface as VoiceSurface);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
