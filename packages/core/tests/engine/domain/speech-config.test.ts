import { describe, it, expect } from "vitest";
import { validateVoiceConfig, type VoiceConfig } from "../../../src/engine/domain/speech-config.js";

function validVoiceConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    stt: { provider: "openai", model: "gpt-4o-transcribe", apiKeyEnv: "OPENAI_API_KEY" },
    tts: { provider: "openai", model: "gpt-4o-mini-tts", apiKeyEnv: "OPENAI_API_KEY", voice: "alloy" },
    ...overrides,
  };
}

describe("validateVoiceConfig", () => {
  it("accepts cross-surface voice policy", () => {
    const config = validVoiceConfig({
      policy: {
        defaultInputFailureMode: "fail-open",
        defaultOutputFailureMode: "fail-closed",
        artifacts: {
          storeSourceAudio: true,
          storeTranscripts: true,
          storeSynthesizedAudio: true,
          retentionMaxArtifacts: 50,
        },
        surfaces: {
          whatsapp: {
            enabled: true,
            input: { modes: ["audio-part"], failureMode: "fail-open" },
          },
          gui: {
            enabled: true,
            input: { modes: ["microphone", "file"] },
            output: { modes: ["audio-on-demand", "transcript-only"], failureMode: "fail-closed" },
          },
        },
      },
    });

    expect(validateVoiceConfig(config)).toEqual([]);
  });

  it("accepts local voice providers without API keys", () => {
    const config = validVoiceConfig({
      stt: {
        provider: "whisper-local",
        model: "small",
        commandEnv: "KILN_WHISPER_COMMAND",
        modelPathEnv: "KILN_WHISPER_MODEL_PATH",
        device: "auto",
        timeoutMs: 120_000,
      },
      tts: {
        provider: "kokoro-local",
        model: "kokoro-v1",
        voice: "es",
        commandEnv: "KILN_KOKORO_COMMAND",
        modelPathEnv: "KILN_KOKORO_MODEL_PATH",
        device: "auto",
        timeoutMs: 120_000,
        format: "wav",
      },
    });

    expect(validateVoiceConfig(config)).toEqual([]);
  });

  it("accepts governed TTS profiles with bounded runtime intents", () => {
    const config = validVoiceConfig({
      defaults: { ttsProfile: "english-default" },
      ttsProfiles: {
        "english-default": {
          style: "calm, concise technical assistant",
          voice: "af_bella",
          language: "en-us",
          speed: 1,
          speedRange: [0.95, 1.05],
          format: "wav",
          intents: {
            neutral: {
              delivery: "Use the profile's normal delivery.",
              appliesWhen: ["Default spoken response when no more specific intent applies."],
              speed: 1,
            },
            calm: {
              delivery: "Slightly slower and steadier delivery.",
              appliesWhen: ["Errors, support friction, or sensitive user messages."],
              speed: 0.97,
            },
            brief: {
              delivery: "Slightly quicker delivery for short confirmations.",
              appliesWhen: ["Short acknowledgements, status updates, and confirmations."],
              speed: 1.03,
            },
          },
        },
      },
    });

    expect(validateVoiceConfig(config)).toEqual([]);
  });

  it("rejects profile defaults and intents that are outside admitted config", () => {
    const config = validVoiceConfig({
      defaults: { ttsProfile: "missing" },
      ttsProfiles: {
        "english-default": {
          style: "",
          voice: "af_bella",
          speed: 1,
          speedRange: [0.95, 1.05],
          intents: {
            neutral: { delivery: "", appliesWhen: [], speed: 1.2 },
            ...( {
              excited: {
                delivery: "Sound very excited.",
                appliesWhen: ["Any response."],
                speed: 1,
              },
              "": {
                delivery: "No semantic intent.",
                appliesWhen: ["Malformed config."],
                speed: 1,
              },
            } as Record<string, { delivery: string; appliesWhen: string[]; speed: number }>),
          },
        },
      },
    });

    const errors = validateVoiceConfig(config);

    expect(errors).toContainEqual({
      field: "voice.defaults.ttsProfile",
      message: "references unknown TTS profile \"missing\"",
    });
    expect(errors).toContainEqual({
      field: "voice.ttsProfiles.english-default.style",
      message: "must be a non-empty string",
    });
    expect(errors).toContainEqual({
      field: "voice.ttsProfiles.english-default.intents.excited",
      message: "must be one of: neutral, calm, brief, careful",
    });
    expect(errors).toContainEqual({
      field: "voice.ttsProfiles.english-default.intents.neutral.delivery",
      message: "must be a non-empty string",
    });
    expect(errors).toContainEqual({
      field: "voice.ttsProfiles.english-default.intents.neutral.appliesWhen",
      message: "must not be empty",
    });
    expect(errors).toContainEqual({
      field: "voice.ttsProfiles.english-default.intents.neutral.speed",
      message: "must be within speedRange [0.95, 1.05]",
    });
    expect(errors).toContainEqual({
      field: "voice.ttsProfiles.english-default.intents",
      message: "intent names must be non-empty strings",
    });
  });

  it("rejects invalid policy surface keys", () => {
    const config = validVoiceConfig({
      policy: {
        surfaces: {
          dashboard: { enabled: true },
        },
      },
    } as unknown as VoiceConfig);

    const errors = validateVoiceConfig(config);

    expect(errors).toContainEqual({
      field: "voice.policy.surfaces.dashboard",
      message: "must be one of: api, web, whatsapp, messenger, instagram, gui, native, tui, cli, sdk, widget, recorder",
    });
  });

  it("rejects invalid modes and artifact retention", () => {
    const config = validVoiceConfig({
      policy: {
        artifacts: { retentionMaxArtifacts: 0 },
        surfaces: {
          gui: {
            input: { modes: ["stream"] },
            output: { modes: ["wav"] },
          },
        },
      },
    } as unknown as VoiceConfig);

    const errors = validateVoiceConfig(config);

    expect(errors).toContainEqual({
      field: "voice.policy.artifacts.retentionMaxArtifacts",
      message: "must be a positive integer",
    });
    expect(errors).toContainEqual({
      field: "voice.policy.surfaces.gui.input.modes[0]",
      message: "must be one of: audio-part, microphone, file",
    });
    expect(errors).toContainEqual({
      field: "voice.policy.surfaces.gui.output.modes[0]",
      message: "must be one of: audio-response, transcript-only, artifact-only, audio-on-demand",
    });
  });

  it("rejects invalid local voice provider timeout", () => {
    const config = validVoiceConfig({
      stt: { provider: "whisper-local", timeoutMs: 0 },
      tts: { provider: "kokoro-local", timeoutMs: -1 },
    } as unknown as VoiceConfig);

    const errors = validateVoiceConfig(config);

    expect(errors).toContainEqual({
      field: "voice.stt.timeoutMs",
      message: "must be a positive integer",
    });
    expect(errors).toContainEqual({
      field: "voice.tts.timeoutMs",
      message: "must be a positive integer",
    });
  });

  it("rejects malformed policy objects without throwing", () => {
    const config = validVoiceConfig({
      policy: {
        artifacts: null,
        surfaces: {
          gui: {
            enabled: "yes",
            input: "microphone",
            output: null,
          },
        },
      },
    } as unknown as VoiceConfig);

    expect(() => validateVoiceConfig(config)).not.toThrow();

    const errors = validateVoiceConfig(config);
    expect(errors).toContainEqual({ field: "voice.policy.artifacts", message: "must be an object" });
    expect(errors).toContainEqual({ field: "voice.policy.surfaces.gui.enabled", message: "must be a boolean" });
    expect(errors).toContainEqual({ field: "voice.policy.surfaces.gui.input", message: "must be an object" });
    expect(errors).toContainEqual({ field: "voice.policy.surfaces.gui.output", message: "must be an object" });
  });
});
