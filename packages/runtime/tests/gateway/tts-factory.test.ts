import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTtsAdapter } from "../../src/gateway/tts-factory.js";
import { ElevenLabsTtsAdapter, OpenAITtsAdapter } from "@kilnai/core";
import { KokoroLocalTtsAdapter } from "../../src/gateway/local-voice-adapters.js";

describe("createTtsAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("creates OpenAI adapter with resolved API key", () => {
    process.env.OPENAI_API_KEY = "sk-test";

    const adapter = createTtsAdapter({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY", voice: "alloy" });

    expect(adapter).toBeInstanceOf(OpenAITtsAdapter);
    expect(adapter.name).toBe("openai");
  });

  it("creates ElevenLabs adapter with resolved API key and configured voice", () => {
    process.env.ELEVENLABS_API_KEY = "el-test";

    const adapter = createTtsAdapter({
      provider: "elevenlabs",
      apiKeyEnv: "ELEVENLABS_API_KEY",
      voice: "voice-123",
      model: "eleven_multilingual_v2",
    });

    expect(adapter).toBeInstanceOf(ElevenLabsTtsAdapter);
    expect(adapter.name).toBe("elevenlabs");
  });

  it("creates Kokoro local adapter from command env without API key", () => {
    process.env.KILN_KOKORO_COMMAND = process.execPath;

    const adapter = createTtsAdapter({
      provider: "kokoro-local",
      commandEnv: "KILN_KOKORO_COMMAND",
      args: ["-e", "process.stdout.write('{}')"],
      model: "kokoro-v1",
      voice: "es",
      device: "auto",
      format: "wav",
    });

    expect(adapter).toBeInstanceOf(KokoroLocalTtsAdapter);
    expect(adapter.name).toBe("kokoro-local");
  });

  it("throws CONFIG_MISSING_ENV when API key is not set", () => {
    expect(() => createTtsAdapter({ provider: "openai", apiKeyEnv: "MISSING_KEY" }))
      .toThrow("TTS provider");
  });

  it("throws CONFIG_MISSING_ENV when local command env is not set", () => {
    expect(() => createTtsAdapter({ provider: "kokoro-local", commandEnv: "MISSING_KOKORO_COMMAND" }))
      .toThrow("requires local command");
  });

  it("throws CONFIG_INVALID when ElevenLabs voice is missing", () => {
    process.env.ELEVENLABS_API_KEY = "el-test";

    expect(() => createTtsAdapter({ provider: "elevenlabs", apiKeyEnv: "ELEVENLABS_API_KEY" }))
      .toThrow("requires voice");
  });

  it("throws CONFIG_INVALID for unknown provider", () => {
    process.env.KEY = "val";

    expect(() => createTtsAdapter({ provider: "unknown" as "openai", apiKeyEnv: "KEY" }))
      .toThrow("Unknown TTS provider");
  });
});
