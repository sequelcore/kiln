import { describe, it, expect } from "vitest";
import {
  isCanonicalModelCapability,
  ModelCapabilityRegistry,
} from "../../src/agents/model-capability-registry.js";
import { MODEL_CATALOG } from "../../src/agents/model-pricing.js";

describe("ModelCapabilityRegistry", () => {
  const registry = new ModelCapabilityRegistry();

  it("owns the canonical capability vocabulary consumed by eligibility", () => {
    expect(isCanonicalModelCapability("tools")).toBe(true);
    expect(isCanonicalModelCapability("structured-output")).toBe(true);
    expect(isCanonicalModelCapability("provider-special-secret-mode")).toBe(false);
  });

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
    const openaiProfile = registry.getByProvider("openai", "gpt-5.6");

    expect(openaiProfile).toBeDefined();
    expect(openaiProfile!.provider).toBe("openai");
    expect(openaiProfile!.inputPer1M).toBe(5);
    expect(openaiProfile!.outputPer1M).toBe(30);
  });

  it("projects multimodal capabilities only when the provider adapter can serialize them", () => {
    expect(registry.modalityCapabilities("openai", "gpt-4o")).toMatchObject({
      provider: "openai",
      model: "gpt-4o",
      supportedCapabilities: ["vision", "screenshot-review"],
      inputModalities: ["text", "image", "screenshot"],
      toolResultModalities: ["text"],
    });

    expect(registry.modalityCapabilities("codex-oauth", "gpt-5.6")).toMatchObject({
      provider: "codex-oauth",
      model: "gpt-5.6",
      supportedCapabilities: [],
      inputModalities: ["text"],
      toolResultModalities: ["text"],
    });

    expect(registry.modalityCapabilities("openrouter", "openrouter/google/gemma-3-27b-it:free")).toMatchObject({
      provider: "openrouter",
      model: "google/gemma-3-27b-it:free",
      supportedCapabilities: ["vision", "screenshot-review"],
      inputModalities: ["text", "image", "screenshot"],
    });
  });

  it("projects Anthropic document support because the adapter serializes document blocks", () => {
    expect(registry.modalityCapabilities("anthropic", "claude-sonnet-4-6")).toMatchObject({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      supportedCapabilities: ["vision", "screenshot-review", "document"],
      inputModalities: ["text", "image", "screenshot", "document"],
      toolResultModalities: ["text", "image", "screenshot", "document"],
      constraints: {
        supportsDocuments: true,
      },
    });
  });

  it("get() returns undefined for unknown model", () => {
    expect(registry.get("nonexistent-model")).toBeUndefined();
  });

  it("does not own execution eligibility alongside the canonical eligibility service", () => {
    expect("eligible" in registry).toBe(false);
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
    expect(registry.taskSuitability("codex-oauth", "gpt-5.6")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "backend-coding",
          level: "preferred",
          source: "static-profile",
        }),
        expect.objectContaining({
          task: "frontend-design",
          level: "capable",
          source: "static-profile",
        }),
        expect.objectContaining({
          task: "research",
          recommendedSkills: [],
        }),
      ]),
    );
    expect(registry.taskSuitability("opencode-zen", "kimi-k2.6")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "frontend-design",
          level: "preferred",
          source: "static-profile",
        }),
        expect.objectContaining({
          task: "backend-coding",
          level: "preferred",
          source: "static-profile",
        }),
      ]),
    );
    expect(registry.taskSuitability("opencode-zen", "minimax-m2.7")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          task: "mechanical-edit",
          level: "preferred",
          source: "static-profile",
        }),
      ]),
    );
    expect(registry.taskSuitability("codex-oauth", "gpt-5.6-luna")).toEqual(
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
