import { homedir } from "node:os";
import { join } from "node:path";
import {
  AnthropicAdapter,
  CredentialPool,
  DeepSeekAdapter,
  LmStudioAdapter,
  LMSTUDIO_BASE_URL,
  OllamaAdapter,
  OpenAIAdapter,
  OpenRouterAdapter,
  PooledProviderAdapter,
  type Credential,
  type CredentialOutcome,
  type DirectProviderId,
  type ProviderAdapter,
} from "@kilnai/core";
import { CredentialFileStore } from "./credential-file-store.js";
import { CredentialHealthStore } from "./credential-health-store.js";

export type PooledDirectProviderId = "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama" | "lmstudio";

export interface DirectProviderCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly healthStore?: CredentialHealthStore;
}

export interface DirectProviderAuth {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

export interface DirectProviderCredentialStatus {
  readonly id: string;
  readonly label: string;
  readonly providerId: PooledDirectProviderId;
  readonly source: "manual" | "env" | "imported";
  readonly priority: number;
  readonly health?: {
    readonly requestCount: number;
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export interface CreateDirectProviderPooledAdapterOptions {
  readonly provider: PooledDirectProviderId;
  readonly defaultModel?: string;
  readonly openRouterAppUrl?: string;
  readonly openRouterAppName?: string;
  readonly createAdapter?: (auth: DirectProviderAuth) => ProviderAdapter;
}

interface ProviderRuntimeConfig {
  readonly envKey?: string;
  readonly baseUrlEnvKey?: string;
  readonly defaultBaseUrl?: string;
  readonly requiresApiKey: boolean;
}

const PROVIDERS: Readonly<Record<PooledDirectProviderId, ProviderRuntimeConfig>> = {
  anthropic: {
    envKey: "ANTHROPIC_API_KEY",
    requiresApiKey: true,
  },
  openai: {
    envKey: "OPENAI_API_KEY",
    requiresApiKey: true,
  },
  deepseek: {
    envKey: "DEEPSEEK_API_KEY",
    requiresApiKey: true,
  },
  openrouter: {
    envKey: "OPENROUTER_API_KEY",
    requiresApiKey: true,
  },
  ollama: {
    baseUrlEnvKey: "OLLAMA_BASE_URL",
    defaultBaseUrl: "http://localhost:11434",
    requiresApiKey: false,
  },
  lmstudio: {
    envKey: "LMSTUDIO_API_KEY",
    baseUrlEnvKey: "LMSTUDIO_BASE_URL",
    defaultBaseUrl: LMSTUDIO_BASE_URL,
    requiresApiKey: false,
  },
};

export class DirectProviderCredentialPoolService {
  private readonly rootDir: string;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly healthStore: CredentialHealthStore;

  constructor(config: DirectProviderCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.env = config.env ?? process.env;
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
  }

  async listStatus(provider: PooledDirectProviderId): Promise<readonly DirectProviderCredentialStatus[]> {
    const credentials = await this.resolveCredentials(provider);
    const health = await this.healthStore.readProviderHealth(provider);
    return credentials.map((credential) => {
      const record = health.find((candidate) => candidate.credentialId === credential.id);
      return {
        id: credential.id,
        label: credential.label,
        providerId: provider,
        source: credential.source,
        priority: credential.priority,
        health: record
          ? {
              requestCount: record.requestCount,
              cooldownUntil: record.cooldownUntil,
              lastOutcome: record.lastOutcome,
            }
          : undefined,
      };
    });
  }

  async createPooledAdapter(options: CreateDirectProviderPooledAdapterOptions): Promise<ProviderAdapter> {
    const pool = await this.createPool(options.provider);
    return new PooledProviderAdapter<DirectProviderAuth>({
      name: options.provider,
      pool,
      createAdapter: options.createAdapter ?? ((auth) => this.createAdapter(options, auth)),
      mapError: mapDirectProviderError,
    });
  }

  async createPool(provider: PooledDirectProviderId): Promise<CredentialPool<DirectProviderAuth>> {
    const credentials = await this.resolveCredentials(provider);
    return new CredentialPool<DirectProviderAuth>(provider, {
      strategy: "fill-first",
      credentials,
      statePort: this.healthStore.createStatePort<DirectProviderAuth>(provider),
    });
  }

  private async resolveCredentials(provider: PooledDirectProviderId): Promise<readonly Credential<DirectProviderAuth>[]> {
    assertPooledProvider(provider);
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir: this.rootDir });
    const fileCredentials = await store.readProviderCredentials(provider);
    if (fileCredentials.length > 0) {
      return fileCredentials.map((file): Credential<DirectProviderAuth> => ({
        id: file.id,
        label: file.label,
        providerId: provider,
        source: file.source,
        priority: file.priority,
        tier: file.tier,
        auth: validateAuth(provider, file.auth),
        requestCount: 0,
        lastSuccess: null,
        lastExhausted: null,
        cooldownUntil: null,
        softLeaseCount: 0,
      }));
    }

    return this.resolveEnvCredential(provider);
  }

