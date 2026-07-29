import {
  AnthropicAdapter,
  CodexOAuthAdapter,
  DeepSeekAdapter,
  LmStudioAdapter,
  OllamaAdapter,
  OpenAIAdapter,
  OpenCodeAdapter,
  OpenRouterAdapter,
  createAccountPolicyId,
  type DirectProviderId,
  type ModelGatewayConfig,
  type ProviderAdapter,
  type ProviderUsageSnapshot,
} from "@kilnai/core";
import { ManagedDirectProviderRuntimeAdapter } from "../agents/managed-invocation/direct-runtime-adapter.js";
import type {
  ManagedAccountExecutionBindingPort,
  ManagedAgentRuntimeAdapter,
} from "../agents/managed-invocation/index.js";
import {
  CodexOAuthCredentialPoolService,
  type CodexOAuthExecutionAccount,
} from "../agents/credential-pool/codex-oauth-credential-pool.js";
import {
  DirectProviderCredentialPoolService,
  isPooledDirectProviderId,
  type DirectProviderExecutionAccount,
  type DirectProviderExecutionCredential,
} from "../agents/credential-pool/direct-provider-credential-pool.js";
import {
  OpenCodeCredentialPoolService,
  type OpenCodeExecutionAccount,
  type OpenCodeExecutionCredential,
} from "../agents/credential-pool/opencode-credential-pool.js";
import {
  buildModelGatewayBoundCandidates,
  createModelGatewayCredentialRevisionId,
  type ModelGatewayBoundCandidate,
} from "../model-gateway/model-gateway-account-binding.js";
import type {
  ManagedAccountCandidatePort,
  ManagedAccountCandidateResolution,
} from "./managed-account-lease-authority.js";

export interface ConfiguredManagedAccountRuntimeOptions {
  readonly config: ModelGatewayConfig;
  readonly credentialRootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

type ExecutionAccount =
  | ({ readonly providerId: "codex-oauth" } & CodexOAuthExecutionAccount)
  | OpenCodeExecutionAccount
  | DirectProviderExecutionAccount;

/**
 * Projects configured account policy and materializes only the credential revision
 * already fenced by a managed account lease.
 */
export class ConfiguredManagedAccountRuntime
implements ManagedAccountCandidatePort, ManagedAccountExecutionBindingPort {
  readonly #codexPool: CodexOAuthCredentialPoolService;
  readonly #openCodePool: OpenCodeCredentialPoolService;
  readonly #directPool: DirectProviderCredentialPoolService;
  #config: ModelGatewayConfig;

  constructor(options: ConfiguredManagedAccountRuntimeOptions) {
    this.#config = options.config;
    this.#codexPool = new CodexOAuthCredentialPoolService({ rootDir: options.credentialRootDir });
    this.#openCodePool = new OpenCodeCredentialPoolService({ rootDir: options.credentialRootDir });
    this.#directPool = new DirectProviderCredentialPoolService({
      rootDir: options.credentialRootDir,
      env: options.env,
    });
  }

  updateConfig(config: ModelGatewayConfig): void {
    this.#config = config;
  }

  async resolve(input: Parameters<ManagedAccountCandidatePort["resolve"]>[0]): Promise<ManagedAccountCandidateResolution> {
    const policyId = createAccountPolicyId(input.accountPolicyId);
    const model = this.#config.virtualModels.find((candidate) => candidate.id === policyId);
    if (model === undefined) throw new Error(`Managed account policy '${policyId}' is unavailable.`);
    if (
      model.providerId !== input.providerRoute.providerId
      || model.providerModelId !== input.providerRoute.model
    ) {
      throw new Error(`Managed account policy '${policyId}' does not match the admitted provider route.`);
    }
    const executionAccounts = await this.#listExecutionAccounts(model.providerId);
    const usage = await this.#listUsage(model.providerId);
    const bound = buildModelGatewayBoundCandidates({
      virtualModel: model,
      accounts: this.#config.accounts,
      executionAccounts,
      usage,
      pressure: () => 0,
      reservedForNewWork: () => false,
    });
    return {
      route: {
        providerId: model.providerId,
        providerModelId: model.providerModelId,
        scope: `virtual:${model.id}`,
      },
      candidates: bound.map((entry) => ({
        candidate: {
          ...entry.candidate,
          pressure: usagePressure(entry),
        },
        capacityIdentity: entry.binding.accountId,
        credentialRevisionId: createModelGatewayCredentialRevisionId(entry.binding),
        usageEvidence: entry.usageEvidence,
        capacity: entry.capacity,
      })),
    };
  }

  async bind(input: Parameters<ManagedAccountExecutionBindingPort["bind"]>[0]): Promise<ManagedAgentRuntimeAdapter> {
    if (!(input.adapter instanceof ManagedDirectProviderRuntimeAdapter)) {
      throw new Error("Runtime-selected account execution requires a direct-provider adapter.");
    }
    const resolution = await this.resolve({
      accountPolicyId: input.lease.accountPolicyId,
      providerRoute: {
        providerId: input.lease.route.providerId,
        surface: "managed-account-binding",
        model: input.lease.route.providerModelId,
      },
    });
    if (resolution.route.scope !== input.lease.route.scope) {
      throw new Error("Managed account lease route scope changed before execution binding.");
    }
    const selected = resolution.candidates.find((candidate) =>
      candidate.candidate.account === input.lease.accountRef
      && candidate.credentialRevisionId === input.lease.credentialRevisionId);
    if (selected === undefined) {
      throw new Error("Managed account credential revision changed before provider dispatch.");
    }
    const execution = await this.#findExecutionAccount(
      input.lease.accountPolicyId,
      input.lease.route.providerId as DirectProviderId,
      selected.candidate.account,
    );
    return input.adapter.bindProvider(
      await this.#createSelectedAdapter(
        input.lease.route.providerId as DirectProviderId,
        input.lease.route.providerModelId,
        execution,
      ),
    );
  }

  async #findExecutionAccount(
    accountPolicyId: string,
    providerId: DirectProviderId,
    accountRef: string,
  ): Promise<ExecutionAccount> {
    const model = this.#config.virtualModels.find((candidate) =>
      candidate.id === accountPolicyId && candidate.providerId === providerId);
    if (model === undefined) throw new Error("Managed account policy is unavailable during execution binding.");
    const bound = buildModelGatewayBoundCandidates({
      virtualModel: model,
      accounts: this.#config.accounts,
      executionAccounts: await this.#listExecutionAccounts(providerId),
      usage: [],
      pressure: () => 0,
      reservedForNewWork: () => false,
    });
    const binding = bound.find((candidate) => candidate.candidate.account === accountRef)?.binding;
    if (binding === undefined) throw new Error("Managed account binding changed before provider dispatch.");
    const execution = await this.#listExecutionAccounts(providerId);
    const selected = execution.find((candidate) =>
      candidate.credentialId === binding.credentialId
      && candidate.fileIdentity === binding.execution.fileIdentity
      && candidate.revision === binding.execution.revision);
    if (selected === undefined) throw new Error("Managed account credential revision changed before provider dispatch.");
    return selected;
  }

  async #listExecutionAccounts(providerId: DirectProviderId): Promise<readonly ExecutionAccount[]> {
    if (providerId === "codex-oauth") {
      return (await this.#codexPool.listExecutionAccounts()).map((account) => ({ providerId, ...account }));
    }
    if (providerId === "opencode-go" || providerId === "opencode-zen") {
      return this.#openCodePool.listExecutionAccounts(providerId === "opencode-go" ? "go" : "zen");
    }
    if (isPooledDirectProviderId(providerId)) return this.#directPool.listExecutionAccounts(providerId);
    return [];
  }

  async #listUsage(providerId: DirectProviderId): Promise<readonly ProviderUsageSnapshot[]> {
    return providerId === "codex-oauth" ? this.#codexPool.listUsage() : [];
  }

  async #createSelectedAdapter(
    providerId: DirectProviderId,
    model: string,
    execution: ExecutionAccount,
  ): Promise<ProviderAdapter> {
    if (providerId === "codex-oauth") {
      const credential = await this.#codexPool.resolveExecutionCredential(execution as CodexOAuthExecutionAccount);
      return new CodexOAuthAdapter({
        auth: { getValidAccessToken: async () => credential.accessToken },
        defaultModel: model,
      });
    }
    if (providerId === "opencode-go" || providerId === "opencode-zen") {
      const credential = await this.#openCodePool.resolveExecutionCredential(execution as OpenCodeExecutionAccount);
      return selectedOpenCodeAdapter(credential, model);
    }
    if (!isPooledDirectProviderId(providerId)) throw new Error("Selected managed provider is unavailable.");
    const credential = await this.#directPool.resolveExecutionCredential(execution as DirectProviderExecutionAccount);
    return selectedDirectAdapter(credential, model);
  }
}

