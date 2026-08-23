import { describe, expect, it, vi } from "vitest";
import { textParts, type TtsAdapter, type VoiceConfig } from "@kilnai/core/engine";
import { MemoryArtifactResourceStore } from "@kilnai/core/tools";
import { synthesizeVoiceOutput, synthesizeVoiceOutputOnDemand } from "../../src/gateway/voice-output-synthesizer.js";
import { createMediaActionTestContext } from "./media-action-test-fixture.js";

const voiceConfig: VoiceConfig = {
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
        brief: {
          delivery: "Slightly quicker delivery for short confirmations.",
          appliesWhen: ["Short acknowledgements, status updates, and confirmations."],
          speed: 1.03,
        },
      },
    },
  },
  policy: {
    artifacts: { storeSynthesizedAudio: true },
    surfaces: {
      api: { output: { modes: ["audio-response"] } },
    },
  },
};

describe("synthesizeVoiceOutput", () => {
  it("does not call TTS when the active turn is already cancelled", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "kokoro-local",
      synthesize: vi.fn().mockResolvedValue({ audio: new Uint8Array([1]), mimeType: "audio/wav" }),
    };
    const abort = new AbortController();
    abort.abort();
    await synthesizeVoiceOutput(textParts("Cancelled output."), voiceConfig, ttsAdapter, {
      ...createMediaActionTestContext(),
      attemptId: "media-attempt",
      callerId: "test:voice-output",
      idempotencyKey: "cancelled-message",
      logicalSendSlot: "assistant-tts",
      abortSignal: abort.signal,
      artifactStore: new MemoryArtifactResourceStore(),
      appName: "test-app",
      tenantId: "test-tenant",
      userId: "user-1",
      channel: "api",
      sessionId: "session-1",
      model: "test-model",
    }).catch(() => undefined);
    expect(ttsAdapter.synthesize).not.toHaveBeenCalled();
  });

  it("does not synthesize automatically for audio-on-demand output policy", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "kokoro-local",
      synthesize: vi.fn().mockResolvedValue({
        audio: new Uint8Array([1, 2, 3]),
        mimeType: "audio/wav",
      }),
    };
    const onDemandConfig: VoiceConfig = {
      ...voiceConfig,
      policy: {
        ...voiceConfig.policy,
        surfaces: {
          api: { output: { modes: ["audio-on-demand", "transcript-only"] } },
        },
      },
    };

    const result = await synthesizeVoiceOutput(
      textParts("Generate this only when requested."),
      onDemandConfig,
      ttsAdapter,
      {
        ...createMediaActionTestContext(),
        attemptId: "media-attempt",
        callerId: "test:voice-output",
        idempotencyKey: "test-message",
        logicalSendSlot: "assistant-tts",
        artifactStore: new MemoryArtifactResourceStore(),
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "user-1",
        channel: "api",
        sessionId: "session-1",
        model: "test-model",
      },
    );

    expect(result.parts).toEqual(textParts("Generate this only when requested."));
    expect(ttsAdapter.synthesize).not.toHaveBeenCalled();
  });

  it("applies automatically selected profile intent options during synthesis", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "kokoro-local",
      synthesize: vi.fn().mockResolvedValue({
        audio: new Uint8Array([1, 2, 3]),
        mimeType: "audio/wav",
      }),
    };

    const result = await synthesizeVoiceOutput(
      textParts("Done."),
      voiceConfig,
      ttsAdapter,
      {
        ...createMediaActionTestContext(),
        attemptId: "media-attempt",
        callerId: "test:voice-output",
        idempotencyKey: "test-message",
        logicalSendSlot: "assistant-tts",
        artifactStore: new MemoryArtifactResourceStore(),
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "user-1",
        channel: "api",
        sessionId: "session-1",
        model: "test-model",
      },
    );

    expect(result.parts).toHaveLength(2);
    expect(ttsAdapter.synthesize).toHaveBeenCalledWith("Done.", {
      voice: "af_bella",
      language: "en-us",
      speed: 1.03,
      format: "wav",
    });
  });

  it("synthesizes audio explicitly when audio-on-demand is enabled", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "kokoro-local",
      synthesize: vi.fn().mockResolvedValue({
        audio: new Uint8Array([4, 5, 6]),
        mimeType: "audio/wav",
        durationMs: 900,
      }),
    };
    const onDemandConfig: VoiceConfig = {
      ...voiceConfig,
      policy: {
        ...voiceConfig.policy,
        surfaces: {
          api: { output: { modes: ["audio-on-demand", "transcript-only"] } },
        },
      },
    };

    const result = await synthesizeVoiceOutputOnDemand(
      textParts("Read this back."),
      onDemandConfig,
      ttsAdapter,
      {
        ...createMediaActionTestContext(),
        attemptId: "media-attempt",
        callerId: "test:voice-output-on-demand",
        idempotencyKey: "test-message",
        logicalSendSlot: "assistant-tts-on-demand",
        artifactStore: new MemoryArtifactResourceStore(),
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "user-1",
        channel: "api",
        sessionId: "session-1",
        model: "test-model",
      },
    );

    expect(result.parts).toEqual([
      { type: "text", text: "Read this back." },
      expect.objectContaining({
        type: "audio",
        mimeType: "audio/wav",
        data: "BAUG",
        durationMs: 900,
      }),
    ]);
    expect(result.voiceOutput).toMatchObject({
      provider: "kokoro-local",
      surface: "api",
      mode: "audio-on-demand",
    });
  });

  it("does not fail-open after a claimed provider returns invalid audio", async () => {
    const ttsAdapter: TtsAdapter = {
      name: "invalid-tts",
      synthesize: vi.fn().mockResolvedValue({
        audio: new Uint8Array(),
        mimeType: "application/octet-stream",
      }),
    };
    const failOpenConfig: VoiceConfig = {
      ...voiceConfig,
      policy: {
        ...voiceConfig.policy,
        surfaces: {
          api: { output: { modes: ["audio-response"], failureMode: "fail-open" } },
        },
      },
    };

    await expect(synthesizeVoiceOutput(
      textParts("Do not silently fall back."),
      failOpenConfig,
      ttsAdapter,
      {
        ...createMediaActionTestContext(),
        attemptId: "media-attempt-invalid",
        callerId: "test:voice-output-invalid",
        idempotencyKey: "test-message-invalid",
        logicalSendSlot: "assistant-tts-invalid",
        artifactStore: new MemoryArtifactResourceStore(),
        appName: "test-app",
        tenantId: "test-tenant",
        userId: "user-1",
        channel: "api",
        sessionId: "session-1",
        model: "test-model",
      },
    )).rejects.toMatchObject({
      name: "RuntimeMediaActionClaimedError",
      outcome: "unknown",
    });
    expect(ttsAdapter.synthesize).toHaveBeenCalledTimes(1);
  });
});
