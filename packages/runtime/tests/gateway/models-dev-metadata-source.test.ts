import { describe, expect, it } from "vitest";

import { parseModelsDevCatalog } from "../../src/gateway/models-dev-metadata-source.js";

describe("parseModelsDevCatalog", () => {
  it("projects only display metadata and capabilities from the provider catalog", () => {
    const records = parseModelsDevCatalog({
      openai: {
        name: "OpenAI",
        models: {
          "gpt-5.6-terra": {
            name: "GPT-5.6 Terra",
            family: "gpt-5.6",
            release_date: "2026-07",
            status: "beta",
            tool_call: true,
            structured_output: true,
            reasoning: true,
            modalities: { input: ["text", "image", "unknown"], output: ["text"] },
            limit: { context: 1_000_000, output: 128_000 },
            cost: { input: 10, output: 50 },
          },
        },
      },
    }, "2026-08-26T16:00:00.000Z");

    const expected = {
      providerId: "openai",
      providerModelId: "gpt-5.6-terra",
      displayName: "GPT-5.6 Terra",
      family: "gpt-5.6",
      releaseDate: "2026-07",
      lifecycle: "active",
      inputModalities: ["text", "image"],
      outputModalities: ["text"],
      tools: true,
      structuredOutput: true,
      reasoning: true,
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      source: "models.dev:openai",
      observedAt: "2026-08-26T16:00:00.000Z",
    };
    expect(records).toEqual([
      { ...expected, providerId: "codex-oauth" },
      expected,
    ]);
    expect(JSON.stringify(records)).not.toContain("cost");
  });

  it("skips malformed providers and models instead of fabricating metadata", () => {
    const records = parseModelsDevCatalog({
      broken: { models: [] },
      openai: { models: { invalid: null, empty: { name: "" } } },
    }, "2026-08-26T16:00:00.000Z");

    expect(records).toEqual([]);
  });

  it("projects Anthropic display metadata to the native Claude harness identity", () => {
    const records = parseModelsDevCatalog({
      anthropic: { models: { "claude-opus-4-6": { name: "Claude Opus 4.6" } } },
    }, "2026-08-26T16:00:00.000Z");

    expect(records).toEqual([
      expect.objectContaining({ providerId: "anthropic", providerModelId: "claude-opus-4-6", source: "models.dev:anthropic" }),
      expect.objectContaining({ providerId: "claude", providerModelId: "claude-opus-4-6", source: "models.dev:anthropic" }),
    ]);
  });
});
