import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectProviderId } from "@kilnai/core";

type MockAdapterName =
  | "anthropic"
  | "codexOauth"
  | "deepseek"
  | "ollama"
  | "openai"
  | "opencode"
  | "openrouter";

const adapterMocks = vi.hoisted(
  (): Record<MockAdapterName, ReturnType<typeof vi.fn>> & {
    readonly codexPoolCreateAdapter: ReturnType<typeof vi.fn>;
    readonly opencodeAuthLoad: ReturnType<typeof vi.fn>;
    readonly opencodePoolListStatus: ReturnType<typeof vi.fn>;
    readonly opencodePoolCreateAdapter: ReturnType<typeof vi.fn>;
  } => ({
    anthropic: vi.fn(),
    codexPoolCreateAdapter: vi.fn(),
    codexOauth: vi.fn(),
    deepseek: vi.fn(),
    ollama: vi.fn(),
    openai: vi.fn(),
    opencode: vi.fn(),
    opencodeAuthLoad: vi.fn(),
    opencodePoolListStatus: vi.fn(),
    opencodePoolCreateAdapter: vi.fn(),
    openrouter: vi.fn(),
  }),
);

function makeAdapter(name: MockAdapterName) {
  return class {
    constructor(config: unknown) {
      adapterMocks[name](config);
    }
  };
}

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    AnthropicAdapter: makeAdapter("anthropic"),
    CodexOAuthAdapter: makeAdapter("codexOauth"),
    DeepSeekAdapter: makeAdapter("deepseek"),
    OllamaAdapter: makeAdapter("ollama"),
    OpenAIAdapter: makeAdapter("openai"),
    OpenCodeAdapter: makeAdapter("opencode"),
    OpenRouterAdapter: makeAdapter("openrouter"),
  };
});

vi.mock("@kilnai/runtime", () => ({
  CodexOAuthCredentialPoolService: class MockCodexOAuthCredentialPoolService {
    createPooledAdapter(config: unknown) {
      adapterMocks.codexPoolCreateAdapter(config);
      return { name: "pooled-codex-oauth" };
    }
  },
  OpenCodeCredentialPoolService: class MockOpenCodeCredentialPoolService {
    listStatus() {
      return adapterMocks.opencodePoolListStatus();
    }

    createPooledAdapter(config: unknown) {
      adapterMocks.opencodePoolCreateAdapter(config);
      return { name: "pooled-opencode" };
    }
  },
}));

import { createDirectProviderAdapter } from "../../src/wrapper/direct-provider-adapter-factory.js";

describe("createDirectProviderAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const mock of Object.values(adapterMocks)) {
      mock.mockReset();
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("resolves required API keys from runtime env before config env and process env", async () => {
    process.env.OPENAI_API_KEY = "process-key";

    await createDirectProviderAdapter({
      provider: "openai",
      model: "gpt-5.4",
      configEnv: { OPENAI_API_KEY: "config-key" },
      runtimeEnv: { OPENAI_API_KEY: "runtime-key" },
    });

    expect(adapterMocks.openai).toHaveBeenCalledWith({
      apiKey: "runtime-key",
      defaultModel: "gpt-5.4",
    });
  });

  it.each([
    ["anthropic", "ANTHROPIC_API_KEY", "anthropic"],
    ["deepseek", "DEEPSEEK_API_KEY", "deepseek"],
    ["openai", "OPENAI_API_KEY", "openai"],
  ] as const)("creates %s adapters from the provider env table", async (provider, envName, adapterName) => {
    await createDirectProviderAdapter({
      provider,
      configEnv: { [envName]: `${provider}-key` },
    });

    expect(adapterMocks[adapterName]).toHaveBeenCalledWith({
      apiKey: `${provider}-key`,
      defaultModel: undefined,
    });
  });

  it("passes OpenRouter app metadata when present", async () => {
    await createDirectProviderAdapter({
      provider: "openrouter",
      model: "openrouter/model",
      runtimeEnv: {
        OPENROUTER_API_KEY: "openrouter-key",
        OPENROUTER_APP_NAME: "Kiln Dev",
        OPENROUTER_APP_URL: "https://kiln.local",
      },
    });

    expect(adapterMocks.openrouter).toHaveBeenCalledWith({
      apiKey: "openrouter-key",
      defaultModel: "openrouter/model",
      appName: "Kiln Dev",
      appUrl: "https://kiln.local",
    });
  });

  it("creates a Codex OAuth adapter from the credential pool", async () => {
    const adapter = await createDirectProviderAdapter({
      provider: "codex-oauth",
      model: "gpt-5.4",
    });

    expect(adapter).toEqual({ name: "pooled-codex-oauth" });
    expect(adapterMocks.codexPoolCreateAdapter).toHaveBeenCalledWith({
      defaultModel: "gpt-5.4",
    });
    expect(adapterMocks.codexOauth).not.toHaveBeenCalled();
  });

  it("creates Ollama adapters without requiring an API key", async () => {
    await createDirectProviderAdapter({
      provider: "ollama",
      model: "llama3.2",
      runtimeEnv: { OLLAMA_BASE_URL: "http://127.0.0.1:11435" },
    });

    expect(adapterMocks.ollama).toHaveBeenCalledWith({
      baseUrl: "http://127.0.0.1:11435",
      defaultModel: "llama3.2",
    });
  });

  it.each([
    ["opencode-go", "go"],
    ["opencode-zen", "zen"],
  ] as const)("creates %s adapters from the shared OpenCode API key", async (provider, tier) => {
    await createDirectProviderAdapter({
      provider,
      model: "chosen-model",
      runtimeEnv: { OPENCODE_API_KEY: "opencode-key" },
    });

    expect(adapterMocks.opencode).toHaveBeenCalledWith({
      apiKey: "opencode-key",
      tier,
      defaultModel: "chosen-model",
    });
  });

  it.each([
    ["opencode-go", "go"],
    ["opencode-zen", "zen"],
  ] as const)("creates %s adapters from stored OpenCode auth", async (provider, tier) => {
    adapterMocks.opencodePoolListStatus.mockResolvedValueOnce([{
      id: "stored",
      tier,
    }]);

    const adapter = await createDirectProviderAdapter({
      provider,
      model: "chosen-model",
    });

    expect(adapter).toEqual({ name: "pooled-opencode" });
    expect(adapterMocks.opencodePoolCreateAdapter).toHaveBeenCalledWith({
      tier,
      defaultModel: "chosen-model",
    });
  });

  it("rejects stored OpenCode auth when the tier does not match the requested provider", async () => {
    adapterMocks.opencodePoolListStatus.mockResolvedValueOnce([{
      id: "stored",
      tier: "zen",
    }]);

    await expect(createDirectProviderAdapter({
      provider: "opencode-go",
    })).rejects.toThrow("Missing required API key for opencode-go: OPENCODE_API_KEY");
  });

  it("throws a provider-specific error when a required API key is missing", async () => {
    await expect(
      createDirectProviderAdapter({
        provider: "anthropic",
        configEnv: { ANTHROPIC_API_KEY: "  " },
      }),
    ).rejects.toThrow("Missing required API key for anthropic: ANTHROPIC_API_KEY");
  });

  it("fails fast for unsupported direct provider ids", async () => {
    await expect(
      createDirectProviderAdapter({
        provider: "unknown" as DirectProviderId,
      }),
    ).rejects.toThrow("Unsupported direct provider: unknown");
  });
});
