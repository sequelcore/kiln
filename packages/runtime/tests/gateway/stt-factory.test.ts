import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSttAdapter } from "../../src/gateway/stt-factory.js";
import { OpenAISttAdapter, DeepgramSttAdapter } from "@kilnai/core";

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

  it("throws CONFIG_MISSING_ENV when API key not set", () => {
    expect(() => createSttAdapter({ provider: "openai", apiKeyEnv: "MISSING_KEY" }))
      .toThrow("STT provider");
  });

  it("throws CONFIG_INVALID for unknown provider", () => {
    process.env.KEY = "val";
    expect(() => createSttAdapter({ provider: "unknown" as "openai", apiKeyEnv: "KEY" }))
      .toThrow("Unknown STT provider");
  });
});
