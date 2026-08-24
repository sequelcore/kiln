import { createHash, randomBytes } from "node:crypto";
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import {
  AnthropicAdapter,
  CredentialPool,
  DeepSeekAdapter,
  LmStudioAdapter,
  LMSTUDIO_BASE_URL,
  OllamaAdapter,
  OpenAIAdapter,
  OpenRouterAdapter,
  type Credential,
  type CredentialOutcome,
  type DirectProviderId,
  type ProviderAdapter,
} from "@kilnai/core";
import { CredentialFileStore } from "./credential-file-store.js";
import { CredentialHealthStore } from "./credential-health-store.js";
import type { CredentialPoolObservabilityRegistry } from "./credential-pool-observability.js";
import type { CredentialWatcher } from "./credential-watcher.js";
import { resolveRuntimeStoreRoot } from "../../kiln-home.js";

export type PooledDirectProviderId = "anthropic" | "openai" | "deepseek" | "openrouter" | "ollama" | "lmstudio";

export interface DirectProviderCredentialPoolServiceConfig {
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
  readonly rootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly healthStore?: CredentialHealthStore;
  readonly watcher?: CredentialWatcher;
  readonly observability?: CredentialPoolObservabilityRegistry;
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
    readonly lastSuccess: number | null;
    readonly lastExhausted: number | null;
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export interface DirectProviderExecutionAccount {
  readonly providerId: PooledDirectProviderId;
  readonly credentialId: string;
  readonly tier?: string;
  readonly fileIdentity: string;
  readonly revision: string;
}

export interface DirectProviderExecutionCredential {
  readonly providerId: PooledDirectProviderId;
  readonly credentialId: string;
  readonly tier?: string;
  readonly auth: DirectProviderAuth;
}

export interface CreateDirectProviderExactAdapterOptions {
  readonly credential: DirectProviderExecutionCredential;
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
  private readonly watcher?: CredentialWatcher;
  private readonly observability?: CredentialPoolObservabilityRegistry;
  private readonly envExecutionSnapshots = new Map<PooledDirectProviderId, {
    readonly identity: string;
    readonly revision: string;
    readonly auth: DirectProviderAuth;
  }>();

