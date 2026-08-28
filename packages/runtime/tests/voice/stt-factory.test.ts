import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSttAdapter } from "../../src/voice/stt-factory.js";
import { DeepgramSttAdapter } from "../../src/voice/stt/deepgram-stt.js";
import { OpenAISttAdapter } from "../../src/voice/stt/openai-stt.js";
import { WhisperLocalSttAdapter } from "../../src/voice/local-voice-adapters.js";

describe("createSttAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates OpenAI adapter with resolved API key", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const adapter = createSttAdapter({ provider: "openai", apiKeyEnv: "OPENAI_API_KEY" });
    expect(adapter).toBeInstanceOf(OpenAISttAdapter);
    expect(adapter.name).toBe("openai");
  });

  it("creates Deepgram adapter with resolved API key", () => {
    process.env.DG_KEY = "dg-test";
    const adapter = createSttAdapter({ provider: "deepgram", apiKeyEnv: "DG_KEY", model: "nova-2" });
    expect(adapter).toBeInstanceOf(DeepgramSttAdapter);
    expect(adapter.name).toBe("deepgram");
  });

  it("creates Whisper local adapter from command env without API key", () => {
    process.env.KILN_WHISPER_COMMAND = process.execPath;

    const adapter = createSttAdapter({
      provider: "whisper-local",
      commandEnv: "KILN_WHISPER_COMMAND",
      args: ["-e", "process.stdout.write('{}')"],
      model: "small",
      modelPathEnv: "KILN_WHISPER_MODEL_PATH",
      device: "auto",
    });

    expect(adapter).toBeInstanceOf(WhisperLocalSttAdapter);
    expect(adapter.name).toBe("whisper-local");
  });

  it("throws CONFIG_MISSING_ENV when API key not set", () => {
    expect(() => createSttAdapter({ provider: "openai", apiKeyEnv: "MISSING_KEY" }))
      .toThrow("STT provider");
  });

  it("throws CONFIG_MISSING_ENV when local command env is not set", () => {
    expect(() => createSttAdapter({ provider: "whisper-local", commandEnv: "MISSING_WHISPER_COMMAND" }))
      .toThrow("requires local command");
  });

  it("throws CONFIG_INVALID for unknown provider", () => {
    process.env.KEY = "val";
    expect(() => createSttAdapter({ provider: "unknown" as "openai", apiKeyEnv: "KEY" }))
      .toThrow("Unknown STT provider");
  });
});
