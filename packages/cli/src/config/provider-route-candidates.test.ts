import { afterEach, describe, expect, it } from "vitest";
import { resolveProviderRouteCandidates } from "./provider-route-candidates.js";
import type { KilnGlobalConfig } from "./global-config.js";

describe("resolveProviderRouteCandidates", () => {
  const originalProvider = process.env.KILN_PROVIDER;
  const originalModel = process.env.KILN_MODEL;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.KILN_PROVIDER;
    } else {
      process.env.KILN_PROVIDER = originalProvider;
    }
    if (originalModel === undefined) {
      delete process.env.KILN_MODEL;
    } else {
      process.env.KILN_MODEL = originalModel;
    }
  });

  it("uses an explicit flag provider as a single authoritative route", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.4-mini" },
          { provider: "openrouter", model: "openrouter/free" },
        ],
      },
    };

    expect(resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: "openrouter",
      flagModel: "qwen/qwen3-coder:free",
    })).toEqual([
      { provider: "openrouter", model: "qwen/qwen3-coder:free" },
    ]);
  });

  it("projects ordered global provider routes with route-specific models", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.4-mini" },
          { provider: "openrouter", model: "openrouter/free" },
          { provider: "codex" },
        ],
      },
      models: {
        codex: "gpt-5.3-codex-spark",
      },
    };

    expect(resolveProviderRouteCandidates({ globalConfig })).toEqual([
      { provider: "codex-oauth", model: "gpt-5.4-mini" },
      { provider: "openrouter", model: "openrouter/free" },
      { provider: "codex", model: "gpt-5.3-codex-spark" },
    ]);
  });

  it("uses defaultWorker and fallback when ordered routes are absent", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        defaultWorker: "codex-oauth",
        fallback: "codex",
      },
      models: {
        "codex-oauth": "gpt-5.4-mini",
        codex: "gpt-5.3-codex-spark",
      },
    };

    expect(resolveProviderRouteCandidates({ globalConfig })).toEqual([
      { provider: "codex-oauth", model: "gpt-5.4-mini" },
      { provider: "codex", model: "gpt-5.3-codex-spark" },
    ]);
  });
});
