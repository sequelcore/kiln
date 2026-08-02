import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectProviderId } from "@kilnai/core";

type MockAdapterName =
  | "anthropic"
  | "codexOauth"
  | "deepseek"
  | "lmstudio"
  | "ollama"
  | "openai"
  | "opencode"
  | "openrouter";

const adapterMocks = vi.hoisted(
  (): Record<MockAdapterName, ReturnType<typeof vi.fn>> & {
    readonly codexPoolCreateAdapter: ReturnType<typeof vi.fn>;
    readonly codexPoolCreateExactAdapter: ReturnType<typeof vi.fn>;
    readonly codexPoolListExecutionAccounts: ReturnType<typeof vi.fn>;
    readonly directPoolCreateAdapter: ReturnType<typeof vi.fn>;
    readonly directPoolListStatus: ReturnType<typeof vi.fn>;
    readonly opencodeAuthLoad: ReturnType<typeof vi.fn>;
    readonly opencodePoolListStatus: ReturnType<typeof vi.fn>;
    readonly opencodePoolCreateAdapter: ReturnType<typeof vi.fn>;
    readonly opencodePoolCreateExactAdapter: ReturnType<typeof vi.fn>;
    readonly opencodePoolListExecutionAccounts: ReturnType<typeof vi.fn>;
  } => ({
    anthropic: vi.fn(),
    codexPoolCreateAdapter: vi.fn(),
    codexPoolCreateExactAdapter: vi.fn(),
    codexPoolListExecutionAccounts: vi.fn(),
    codexOauth: vi.fn(),
    deepseek: vi.fn(),
    directPoolCreateAdapter: vi.fn(),
    directPoolListStatus: vi.fn(),
    lmstudio: vi.fn(),
    ollama: vi.fn(),
    openai: vi.fn(),
    opencode: vi.fn(),
    opencodeAuthLoad: vi.fn(),
    opencodePoolListStatus: vi.fn(),
    opencodePoolCreateAdapter: vi.fn(),
    opencodePoolCreateExactAdapter: vi.fn(),
    opencodePoolListExecutionAccounts: vi.fn(),
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

    listExecutionAccounts() {
      return adapterMocks.codexPoolListExecutionAccounts();
    }

    createExactAdapter(config: unknown) {
      adapterMocks.codexPoolCreateExactAdapter(config);
      return { name: "exact-codex-oauth" };
    }
  },
  DirectProviderCredentialPoolService: class MockDirectProviderCredentialPoolService {
    constructor(config: unknown) {
      adapterMocks.directPoolListStatus("constructor", config);
    }

    listStatus(provider: unknown) {
      return adapterMocks.directPoolListStatus("listStatus", provider) ?? [{ id: "env" }];
    }

    createPooledAdapter(config: unknown) {
      adapterMocks.directPoolCreateAdapter(config);
      return { name: "pooled-direct" };
    }
  },
  isPooledDirectProviderId: (provider: string) =>
    ["anthropic", "openai", "deepseek", "openrouter", "ollama", "lmstudio"].includes(provider),
  OpenCodeCredentialPoolService: class MockOpenCodeCredentialPoolService {
    listStatus() {
      return adapterMocks.opencodePoolListStatus();
    }

    createPooledAdapter(config: unknown) {
      adapterMocks.opencodePoolCreateAdapter(config);
      return { name: "pooled-opencode" };
    }

    listExecutionAccounts(tier: unknown) {
      return adapterMocks.opencodePoolListExecutionAccounts(tier);
    }

    createExactAdapter(config: unknown) {
      adapterMocks.opencodePoolCreateExactAdapter(config);
      return { name: "exact-opencode" };
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

    expect(adapterMocks.directPoolCreateAdapter).toHaveBeenCalledWith({
      provider: "openai",
      defaultModel: "gpt-5.4",
      openRouterAppUrl: undefined,
      openRouterAppName: undefined,
    });
    expect(adapterMocks.directPoolListStatus).toHaveBeenCalledWith("constructor", {
      env: expect.objectContaining({ OPENAI_API_KEY: "runtime-key" }),
    });
  });

  it.each([
    ["anthropic", "ANTHROPIC_API_KEY"],
    ["deepseek", "DEEPSEEK_API_KEY"],
    ["openai", "OPENAI_API_KEY"],
  ] as const)("creates %s adapters from the provider env table", async (provider, envName) => {
    await createDirectProviderAdapter({
      provider,
      configEnv: { [envName]: `${provider}-key` },
    });

    expect(adapterMocks.directPoolCreateAdapter).toHaveBeenCalledWith({
      provider,
      defaultModel: undefined,
      openRouterAppUrl: undefined,
      openRouterAppName: undefined,
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

    expect(adapterMocks.directPoolCreateAdapter).toHaveBeenCalledWith({
      provider: "openrouter",
      defaultModel: "openrouter/model",
      openRouterAppName: "Kiln Dev",
      openRouterAppUrl: "https://kiln.local",
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

  it("materializes an explicitly bound Codex OAuth credential revision", async () => {
    const exactAccount = {
      credentialId: "subscription-secondary",
      fileIdentity: "a".repeat(64),
      revision: "b".repeat(64),
    };
    adapterMocks.codexPoolListExecutionAccounts.mockResolvedValue([{
      credentialId: "subscription-primary",
      fileIdentity: "c".repeat(64),
      revision: "d".repeat(64),
    }, exactAccount]);

    const adapter = await createDirectProviderAdapter({
      provider: "codex-oauth",
      model: "gpt-terra",
      accountBinding: {
        virtualModelId: "managed-terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
      },
    });

    expect(adapter).toEqual({
      name: "exact-codex-oauth",
      executionBinding: {
        status: "bound",
        virtualModelId: "managed-terra",
        accountId: "secondary",
        credentialRevision: "b".repeat(64),
      },
    });
    expect(adapterMocks.codexPoolCreateExactAdapter).toHaveBeenCalledWith({
      selected: exactAccount,
      defaultModel: "gpt-terra",
    });
    expect(adapterMocks.codexPoolCreateAdapter).not.toHaveBeenCalled();
  });

  it("fails closed when an explicitly bound Codex OAuth credential is not executable", async () => {
    adapterMocks.codexPoolListExecutionAccounts.mockResolvedValue([]);

    await expect(createDirectProviderAdapter({
      provider: "codex-oauth",
      model: "gpt-terra",
      accountBinding: {
        virtualModelId: "managed-terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
      },
    })).rejects.toMatchObject({
      name: "DirectProviderBindingError",
      evidence: {
        status: "rejected-pre-dispatch",
        virtualModelId: "managed-terra",
        accountId: "secondary",
      },
    });
  });

  it("rejects a changed committed Codex OAuth credential revision", async () => {
    adapterMocks.codexPoolListExecutionAccounts.mockResolvedValue([{
      credentialId: "subscription-secondary",
      fileIdentity: "a".repeat(64),
      revision: "c".repeat(64),
    }]);

    await expect(createDirectProviderAdapter({
      provider: "codex-oauth",
      model: "gpt-terra",
      accountBinding: {
        virtualModelId: "managed-terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
        credentialRevision: "b".repeat(64),
      },
    })).rejects.toMatchObject({ name: "DirectProviderBindingError" });
    expect(adapterMocks.codexPoolCreateExactAdapter).not.toHaveBeenCalled();
  });

  it("does not silently pool an exact account binding for an unsupported provider", async () => {
    await expect(createDirectProviderAdapter({
      provider: "openai",
      model: "gpt",
      accountBinding: {
        virtualModelId: "managed-gpt",
        accountId: "primary",
        credentialId: "subscription-primary",
      },
      runtimeEnv: { OPENAI_API_KEY: "key" },
    })).rejects.toThrow("does not support exact account binding");
    expect(adapterMocks.directPoolCreateAdapter).not.toHaveBeenCalled();
  });

  it("creates Ollama adapters without requiring an API key", async () => {
    await createDirectProviderAdapter({
      provider: "ollama",
      model: "llama3.2",
      runtimeEnv: { OLLAMA_BASE_URL: "http://127.0.0.1:11435" },
    });

    expect(adapterMocks.directPoolCreateAdapter).toHaveBeenCalledWith({
      provider: "ollama",
      defaultModel: "llama3.2",
      openRouterAppUrl: undefined,
      openRouterAppName: undefined,
    });
  });

  it("creates LM Studio adapters without requiring an API key", async () => {
    await createDirectProviderAdapter({
      provider: "lmstudio",
      model: "qwen/qwen3.5-9b",
      runtimeEnv: { LMSTUDIO_BASE_URL: "http://127.0.0.1:1234/v1" },
    });

    expect(adapterMocks.directPoolCreateAdapter).toHaveBeenCalledWith({
      provider: "lmstudio",
      defaultModel: "qwen/qwen3.5-9b",
      openRouterAppUrl: undefined,
      openRouterAppName: undefined,
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

  it.each([
    ["opencode-go", "go"],
    ["opencode-zen", "zen"],
  ] as const)("materializes an explicitly bound %s credential revision", async (provider, tier) => {
    const exactAccount = {
      providerId: provider,
      credentialId: "subscription-secondary",
      tier,
      fileIdentity: "a".repeat(64),
      revision: "b".repeat(64),
    };
    adapterMocks.opencodePoolListExecutionAccounts.mockResolvedValue([exactAccount]);

    const adapter = await createDirectProviderAdapter({
      provider,
      model: "chosen-model",
      accountBinding: {
        virtualModelId: `managed-${tier}`,
        accountId: "secondary",
        credentialId: "subscription-secondary",
        credentialRevision: "b".repeat(64),
      },
      runtimeEnv: { OPENCODE_API_KEY: "must-not-override-binding" },
    });

    expect(adapter).toEqual({
      name: "exact-opencode",
      executionBinding: {
        status: "bound",
        virtualModelId: `managed-${tier}`,
        accountId: "secondary",
        credentialRevision: "b".repeat(64),
      },
    });
    expect(adapterMocks.opencodePoolListExecutionAccounts).toHaveBeenCalledWith(tier);
    expect(adapterMocks.opencodePoolCreateExactAdapter).toHaveBeenCalledWith({
      selected: exactAccount,
      defaultModel: "chosen-model",
    });
    expect(adapterMocks.opencodePoolCreateAdapter).not.toHaveBeenCalled();
    expect(adapterMocks.opencode).not.toHaveBeenCalled();
  });

  it("rejects a changed committed OpenCode credential revision before adapter construction", async () => {
    adapterMocks.opencodePoolListExecutionAccounts.mockResolvedValue([{
      providerId: "opencode-go",
      credentialId: "subscription-primary",
      tier: "go",
      fileIdentity: "a".repeat(64),
      revision: "c".repeat(64),
    }]);

    await expect(createDirectProviderAdapter({
      provider: "opencode-go",
      model: "chosen-model",
      accountBinding: {
        virtualModelId: "managed-go",
        accountId: "primary",
        credentialId: "subscription-primary",
        credentialRevision: "b".repeat(64),
      },
    })).rejects.toMatchObject({
      name: "DirectProviderBindingError",
      evidence: {
        status: "rejected-pre-dispatch",
        virtualModelId: "managed-go",
        accountId: "primary",
      },
    });
    expect(adapterMocks.opencodePoolCreateExactAdapter).not.toHaveBeenCalled();
  });

  it("rejects a bound OpenCode credential unavailable in the requested tier", async () => {
    adapterMocks.opencodePoolListExecutionAccounts.mockResolvedValue([]);

    await expect(createDirectProviderAdapter({
      provider: "opencode-go",
      model: "chosen-model",
      accountBinding: {
        virtualModelId: "managed-go",
        accountId: "zen-account",
        credentialId: "zen-credential",
      },
    })).rejects.toMatchObject({ name: "DirectProviderBindingError" });
    expect(adapterMocks.opencodePoolCreateExactAdapter).not.toHaveBeenCalled();
    expect(adapterMocks.opencodePoolCreateAdapter).not.toHaveBeenCalled();
  });

  it("keeps ordinary exact-one-account aliases revision-adopting at adapter creation", async () => {
    const exactAccount = {
      providerId: "opencode-go",
      credentialId: "subscription-primary",
      tier: "go",
      fileIdentity: "a".repeat(64),
      revision: "d".repeat(64),
    };
    adapterMocks.opencodePoolListExecutionAccounts.mockResolvedValue([exactAccount]);

    const adapter = await createDirectProviderAdapter({
      provider: "opencode-go",
      model: "chosen-model",
      accountBinding: {
        virtualModelId: "direct-go",
        accountId: "primary",
        credentialId: "subscription-primary",
      },
    });

    expect(adapter).toMatchObject({
      executionBinding: { credentialRevision: "d".repeat(64) },
    });
    expect(adapterMocks.opencodePoolCreateExactAdapter).toHaveBeenCalledWith({
      selected: exactAccount,
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
    adapterMocks.directPoolListStatus.mockImplementation((method) => method === "listStatus" ? [] : undefined);
    await expect(createDirectProviderAdapter({ provider: "anthropic" }))
      .rejects.toThrow("Missing required credentials for anthropic");
  });

  it("fails fast for unsupported direct provider ids", async () => {
    await expect(
      createDirectProviderAdapter({
        provider: "unknown" as DirectProviderId,
      }),
    ).rejects.toThrow("Unsupported direct provider: unknown");
  });
});