function usagePressure(candidate: ModelGatewayBoundCandidate): number {
  const usage = candidate.usageEvidence;
  if (usage.freshness !== "fresh" || usage.availability === "unknown") return 1;
  if (usage.availability === "exhausted") return Number.MAX_SAFE_INTEGER;
  return 0;
}

function selectedOpenCodeAdapter(credential: OpenCodeExecutionCredential, model: string): ProviderAdapter {
  return new OpenCodeAdapter({
    apiKey: credential.auth.api_key,
    tier: credential.tier,
    defaultModel: model,
    internalRetry: false,
  });
}

function selectedDirectAdapter(credential: DirectProviderExecutionCredential, model: string): ProviderAdapter {
  switch (credential.providerId) {
    case "anthropic":
      return new AnthropicAdapter({ apiKey: requireApiKey(credential.auth.apiKey), defaultModel: model, internalRetry: false });
    case "openai":
      return new OpenAIAdapter({ apiKey: requireApiKey(credential.auth.apiKey), defaultModel: model, internalRetry: false });
    case "deepseek":
      return new DeepSeekAdapter({ apiKey: requireApiKey(credential.auth.apiKey), defaultModel: model, internalRetry: false });
    case "openrouter":
      return new OpenRouterAdapter({ apiKey: requireApiKey(credential.auth.apiKey), defaultModel: model, internalRetry: false });
    case "ollama":
      return new OllamaAdapter({ baseUrl: credential.auth.baseUrl, defaultModel: model });
    case "lmstudio":
      return new LmStudioAdapter({
        apiKey: credential.auth.apiKey,
        baseUrl: credential.auth.baseUrl,
        defaultModel: model,
        internalRetry: false,
      });
  }
}

function requireApiKey(value: string | undefined): string {
  if (!value) throw new Error("Selected managed provider credential requires an API key.");
  return value;
}
