import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../../src/agents/model-pricing.js";

describe("MODEL_CATALOG", () => {
  it("has entries for all providers", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("openrouter");
    expect(providers).toContain("ollama");
    expect(providers).not.toContain("opencode");
    expect(providers).not.toContain("codex-oauth");
  });

  it("contains at least one entry per active provider", () => {
    expect(MODEL_CATALOG.length).toBe(21);
  });

  it("ollama is free", () => {
    const ollama = MODEL_CATALOG.find((m) => m.provider === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama!.inputPer1M).toBe(0);
    expect(ollama!.outputPer1M).toBe(0);
  });

  it("openrouter free models are zero cost", () => {
    const openrouter = MODEL_CATALOG.filter((m) => m.provider === "openrouter");
    expect(openrouter.length).toBe(4);
    for (const model of openrouter) {
      expect(model.inputPer1M).toBe(0);
      expect(model.outputPer1M).toBe(0);
      expect(model.qualityTier).toBe("medium");
    }
  });

  it("keeps codex-oauth subscription billing out of the metered pricing catalog", () => {
    const codexOauth = MODEL_CATALOG.filter((m) => m.provider === "codex-oauth");
    expect(codexOauth).toHaveLength(0);
  });
});
