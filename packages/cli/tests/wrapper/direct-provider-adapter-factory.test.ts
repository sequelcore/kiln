import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

type AnyMock = Mock<(...args: unknown[]) => unknown>;
import type { DirectProviderId } from "@kilnai/core/agents";
import type { DirectProviderCredentialBinding } from "../../src/wrapper/direct-provider-adapter-factory.js";

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
  (): Record<MockAdapterName, AnyMock> & {
    readonly codexPoolCreateAdapter: AnyMock;
    readonly codexPoolCreateExactAdapter: AnyMock;
    readonly codexPoolCreateAdapterFromCredential: AnyMock;
    readonly codexPoolListExecutionAccounts: AnyMock;
    readonly directPoolCreateAdapter: AnyMock;
    readonly directPoolCreateAdapterFromCredential: AnyMock;
    readonly directPoolListStatus: AnyMock;
    readonly opencodeAuthLoad: AnyMock;
    readonly opencodePoolListStatus: AnyMock;
    readonly opencodePoolCreateAdapter: AnyMock;
    readonly opencodePoolCreateExactAdapter: AnyMock;
    readonly opencodePoolCreateAdapterFromCredential: AnyMock;
    readonly opencodePoolListExecutionAccounts: AnyMock;
  } => ({
    anthropic: vi.fn(),
    codexPoolCreateAdapter: vi.fn(),
    codexPoolCreateExactAdapter: vi.fn(),
    codexPoolCreateAdapterFromCredential: vi.fn(),
    codexPoolListExecutionAccounts: vi.fn(),
    codexOauth: vi.fn(),
    deepseek: vi.fn(),
    directPoolCreateAdapter: vi.fn(),
    directPoolCreateAdapterFromCredential: vi.fn(),
    directPoolListStatus: vi.fn(),
    lmstudio: vi.fn(),
    ollama: vi.fn(),
    openai: vi.fn(),
    opencode: vi.fn(),
    opencodeAuthLoad: vi.fn(),
    opencodePoolListStatus: vi.fn(),
    opencodePoolCreateAdapter: vi.fn(),
    opencodePoolCreateExactAdapter: vi.fn(),
    opencodePoolCreateAdapterFromCredential: vi.fn(),
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
    listExecutionAccounts() {
      return adapterMocks.codexPoolListExecutionAccounts();
    }

    createExactAdapter(config: unknown) {
      adapterMocks.codexPoolCreateExactAdapter(config);
      return { name: "exact-codex-oauth" };
    }

    createAdapterFromCredential(config: unknown) {
      adapterMocks.codexPoolCreateAdapterFromCredential(config);
      return { name: "exact-codex-oauth-committed" };
    }
  },
  DirectProviderCredentialPoolService: class MockDirectProviderCredentialPoolService {
    constructor(config: unknown) {
      adapterMocks.directPoolListStatus("constructor", config);
    }

    listStatus(provider: unknown) {
      return adapterMocks.directPoolListStatus("listStatus", provider) ?? [{ id: "env" }];
    }

    createAdapterFromCredential(config: unknown) {
      adapterMocks.directPoolCreateAdapterFromCredential(config);
      return { name: "exact-direct-committed" };
    }
  },
  isPooledDirectProviderId: (provider: string) =>
    ["anthropic", "openai", "deepseek", "openrouter", "ollama", "lmstudio"].includes(provider),
  OpenCodeCredentialPoolService: class MockOpenCodeCredentialPoolService {
    listExecutionAccounts(tier: unknown) {
      return adapterMocks.opencodePoolListExecutionAccounts(tier);
    }

    createExactAdapter(config: unknown) {
      adapterMocks.opencodePoolCreateExactAdapter(config);
      return { name: "exact-opencode" };
    }

    createAdapterFromCredential(config: unknown) {
      adapterMocks.opencodePoolCreateAdapterFromCredential(config);
      return { name: "exact-opencode-committed" };
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

  it.each([
    "codex-oauth",
    "anthropic",
    "openai",
    "deepseek",
    "openrouter",
    "ollama",
    "lmstudio",
    "opencode-go",
    "opencode-zen",
  ] as const)("fails closed before dispatch when %s has no committed exact credential", async (provider) => {
    await expect(createDirectProviderAdapter({
      provider,
      model: "gpt-5.4",
      runtimeEnv: {
        OPENAI_API_KEY: "must-not-dispatch",
        OPENCODE_API_KEY: "must-not-dispatch",
      },
    })).rejects.toThrow("exact committed execution credential binding");
    expect(adapterMocks.codexPoolCreateAdapter).not.toHaveBeenCalled();
    expect(adapterMocks.directPoolCreateAdapter).not.toHaveBeenCalled();
    expect(adapterMocks.opencodePoolCreateAdapter).not.toHaveBeenCalled();
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
      credentialBinding: {
        routeId: "terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
        credentialRevision: "b".repeat(64),
      },
    });

    expect(adapter).toEqual({
      name: "exact-codex-oauth",
      executionBinding: {
        status: "bound",
        routeId: "terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
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
      credentialBinding: {
        routeId: "terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
        credentialRevision: "b".repeat(64),
      },
    })).rejects.toMatchObject({
      name: "DirectProviderBindingError",
      evidence: {
        status: "rejected-pre-dispatch",
        routeId: "terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
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
      credentialBinding: {
        routeId: "terra",
        accountId: "secondary",
        credentialId: "subscription-secondary",
        credentialRevision: "b".repeat(64),
      },
    })).rejects.toMatchObject({ name: "DirectProviderBindingError" });
    expect(adapterMocks.codexPoolCreateExactAdapter).not.toHaveBeenCalled();
  });

  it("rejects a Codex OAuth binding with no committed credential revision", async () => {
    adapterMocks.codexPoolListExecutionAccounts.mockResolvedValue([{
      credentialId: "subscription-secondary",
      fileIdentity: "a".repeat(64),
      revision: "b".repeat(64),
    }]);

    const missingRevision = {
      routeId: "terra",
      accountId: "secondary",
      credentialId: "subscription-secondary",
    } as unknown as DirectProviderCredentialBinding;
    await expect(createDirectProviderAdapter({
      provider: "codex-oauth",
      model: "gpt-terra",
      credentialBinding: missingRevision,
    })).rejects.toMatchObject({ name: "DirectProviderBindingError" });
    expect(adapterMocks.codexPoolListExecutionAccounts).not.toHaveBeenCalled();
    expect(adapterMocks.codexPoolCreateExactAdapter).not.toHaveBeenCalled();
  });

  it("does not silently pool an exact credential binding for an unsupported provider", async () => {
    await expect(createDirectProviderAdapter({
      provider: "openai",
      model: "gpt",
      credentialBinding: {
        routeId: "gpt",
        accountId: "primary",
        credentialId: "subscription-primary",
        credentialRevision: "a".repeat(64),
      },
      runtimeEnv: { OPENAI_API_KEY: "key" },
    })).rejects.toThrow("does not support exact credential binding");
    expect(adapterMocks.directPoolCreateAdapter).not.toHaveBeenCalled();
  });

  it("constructs an exact direct adapter from the committed credential material", async () => {
    const credential = {
      providerId: "openai" as const,
      credentialId: "subscription-primary",
      auth: { apiKey: "committed-key" },
    };
    const adapter = await createDirectProviderAdapter({
      provider: "openai",
      model: "gpt-5.4",
      credentialBinding: {
        routeId: "gpt",
        accountId: "primary",
        credentialId: credential.credentialId,
        credentialRevision: "a".repeat(64),
      },
      executionCredential: credential,
    });

    expect(adapter).toEqual({
      name: "exact-direct-committed",
      executionBinding: {
        status: "bound",
        routeId: "gpt",
        accountId: "primary",
        credentialId: credential.credentialId,
        credentialRevision: "a".repeat(64),
      },
    });
    expect(adapterMocks.directPoolCreateAdapterFromCredential).toHaveBeenCalledWith({
      credential,
      defaultModel: "gpt-5.4",
      openRouterAppUrl: undefined,
      openRouterAppName: undefined,
    });
    expect(adapterMocks.directPoolCreateAdapter).not.toHaveBeenCalled();
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
      credentialBinding: {
        routeId: `route-${tier}`,
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
        routeId: `route-${tier}`,
        accountId: "secondary",
        credentialId: "subscription-secondary",
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
      credentialBinding: {
        routeId: "route-go",
        accountId: "primary",
        credentialId: "subscription-primary",
        credentialRevision: "b".repeat(64),
      },
    })).rejects.toMatchObject({
      name: "DirectProviderBindingError",
      evidence: {
        status: "rejected-pre-dispatch",
        routeId: "route-go",
        accountId: "primary",
        credentialId: "subscription-primary",
      },
    });
    expect(adapterMocks.opencodePoolCreateExactAdapter).not.toHaveBeenCalled();
  });

  it("rejects a bound OpenCode credential unavailable in the requested tier", async () => {
    adapterMocks.opencodePoolListExecutionAccounts.mockResolvedValue([]);

    await expect(createDirectProviderAdapter({
      provider: "opencode-go",
      model: "chosen-model",
      credentialBinding: {
        routeId: "route-go",
        accountId: "zen-account",
        credentialId: "zen-credential",
        credentialRevision: "b".repeat(64),
      },
    })).rejects.toMatchObject({ name: "DirectProviderBindingError" });
    expect(adapterMocks.opencodePoolCreateExactAdapter).not.toHaveBeenCalled();
    expect(adapterMocks.opencodePoolCreateAdapter).not.toHaveBeenCalled();
  });

  it("rejects an OpenCode binding with no committed credential revision", async () => {
    adapterMocks.opencodePoolListExecutionAccounts.mockResolvedValue([{
      providerId: "opencode-go",
      credentialId: "subscription-primary",
      tier: "go",
      fileIdentity: "a".repeat(64),
      revision: "d".repeat(64),
    }]);

    const missingRevision = {
      routeId: "direct-go",
      accountId: "primary",
      credentialId: "subscription-primary",
    } as unknown as DirectProviderCredentialBinding;
    await expect(createDirectProviderAdapter({
      provider: "opencode-go",
      model: "chosen-model",
      credentialBinding: missingRevision,
    })).rejects.toMatchObject({ name: "DirectProviderBindingError" });
    expect(adapterMocks.opencodePoolListExecutionAccounts).not.toHaveBeenCalled();
    expect(adapterMocks.opencodePoolCreateExactAdapter).not.toHaveBeenCalled();
  });

  it("fails closed when a provider has no exact binding even if local auth is present", async () => {
    await expect(createDirectProviderAdapter({
      provider: "opencode-go",
      model: "chosen-model",
      runtimeEnv: { OPENCODE_API_KEY: "must-not-dispatch" },
    })).rejects.toThrow("exact committed execution credential binding");
  });

  it("fails fast for unsupported direct provider ids", async () => {
    await expect(
      createDirectProviderAdapter({
        provider: "unknown" as DirectProviderId,
      }),
    ).rejects.toThrow("Unsupported direct provider: unknown");
  });
});
