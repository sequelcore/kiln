import { describe, expect, it } from "vitest";
import { textParts, type VoiceConfig } from "@kilnai/core/engine";
import { selectVoiceOutputIntent } from "../../src/gateway/voice-output-intent-selector.js";

const baseVoiceConfig: VoiceConfig = {
  stt: { provider: "whisper-local", command: "whisper-local" },
  tts: { provider: "kokoro-local", command: "kokoro-local", format: "wav" },
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
        careful: {
          delivery: "Slower and more deliberate delivery for instructions.",
          appliesWhen: ["Step-by-step guidance, safety-sensitive instructions, or dense technical explanations."],
          speed: 0.96,
        },
      },
    },
  },
  policy: {
    surfaces: {
      api: { output: { modes: ["audio-response"] } },
    },
  },
};

describe("selectVoiceOutputIntent", () => {
  it("honors an explicit admitted intent when the active profile supports it", () => {
    expect(selectVoiceOutputIntent({
      parts: textParts("Done."),
      voiceConfig: baseVoiceConfig,
      explicitIntent: "calm",
    })).toBe("calm");
  });

  it("derives calm for failure or friction language", () => {
    expect(selectVoiceOutputIntent({
      parts: textParts("I cannot complete that because the build failed. Here is the fix."),
      voiceConfig: baseVoiceConfig,
    })).toBe("calm");
  });

  it("derives brief for short acknowledgements", () => {
    expect(selectVoiceOutputIntent({
      parts: textParts("Done."),
      voiceConfig: baseVoiceConfig,
    })).toBe("brief");
  });

  it("derives careful for procedural or dense explanations", () => {
    expect(selectVoiceOutputIntent({
      parts: textParts("Step 1: open the gateway. Step 2: verify the policy. Step 3: run the focused test."),
      voiceConfig: baseVoiceConfig,
    })).toBe("careful");
  });

  it("falls back to neutral for ordinary responses", () => {
    expect(selectVoiceOutputIntent({
      parts: textParts("The gateway stores voice evidence as multimodal artifacts."),
      voiceConfig: baseVoiceConfig,
    })).toBe("neutral");
  });

  it("does not select an intent that is not configured by the profile", () => {
    const voiceConfig: VoiceConfig = {
      ...baseVoiceConfig,
      ttsProfiles: {
        "english-default": {
          ...baseVoiceConfig.ttsProfiles!["english-default"]!,
          intents: {
            neutral: baseVoiceConfig.ttsProfiles!["english-default"]!.intents!.neutral,
          },
        },
      },
    };

    expect(selectVoiceOutputIntent({
      parts: textParts("Done."),
      voiceConfig,
    })).toBe("neutral");
  });

  it("returns undefined when no active profile can govern the intent", () => {
    expect(selectVoiceOutputIntent({
      parts: textParts("Done."),
      voiceConfig: {
        stt: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
        tts: { provider: "openai", apiKeyEnv: "OPENAI_API_KEY" },
      },
    })).toBeUndefined();
  });
});