  constructor(config: DirectProviderCredentialPoolServiceConfig = {}) {
    this.rootDir = resolveRuntimeStoreRoot(config, "auth");
    this.env = config.env ?? process.env;
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
    this.watcher = config.watcher;
    this.observability = config.observability;
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
              lastSuccess: record.lastSuccess,
              lastExhausted: record.lastExhausted,
              cooldownUntil: record.cooldownUntil,
              lastOutcome: record.lastOutcome,
            }
          : undefined,
      };
    });
  }

  /** Secret-free enumeration for governed selection. */
  async listExecutionAccounts(provider: PooledDirectProviderId): Promise<readonly DirectProviderExecutionAccount[]> {
    assertPooledProvider(provider);
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir: this.rootDir });
    const statuses = await store.readProviderCredentialStatus(provider);
    const health = await this.healthStore.readProviderHealth(provider);
    const unhealthy = new Set(health
      .filter((entry) => entry.lastOutcome?.type === "auth-failed" || (entry.cooldownUntil ?? 0) > Date.now())
      .map((entry) => entry.credentialId));
    if (statuses.length > 0) {
      const accounts: DirectProviderExecutionAccount[] = [];
      for (const status of statuses) {
        if (unhealthy.has(status.id)) continue;
        const snapshot = credentialSnapshot(await lstat(store.credentialFilePath(provider, status.id), { bigint: true }));
        accounts.push({
          providerId: provider,
          credentialId: status.id,
          ...(status.tier === undefined ? {} : { tier: status.tier }),
          fileIdentity: snapshot.identity,
          revision: snapshot.revision,
        });
      }
      return accounts;
    }

    const envCredential = this.resolveEnvCredential(provider)[0];
    if (!envCredential || unhealthy.has(envCredential.id)) return [];
    const snapshot = this.envExecutionSnapshot(provider, envCredential.auth);
    return [{
      providerId: provider,
      credentialId: envCredential.id,
      ...(envCredential.tier === undefined ? {} : { tier: envCredential.tier }),
      fileIdentity: snapshot.identity,
      revision: snapshot.revision,
    }];
  }

  /** Resolves only the credential revision selected before an account lease was acquired. */
  async resolveExecutionCredential(selected: DirectProviderExecutionAccount): Promise<DirectProviderExecutionCredential> {
    validateDirectExecutionAccount(selected);
    const health = await this.healthStore.readProviderHealth(selected.providerId);
    if (health.some((entry) => entry.credentialId === selected.credentialId && (entry.lastOutcome?.type === "auth-failed" || (entry.cooldownUntil ?? 0) > Date.now()))) {
      throw new Error("Selected direct-provider credential is unhealthy.");
    }
    const store = new CredentialFileStore<DirectProviderAuth>({ rootDir: this.rootDir });
    if (selected.credentialId === "env" && !(await store.hasProviderCredentials(selected.providerId))) {
      const current = this.resolveEnvCredential(selected.providerId)[0];
      if (!current) throw new Error("Selected direct-provider credential is unavailable.");
      const snapshot = this.envExecutionSnapshot(selected.providerId, current.auth);
      if (snapshot.identity !== selected.fileIdentity || snapshot.revision !== selected.revision) {
        throw new Error("Selected direct-provider credential revision changed.");
      }
      return {
        providerId: selected.providerId,
        credentialId: current.id,
        ...(current.tier === undefined ? {} : { tier: current.tier }),
        auth: { ...current.auth },
      };
    }

    const path = store.credentialFilePath(selected.providerId, selected.credentialId);
    let handle: FileHandle | undefined;
    try {
      const before = credentialSnapshot(await lstat(path, { bigint: true }));
      assertSelectedSnapshot(before, selected);
      handle = await openSelectedCredential(path);
      if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), before)) throw new Error("revision");
      const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
      const credential = parseSelectedDirectCredential(parsed, selected.providerId, selected.credentialId);
      if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), before)
        || !sameSnapshot(credentialSnapshot(await lstat(path, { bigint: true })), before)) throw new Error("revision");
      if (credential.tier !== selected.tier) throw new Error("revision");
      return credential;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") throw new Error("Selected direct-provider credential is unavailable.");
      if (error instanceof Error && error.message === "revision") throw new Error("Selected direct-provider credential revision changed.");
      throw new Error("Selected direct-provider credential is invalid.");
    } finally {
      await handle?.close();
    }
  }

  async recordProviderOutcome(provider: PooledDirectProviderId, credentialId: string, error?: unknown): Promise<void> {
    assertPooledProvider(provider);
    assertSafeCredentialId(credentialId, "direct-provider");
    const outcome = secretFreeOutcome(error === undefined ? { type: "ok" } : mapDirectProviderError(error));
    await this.healthStore.recordOutcome(provider, credentialId, outcome, cooldownForOutcome(outcome));
  }

  /** Materializes the credential already resolved by the fenced execution. */
  async createAdapterFromCredential(options: CreateDirectProviderExactAdapterOptions): Promise<ProviderAdapter> {
    const credential = options.credential;
    assertPooledProvider(credential.providerId);
    const delegate = options.createAdapter?.(credential.auth) ?? this.createAdapter({
      provider: credential.providerId,
      defaultModel: options.defaultModel,
      openRouterAppUrl: options.openRouterAppUrl,
      openRouterAppName: options.openRouterAppName,
    }, credential.auth);
    const recordOutcome = async (error?: unknown): Promise<void> => {
      await this.recordProviderOutcome(credential.providerId, credential.credentialId, error);
    };
    return {
      name: delegate.name,
      deliberationTransport: delegate.deliberationTransport,
      createMessage: async (messageOptions: import("@kilnai/core").CreateMessageOptions) => {
        try {
          const response = await delegate.createMessage(messageOptions);
          await recordOutcome();
          return response;
        } catch (error) {
          await recordOutcome(error);
          throw error;
        }
      },
      streamMessage: async function* (messageOptions: import("@kilnai/core").CreateMessageOptions) {
        try {
          yield* delegate.streamMessage(messageOptions);
          await recordOutcome();
        } catch (error) {
          await recordOutcome(error);
          throw error;
        }
      },
    };
  }

  async createPool(provider: PooledDirectProviderId): Promise<CredentialPool<DirectProviderAuth>> {
    const credentials = await this.resolveCredentials(provider);
    const pool = new CredentialPool<DirectProviderAuth>(provider, {
      strategy: "fill-first",
      credentials,
      statePort: this.healthStore.createStatePort<DirectProviderAuth>(provider),
    });
    this.watcher?.onProviderChanged(provider, async () => {
      pool.reloadCredentials(await this.resolveCredentials(provider));
    });
    this.observability?.register(provider, pool);
    return pool;
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
        invalidReason: null,
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
      invalidReason: null,
      softLeaseCount: 0,
    }];
  }

  private envExecutionSnapshot(provider: PooledDirectProviderId, auth: DirectProviderAuth): {
    readonly identity: string;
    readonly revision: string;
    readonly auth: DirectProviderAuth;
  } {
    const existing = this.envExecutionSnapshots.get(provider);
    if (existing && sameAuth(existing.auth, auth)) return existing;
    const snapshot = {
      identity: randomBytes(32).toString("hex"),
      revision: randomBytes(32).toString("hex"),
      auth: { ...auth },
    };
    this.envExecutionSnapshots.set(provider, snapshot);
    return snapshot;
  }

  private createAdapter(
    options: DirectProviderAdapterConfig,
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

interface DirectProviderAdapterConfig {
  readonly provider: PooledDirectProviderId;
  readonly defaultModel?: string;
  readonly openRouterAppUrl?: string;
  readonly openRouterAppName?: string;
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

interface CredentialFileSnapshot {
  readonly identity: string;
  readonly revision: string;
}

function credentialSnapshot(value: BigIntStats): CredentialFileSnapshot {
  if (!value.isFile() || value.isSymbolicLink() || value.ino <= 0n) {
    throw new Error("Selected direct-provider credential is not a stable regular file.");
  }
  const fields = [value.dev, value.ino, value.mode, value.nlink, value.size, value.mtimeNs, value.ctimeNs, value.birthtimeNs];
  return {
    identity: createHash("sha256").update([value.dev, value.ino, value.birthtimeNs].map(String).join(":"), "utf8").digest("hex"),
    revision: createHash("sha256").update(fields.map(String).join(":"), "utf8").digest("hex"),
  };
}

function sameSnapshot(left: CredentialFileSnapshot, right: CredentialFileSnapshot): boolean {
  return left.identity === right.identity && left.revision === right.revision;
}

function assertSelectedSnapshot(snapshot: CredentialFileSnapshot, selected: DirectProviderExecutionAccount): void {
  if (snapshot.identity !== selected.fileIdentity || snapshot.revision !== selected.revision) throw new Error("revision");
}

async function openSelectedCredential(path: string): Promise<FileHandle> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (!isNodeError(error) || !["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error.code ?? "")) throw error;
    return open(path, constants.O_RDONLY);
  }
}

function parseSelectedDirectCredential(value: unknown, providerId: PooledDirectProviderId, credentialId: string): DirectProviderExecutionCredential {
  if (!isRecord(value) || value.id !== credentialId || value.providerId !== providerId) throw new Error("shape");
  const tier = typeof value.tier === "string" ? value.tier : undefined;
  return {
    providerId,
    credentialId,
    ...(tier === undefined ? {} : { tier }),
    auth: validateAuth(providerId, value.auth as DirectProviderAuth),
  };
}

function validateDirectExecutionAccount(value: DirectProviderExecutionAccount): void {
  if (!isRecord(value)) throw new Error("Selected direct-provider account is invalid.");
  assertPooledProvider(value.providerId);
  assertSafeCredentialId(value.credentialId, "direct-provider");
  if (!/^[a-f0-9]{64}$/.test(value.fileIdentity) || !/^[a-f0-9]{64}$/.test(value.revision)) {
    throw new Error("Selected direct-provider account identity is invalid.");
  }
  if (value.tier !== undefined && (typeof value.tier !== "string" || value.tier.length === 0)) {
    throw new Error("Selected direct-provider account tier is invalid.");
  }
}

function cooldownForOutcome(outcome: CredentialOutcome): number | null {
  return outcome.type === "rate-limited"
    ? outcome.resetAt ?? Date.now() + 60_000
    : outcome.type === "connection-failed"
      ? Date.now() + 30_000
      : outcome.type === "quota-exceeded"
        ? Date.now() + 5 * 60_000
        : null;
}

function secretFreeOutcome(outcome: CredentialOutcome): CredentialOutcome {
  return outcome.type === "unknown-error" ? { type: "unknown-error" } : outcome;
}

function sameAuth(left: DirectProviderAuth, right: DirectProviderAuth): boolean {
  return left.apiKey === right.apiKey && left.baseUrl === right.baseUrl;
}

function assertSafeCredentialId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(value)) throw new Error(`Invalid ${label} credential id.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