  private resolveEnvCredential(provider: PooledDirectProviderId): readonly Credential<DirectProviderAuth>[] {
    const config = PROVIDERS[provider];
    const apiKey = config.envKey ? this.env[config.envKey]?.trim() : undefined;
    const baseUrl = config.baseUrlEnvKey
      ? (this.env[config.baseUrlEnvKey]?.trim() || config.defaultBaseUrl)
      : config.defaultBaseUrl;
    if (config.requiresApiKey && !apiKey) {
      return [];
    }

    return [{
      id: "env",
      label: "Environment",
      providerId: provider,
      source: "env",
      priority: 0,
      tier: undefined,
      auth: {
        apiKey,
        baseUrl,
      },
      requestCount: 0,
      lastSuccess: null,
      lastExhausted: null,
      cooldownUntil: null,
      softLeaseCount: 0,
    }];
  }

  private createAdapter(
    options: CreateDirectProviderPooledAdapterOptions,
    auth: DirectProviderAuth,
  ): ProviderAdapter {
    switch (options.provider) {
      case "anthropic":
        return new AnthropicAdapter({
          apiKey: requireApiKey(options.provider, auth),
          defaultModel: options.defaultModel,
          internalRetry: false,
        });
      case "openai":
        return new OpenAIAdapter({
          apiKey: requireApiKey(options.provider, auth),
          defaultModel: options.defaultModel,
          internalRetry: false,
        });
      case "deepseek":
        return new DeepSeekAdapter({
          apiKey: requireApiKey(options.provider, auth),
          defaultModel: options.defaultModel,
          internalRetry: false,
        });
      case "openrouter":
        return new OpenRouterAdapter({
          apiKey: requireApiKey(options.provider, auth),
          defaultModel: options.defaultModel,
          appUrl: options.openRouterAppUrl,
          appName: options.openRouterAppName,
          internalRetry: false,
        });
      case "ollama":
        return new OllamaAdapter({
          baseUrl: auth.baseUrl,
          defaultModel: options.defaultModel,
        });
      case "lmstudio":
        return new LmStudioAdapter({
          apiKey: auth.apiKey,
          baseUrl: auth.baseUrl,
          defaultModel: options.defaultModel,
          internalRetry: false,
        });
    }
  }
}

export function isPooledDirectProviderId(provider: DirectProviderId): provider is PooledDirectProviderId {
  return provider === "anthropic"
    || provider === "openai"
    || provider === "deepseek"
    || provider === "openrouter"
    || provider === "ollama"
    || provider === "lmstudio";
}

export function mapDirectProviderError(error: unknown): CredentialOutcome {
  const status = readStatus(error);
  if (status === 429) {
    return { type: "rate-limited" };
  }
  if (status === 402) {
    return { type: "quota-exceeded" };
  }
  if (status === 401 || status === 403) {
    return { type: "auth-failed" };
  }
  if (error instanceof TypeError) {
    return { type: "connection-failed" };
  }
  return {
    type: "unknown-error",
    message: error instanceof Error ? error.message : undefined,
  };
}

function validateAuth(provider: PooledDirectProviderId, auth: DirectProviderAuth): DirectProviderAuth {
  const config = PROVIDERS[provider];
  if (typeof auth !== "object" || auth === null || Array.isArray(auth)) {
    throw new Error(`Malformed credential auth for provider '${provider}'`);
  }
  if (config.requiresApiKey && (!auth.apiKey || auth.apiKey.trim().length === 0)) {
    throw new Error(`Credential for provider '${provider}' requires apiKey`);
  }
  return {
    apiKey: auth.apiKey,
    baseUrl: auth.baseUrl ?? config.defaultBaseUrl,
  };
}

function requireApiKey(provider: PooledDirectProviderId, auth: DirectProviderAuth): string {
  const apiKey = auth.apiKey?.trim();
  if (!apiKey) {
    throw new Error(`Credential for provider '${provider}' requires apiKey`);
  }
  return apiKey;
}

function assertPooledProvider(provider: PooledDirectProviderId): void {
  if (!(provider in PROVIDERS)) {
    throw new Error(`Unsupported pooled direct provider: ${provider}`);
  }
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const status = (error as { readonly status?: unknown }).status;
  return typeof status === "number" ? status : null;
}
