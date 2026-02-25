import { describe, it, expect } from "vitest";
import { MODEL_CATALOG } from "../../src/agents/model-pricing.js";

describe("MODEL_CATALOG", () => {
  it("has entries for all providers", () => {
    const providers = new Set(MODEL_CATALOG.map((m) => m.provider));
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("deepseek");
    expect(providers).toContain("ollama");
  });

  it("has 10 total entries", () => {
    expect(MODEL_CATALOG).toHaveLength(10);
  });

  it("ollama is free", () => {
    const ollama = MODEL_CATALOG.find((m) => m.provider === "ollama");
    expect(ollama).toBeDefined();
    expect(ollama!.inputPer1M).toBe(0);
    expect(ollama!.outputPer1M).toBe(0);
  });
});
