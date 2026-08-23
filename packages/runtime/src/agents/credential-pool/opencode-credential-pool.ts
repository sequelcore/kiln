import { constants, type BigIntStats } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, open, readdir, unlink, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CredentialPool,
  OpenCodeAdapter,
  type Credential,
  type CredentialOutcome,
  type CreateMessageOptions,
  type OpenCodeAuthFile,
  type OpenCodeTier,
  type ProviderAdapter,
} from "@kilnai/core";
import { CredentialHealthStore } from "./credential-health-store.js";
import { CredentialFileStore } from "./credential-file-store.js";
import type { CredentialPoolObservabilityRegistry } from "./credential-pool-observability.js";
import type { CredentialWatcher } from "./credential-watcher.js";

export const OPENCODE_POOL_PROVIDER_ID = "opencode-api";

export interface OpenCodeCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly healthStore?: CredentialHealthStore;
  readonly watcher?: CredentialWatcher;
  readonly observability?: CredentialPoolObservabilityRegistry;
}

export interface LinkOpenCodeCredentialOptions {
  readonly id?: string;
  readonly apiKey: string;
  readonly tier: OpenCodeTier;
  readonly createdAt?: string;
}

export interface OpenCodeCredentialStatus {
  readonly id: string;
  readonly label: string;
  readonly tier: OpenCodeTier;
  readonly createdAt: string;
  readonly key: string;
  readonly health?: {
    readonly requestCount: number;
    readonly lastSuccess: number | null;
    readonly lastExhausted: number | null;
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export type OpenCodeExecutionProviderId = "opencode-go" | "opencode-zen";

export interface OpenCodeExecutionAccount {
  readonly providerId: OpenCodeExecutionProviderId;
  readonly credentialId: string;
  readonly tier: OpenCodeTier;
  readonly fileIdentity: string;
  readonly revision: string;
}

export interface OpenCodeExecutionCredential {
  readonly providerId: OpenCodeExecutionProviderId;
  readonly credentialId: string;
  readonly tier: OpenCodeTier;
  readonly auth: OpenCodeAuthFile;
}

export interface ClearOpenCodeCredentialsOptions {
  readonly tier?: OpenCodeTier;
  readonly id?: string;
}

export interface CreateExactOpenCodeAdapterOptions {
  readonly selected: OpenCodeExecutionAccount;
  readonly defaultModel: string;
  readonly createAdapter?: (credential: OpenCodeExecutionCredential) => ProviderAdapter;
}

export class OpenCodeCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;
  private readonly fileStore: CredentialFileStore<OpenCodeAuthFile>;
  private readonly watcher?: CredentialWatcher;
  private readonly observability?: CredentialPoolObservabilityRegistry;

  constructor(config: OpenCodeCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
    this.fileStore = new CredentialFileStore<OpenCodeAuthFile>({ rootDir: this.rootDir });
    this.watcher = config.watcher;
    this.observability = config.observability;
  }

  async linkCredential(options: LinkOpenCodeCredentialOptions): Promise<void> {
    const id = options.id ?? `${options.tier}-${Date.now()}`;
    assertSafeCredentialId(id);
    const file: OpenCodeAuthFile = {
      api_key: options.apiKey.trim(),
      tier: options.tier,
      created_at: options.createdAt ?? new Date().toISOString(),
    };
    validateOpenCodeAuthFile(file, this.credentialFilePath(id));
    await this.fileStore.writeCredential({
      id,
      label: id,
      providerId: OPENCODE_POOL_PROVIDER_ID,
      tier: options.tier,
      auth: file,
    });
  }

  async listStatus(): Promise<readonly OpenCodeCredentialStatus[]> {
    const credentials = await this.readCredentials();
    const health = await this.healthStore.readProviderHealth(OPENCODE_POOL_PROVIDER_ID);
    return credentials.map((entry) => {
      const record = health.find((candidate) => candidate.credentialId === entry.id);
      return {
        id: entry.id,
        label: entry.id,
        tier: entry.auth.tier,
        createdAt: entry.auth.created_at,
        key: maskKey(entry.auth.api_key),
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
  async listExecutionAccounts(tier: OpenCodeTier): Promise<readonly OpenCodeExecutionAccount[]> {
    const providerId = executionProviderId(tier);
    const health = await this.healthStore.readProviderHealth(OPENCODE_POOL_PROVIDER_ID);
    const unhealthy = new Set(health
      .filter((entry) => entry.lastOutcome?.type === "auth-failed" || (entry.cooldownUntil ?? 0) > Date.now())
      .map((entry) => entry.credentialId));
    const accounts: OpenCodeExecutionAccount[] = [];
    for (const credential of await this.readCredentials()) {
      if (credential.auth.tier !== tier || unhealthy.has(credential.id)) continue;
      const snapshot = credentialSnapshot(await lstat(this.credentialFilePath(credential.id), { bigint: true }));
      accounts.push({
        providerId,
        credentialId: credential.id,
        tier,
        fileIdentity: snapshot.identity,
        revision: snapshot.revision,
      });
    }
    return accounts;
  }

  /** Resolves only the credential revision selected before an account lease was acquired. */
  async resolveExecutionCredential(selected: OpenCodeExecutionAccount): Promise<OpenCodeExecutionCredential> {
    validateExecutionAccount(selected);
    const health = await this.healthStore.readProviderHealth(OPENCODE_POOL_PROVIDER_ID);
    if (health.some((entry) => entry.credentialId === selected.credentialId && (entry.lastOutcome?.type === "auth-failed" || (entry.cooldownUntil ?? 0) > Date.now()))) {
      throw new Error("Selected OpenCode credential is unhealthy.");
    }
    const path = this.credentialFilePath(selected.credentialId);
    let handle: FileHandle | undefined;
    try {
      const before = credentialSnapshot(await lstat(path, { bigint: true }));
      if (before.identity !== selected.fileIdentity || before.revision !== selected.revision) throw new Error("revision");
      handle = await openSelectedCredential(path);
      if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), before)) throw new Error("revision");
      const parsed = JSON.parse(await handle.readFile("utf8")) as unknown;
      const credential = parseSelectedCredential(parsed, selected);
      if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), before)
        || !sameSnapshot(credentialSnapshot(await lstat(path, { bigint: true })), before)) throw new Error("revision");
      return credential;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") throw new Error("Selected OpenCode credential is unavailable.");
      if (error instanceof Error && error.message === "revision") throw new Error("Selected OpenCode credential revision changed.");
      throw new Error("Selected OpenCode credential is invalid.");
    } finally {
      await handle?.close();
    }
  }

  async recordProviderOutcome(providerId: OpenCodeExecutionProviderId, credentialId: string, error?: unknown): Promise<void> {
    executionTier(providerId);
    assertSafeCredentialId(credentialId);
    const outcome = secretFreeOutcome(error === undefined ? { type: "ok" } : mapOpenCodeProviderError(error));
    await this.healthStore.recordOutcome(OPENCODE_POOL_PROVIDER_ID, credentialId, outcome, cooldownForOutcome(outcome));
  }

  async clearCredentials(options: ClearOpenCodeCredentialsOptions = {}): Promise<void> {
    if (options.id === undefined && options.tier === undefined) {
      const files = await this.listCredentialFileNames();
      for (const file of files) {
        await unlink(join(this.providerDirectory(), file));
      }
      return;
    }
    if (options.id !== undefined) {
      assertSafeCredentialId(options.id);
    }
    const credentials = await this.readCredentials();
    for (const entry of credentials) {
      if (options.id !== undefined && entry.id !== options.id) {
        continue;
      }
      if (options.tier !== undefined && entry.auth.tier !== options.tier) {
        continue;
      }
      await unlink(this.credentialFilePath(entry.id));
    }
  }

  /** Materializes one previously selected account revision without consulting pooled order. */
  async createExactAdapter(options: CreateExactOpenCodeAdapterOptions): Promise<ProviderAdapter> {
    const credential = await this.resolveExecutionCredential(options.selected);
    return this.createAdapterFromCredential({
      credential,
      defaultModel: options.defaultModel,
      ...(options.createAdapter ? { createAdapter: options.createAdapter } : {}),
    });
  }

  /** Materializes the credential already resolved by the fenced execution. */
  async createAdapterFromCredential(options: {
    readonly credential: OpenCodeExecutionCredential;
    readonly defaultModel: string;
    readonly createAdapter?: (credential: OpenCodeExecutionCredential) => ProviderAdapter;
  }): Promise<ProviderAdapter> {
    const credential = options.credential;
    const delegate = options.createAdapter?.(credential) ?? new OpenCodeAdapter({
      apiKey: credential.auth.api_key,
      tier: credential.tier,
      defaultModel: options.defaultModel,
      internalRetry: false,
    });
    const recordOutcome = async (error?: unknown): Promise<void> => {
      await this.recordProviderOutcome(credential.providerId, credential.credentialId, error);
    };
    return {
      name: delegate.name,
      deliberationTransport: delegate.deliberationTransport,
      createMessage: async (messageOptions: CreateMessageOptions) => {
        try {
          const response = await delegate.createMessage(messageOptions);
          await recordOutcome();
          return response;
        } catch (error) {
          await recordOutcome(error);
          throw error;
        }
      },
      streamMessage: async function* (messageOptions: CreateMessageOptions) {
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

  async createPool(tier: OpenCodeTier): Promise<CredentialPool<OpenCodeAuthFile>> {
    const pool = new CredentialPool<OpenCodeAuthFile>(OPENCODE_POOL_PROVIDER_ID, {
      strategy: "fill-first",
      credentials: await this.loadCredentialsForPool(tier),
      statePort: this.healthStore.createStatePort<OpenCodeAuthFile>(OPENCODE_POOL_PROVIDER_ID),
    });
    this.watcher?.onProviderChanged(OPENCODE_POOL_PROVIDER_ID, async () => {
      pool.reloadCredentials(await this.loadCredentialsForPool(tier));
    });
    this.observability?.register(executionProviderId(tier), pool);
    return pool;
  }

  private async loadCredentialsForPool(tier: OpenCodeTier): Promise<Credential<OpenCodeAuthFile>[]> {
    return (await this.readCredentials())
      .filter((entry) => entry.auth.tier === tier)
      .map((entry): Credential<OpenCodeAuthFile> => ({
        id: entry.id,
        label: entry.id,
        providerId: OPENCODE_POOL_PROVIDER_ID,
        source: "manual",
        priority: 0,
        tier: entry.auth.tier,
        auth: entry.auth,
        requestCount: 0,
        lastSuccess: null,
        lastExhausted: null,
        cooldownUntil: null,
        invalidReason: null,
        softLeaseCount: 0,
      }));
  }

  private async readCredentials(): Promise<ReadonlyArray<{ readonly id: string; readonly auth: OpenCodeAuthFile }>> {
    const credentials = (await this.fileStore.readProviderCredentials(OPENCODE_POOL_PROVIDER_ID)).map((file) => ({
      id: file.id,
      auth: validateOpenCodeAuthFile(file.auth, this.credentialFilePath(file.id)),
    }));
    return credentials.sort((a, b) => a.id.localeCompare(b.id));
  }

  private providerDirectory(): string {
    return join(this.rootDir, OPENCODE_POOL_PROVIDER_ID);
  }

  private async listCredentialFileNames(): Promise<readonly string[]> {
    try {
      const entries = await readdir(this.providerDirectory(), { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private credentialFilePath(id: string): string {
    return join(this.providerDirectory(), `${id}.json`);
  }
}

export function mapOpenCodeProviderError(error: unknown): CredentialOutcome {
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

function validateOpenCodeAuthFile(value: unknown, filePath: string): OpenCodeAuthFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Malformed OpenCode credential file: ${filePath}`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.api_key !== "string" || record.api_key.trim().length === 0) {
    throw new Error(`Malformed OpenCode credential file: ${filePath}`);
  }
  if (record.tier !== "go" && record.tier !== "zen") {
    throw new Error(`Malformed OpenCode credential file: ${filePath}`);
  }
  if (typeof record.created_at !== "string" || record.created_at.trim().length === 0) {
    throw new Error(`Malformed OpenCode credential file: ${filePath}`);
  }
  return {
    api_key: record.api_key,
    tier: record.tier,
    created_at: record.created_at,
  };
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  const status = (error as { readonly status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function maskKey(key: string): string {
  if (key.length <= 8) {
    return "****";
  }
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function assertSafeCredentialId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid OpenCode credential id: ${id}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

interface CredentialFileSnapshot {
  readonly identity: string;
  readonly revision: string;
}

function credentialSnapshot(value: BigIntStats): CredentialFileSnapshot {
  if (!value.isFile() || value.isSymbolicLink() || value.ino <= 0n) {
    throw new Error("Selected OpenCode credential is not a stable regular file.");
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

async function openSelectedCredential(path: string): Promise<FileHandle> {
  try {
    return await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (error) {
    if (!isNodeError(error) || !["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error.code ?? "")) throw error;
    return open(path, constants.O_RDONLY);
  }
}

function parseSelectedCredential(value: unknown, selected: OpenCodeExecutionAccount): OpenCodeExecutionCredential {
  if (!isRecord(value) || value.id !== selected.credentialId || value.providerId !== OPENCODE_POOL_PROVIDER_ID) throw new Error("shape");
  const auth = validateOpenCodeAuthFile(value.auth, "selected credential");
  if (auth.tier !== selected.tier || executionProviderId(auth.tier) !== selected.providerId || value.tier !== selected.tier) throw new Error("revision");
  return {
    providerId: selected.providerId,
    credentialId: selected.credentialId,
    tier: selected.tier,
    auth,
  };
}

function validateExecutionAccount(value: OpenCodeExecutionAccount): void {
  if (!isRecord(value)) throw new Error("Selected OpenCode account is invalid.");
  assertSafeCredentialId(value.credentialId);
  if ((value.tier !== "go" && value.tier !== "zen") || executionProviderId(value.tier) !== value.providerId) {
    throw new Error("Selected OpenCode account provider is invalid.");
  }
  if (typeof value.fileIdentity !== "string" || typeof value.revision !== "string"
    || !/^[a-f0-9]{64}$/.test(value.fileIdentity) || !/^[a-f0-9]{64}$/.test(value.revision)) {
    throw new Error("Selected OpenCode account identity is invalid.");
  }
}

function executionProviderId(tier: OpenCodeTier): OpenCodeExecutionProviderId {
  return tier === "zen" ? "opencode-zen" : "opencode-go";
}

function executionTier(providerId: OpenCodeExecutionProviderId): OpenCodeTier {
  if (providerId === "opencode-go") return "go";
  if (providerId === "opencode-zen") return "zen";
  throw new Error("Unsupported OpenCode execution provider.");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
