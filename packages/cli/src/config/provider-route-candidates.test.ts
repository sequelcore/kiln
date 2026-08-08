import { afterEach, describe, expect, it } from "vitest";
import { inferRouteTask, resolveProviderRouteCandidates } from "./provider-route-candidates.js";
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

  it("resolves an explicit virtual model to its exact provider model and account binding", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      modelGateway: {
        port: 4910,
        accounts: [
          { id: "primary", providerId: "codex-oauth", credentialId: "subscription-primary", maxConcurrency: 1, reservedAffinitySlots: 0 },
          { id: "secondary", providerId: "codex-oauth", credentialId: "subscription-secondary", maxConcurrency: 1, reservedAffinitySlots: 0 },
        ],
        replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
        principals: [],
        surfaces: {},
        virtualModels: [{
          id: "managed-terra",
          providerId: "codex-oauth",
          providerModelId: "gpt-terra",
          accountIds: ["secondary"],
          capabilities: ["text"],
          affinity: { continuity: "none" },
        }],
      },
    };

    expect(resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: "codex-oauth",
      flagModel: "managed-terra",
    })).toEqual([{
      provider: "codex-oauth",
      model: "gpt-terra",
      accountBinding: {
        virtualModelId: "managed-terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
      },
    }]);
  });

  it("fails closed when a virtual model does not identify exactly one compatible account", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      modelGateway: {
        port: 4910,
        accounts: [
          { id: "first", providerId: "codex-oauth", credentialId: "subscription-first", maxConcurrency: 1, reservedAffinitySlots: 0 },
          { id: "second", providerId: "codex-oauth", credentialId: "subscription-second", maxConcurrency: 1, reservedAffinitySlots: 0 },
        ],
        replay: { ttlMs: 1_000, maxEntries: 10, hmacKeyEnv: "REPLAY_KEY" },
        principals: [],
        surfaces: {},
        virtualModels: [{
          id: "ambiguous-terra",
          providerId: "codex-oauth",
          providerModelId: "gpt-terra",
          accountIds: ["first", "second"],
          capabilities: ["text"],
          affinity: { continuity: "none" },
        }],
      },
    };

    expect(() => resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: "codex-oauth",
      flagModel: "ambiguous-terra",
    })).toThrow("must bind exactly one account");
  });

  it("projects ordered global provider routes with route-specific models", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.4-mini" },
          { provider: "opencode-zen" },
          { provider: "opencode-zen", model: "kimi-k2.6" },
          { provider: "openrouter", model: "openrouter/free" },
          { provider: "codex" },
        ],
      },
      models: {
        "opencode-zen": "minimax-m2.7",
        codex: "gpt-5.3-codex-spark",
      },
    };

    expect(resolveProviderRouteCandidates({ globalConfig })).toEqual([
      { provider: "codex-oauth", model: "gpt-5.4-mini" },
      { provider: "opencode-zen", model: "minimax-m2.7" },
      { provider: "opencode-zen", model: "kimi-k2.6" },
      { provider: "openrouter", model: "openrouter/free" },
      { provider: "codex", model: "gpt-5.3-codex-spark" },
    ]);
  });

  it("keeps an explicit flag provider authoritative even when another route better matches the task", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.5" },
          { provider: "opencode-zen", model: "kimi-k2.6" },
        ],
      },
    };

    expect(resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: "codex-oauth",
      taskText: "Build a polished React frontend layout",
    })).toEqual([
      { provider: "codex-oauth", model: "gpt-5.5" },
    ]);
  });

  it("orders configured routes by inferred task suitability while preserving stable fallback order", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.5" },
          { provider: "opencode-zen", model: "minimax-m2.7" },
          { provider: "opencode-zen", model: "kimi-k2.6" },
        ],
      },
    };

    expect(resolveProviderRouteCandidates({
      globalConfig,
      taskText: "Create a responsive React UI with polished visual design",
    })).toEqual([
      { provider: "opencode-zen", model: "kimi-k2.6" },
      { provider: "codex-oauth", model: "gpt-5.5" },
      { provider: "opencode-zen", model: "minimax-m2.7" },
    ]);
  });

  it("uses operator task suitability overrides when ranking configured routes", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: {
        routes: [
          { provider: "codex-oauth", model: "gpt-5.5" },
          { provider: "opencode-zen", model: "minimax-m2.7" },
        ],
      },
      modelTaskSuitability: [{
        provider: "opencode-zen",
        model: "minimax-m2.7",
        task: "research",
        level: "preferred",
        reason: "Operator prefers MiniMax for broad synthesis.",
      }],
    };

    expect(resolveProviderRouteCandidates({
      globalConfig,
      taskText: "Research and compare current model rankings",
    })).toEqual([
      { provider: "opencode-zen", model: "minimax-m2.7" },
      { provider: "codex-oauth", model: "gpt-5.5" },
    ]);
  });

  it("infers route task from agent affinity before prompt keywords", () => {
    expect(inferRouteTask({
      agentTaskAffinity: ["mechanical-edit"],
      text: "Research the latest frontend benchmarks",
    })).toBe("mechanical-edit");
  });

  it("does not leak the global default model onto an explicitly overridden provider it was never configured for", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: { defaultWorker: "codex-oauth" },
      models: { default: "gpt-5.6-terra" },
    };

    // models.default is only a matched pair with resolveGlobalDefaultProvider();
    // overriding the provider away from that default must not carry it along
    // as if it were valid for the new provider. Leave model unresolved so the
    // native harness applies its own default instead of failing on a foreign
    // model id.
    expect(resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: "claude",
    })).toEqual([{ provider: "claude" }]);
  });

  it("still applies the global default model when the explicit provider matches the configured default provider", () => {
    const globalConfig: KilnGlobalConfig = {
      version: "1",
      routing: { defaultWorker: "codex-oauth" },
      models: { default: "gpt-5.6-terra" },
    };

    expect(resolveProviderRouteCandidates({
      globalConfig,
      flagProvider: "codex-oauth",
    })).toEqual([{ provider: "codex-oauth", model: "gpt-5.6-terra" }]);
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
