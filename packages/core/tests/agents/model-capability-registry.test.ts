import { describe, it, expect } from "vitest";
import { ModelCapabilityRegistry } from "../../src/agents/model-capability-registry.js";
import { MODEL_CATALOG } from "../../src/agents/model-pricing.js";

describe("ModelCapabilityRegistry", () => {
  const registry = new ModelCapabilityRegistry();

  it("has capability profiles for all MODEL_CATALOG entries", () => {
    for (const entry of MODEL_CATALOG) {
      const profile = registry.getByProvider(entry.provider, entry.model);
      expect(profile, `Missing profile for ${entry.provider}/${entry.model}`).toBeDefined();
      expect(profile!.provider).toBe(entry.provider);
      expect(profile!.inputPer1M).toBe(entry.inputPer1M);
      expect(profile!.outputPer1M).toBe(entry.outputPer1M);
      expect(profile!.qualityTier).toBe(entry.qualityTier);
    }
  });

  it("get() returns correct profile for claude-sonnet-4-6", () => {
    const profile = registry.get("claude-sonnet-4-6");
    expect(profile).toBeDefined();
    expect(profile!.provider).toBe("anthropic");
    expect(profile!.supportsTools).toBe(true);
    expect(profile!.supportsStreaming).toBe(true);
    expect(profile!.supportsVision).toBe(true);
    expect(profile!.supportsAudio).toBe(false);
    expect(profile!.maxContextTokens).toBe(200_000);
    expect(profile!.qualityTier).toBe("high");
  });

  it("getByProvider() resolves direct-api profiles", () => {
    const openaiProfile = registry.getByProvider("openai", "gpt-5.4");

    expect(openaiProfile).toBeDefined();
    expect(openaiProfile!.provider).toBe("openai");
    expect(openaiProfile!.inputPer1M).toBe(2.5);
    expect(openaiProfile!.outputPer1M).toBe(15);
  });

  it("get() returns undefined for unknown model", () => {
    expect(registry.get("nonexistent-model")).toBeUndefined();
  });

  it("eligible() filters by tools support", () => {
    const eligible = registry.eligible({ hasTools: true, requiresStreaming: false });
    for (const p of eligible) {
      expect(p.supportsTools).toBe(true);
    }
    // deepseek-reasoner and ollama-local don't support tools
    expect(eligible.find((p) => p.model === "deepseek-reasoner")).toBeUndefined();
    expect(eligible.find((p) => p.model === "ollama-local")).toBeUndefined();
  });

  it("eligible() filters by streaming support", () => {
    const eligible = registry.eligible({ hasTools: false, requiresStreaming: true });
    for (const p of eligible) {
      expect(p.supportsStreaming).toBe(true);
    }
    // o3 and o3-mini don't support streaming
    expect(eligible.find((p) => p.model === "o3")).toBeUndefined();
    expect(eligible.find((p) => p.model === "o3-mini")).toBeUndefined();
  });

  it("eligible() with no requirements returns all models", () => {
    const eligible = registry.eligible({ hasTools: false, requiresStreaming: false });
    expect(eligible.length).toBe(MODEL_CATALOG.length);
  });

  it("all() returns all profiles", () => {
    const all = registry.all();
    expect(all.length).toBe(MODEL_CATALOG.length);
    // Verify it contains expected models
    const models = new Set(all.map((p) => p.model));
    expect(models.has("claude-opus-4-6")).toBe(true);
    expect(models.has("gpt-4o")).toBe(true);
    expect(models.has("deepseek-chat")).toBe(true);
    expect(models.has("ollama-local")).toBe(true);
  });

  it("returns static task suitability evidence for configured model routes", () => {
    expect(registry.taskSuitability("codex-oauth", "gpt-5.4-mini")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "mechanical-edit",
          level: "preferred",
          source: "static-profile",
        }),
        expect.objectContaining({
          task: "frontend-design",
          level: "limited",
          source: "static-profile",
        }),
      ]),
    );
    expect(registry.taskSuitability("opencode", "opencode/minimax-m2.5-free")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "architecture-review",
          level: "capable",
          source: "static-profile",
        }),
      ]),
    );
    expect(registry.taskSuitability("openrouter", "openrouter/free")).toEqual([]);
  });
});
