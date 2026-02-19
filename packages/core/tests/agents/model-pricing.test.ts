import { describe, it, expect } from "vitest";
import {
  MODEL_CATALOG,
  findCheapest,
} from "../../src/agents/model-pricing.js";

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

describe("findCheapest", () => {
  it("returns cheapest high-tier model", () => {
    const result = findCheapest("high");
    // gpt-4o: 2.50 + 10 = 12.50 is cheapest high-tier
    expect(result.qualityTier).toBe("high");
    expect(result.model).toBe("gpt-4o");
  });

  it("returns cheapest medium-tier model (medium or above)", () => {
    const result = findCheapest("medium");
    // ollama is low tier, so excluded
    // gpt-4o-mini: 0.15 + 0.60 = 0.75 is cheapest medium+
    expect(result.model).toBe("gpt-4o-mini");
  });

  it("returns Ollama for low tier (cheapest overall)", () => {
    const result = findCheapest("low");
    // ollama: 0 + 0 = 0
    expect(result.provider).toBe("ollama");
    expect(result.inputPer1M + result.outputPer1M).toBe(0);
  });

  it("throws when no models match tier", () => {
    const emptyCatalog: readonly [] = [];
    expect(() => findCheapest("high", emptyCatalog)).toThrow(
      "No models found at tier: high",
    );
  });

  it("accepts custom catalog", () => {
    const custom = [
      {
        model: "custom-model",
        provider: "custom",
        inputPer1M: 1,
        outputPer1M: 2,
        qualityTier: "high" as const,
      },
    ];
    const result = findCheapest("high", custom);
    expect(result.model).toBe("custom-model");
  });
});
