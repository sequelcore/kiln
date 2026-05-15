import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CredentialPool,
  OpenCodeAdapter,
  PooledProviderAdapter,
  type Credential,
  type CredentialOutcome,
  type OpenCodeAuthFile,
  type OpenCodeTier,
  type ProviderAdapter,
} from "@kilnai/core";
import { CredentialHealthStore } from "./credential-health-store.js";
import type { CredentialPoolObservabilityRegistry } from "./credential-pool-observability.js";
import type { CredentialWatcher } from "./credential-watcher.js";

export const OPENCODE_POOL_PROVIDER_ID = "opencode";

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

export interface ClearOpenCodeCredentialsOptions {
  readonly tier?: OpenCodeTier;
  readonly id?: string;
}

export interface CreateOpenCodePooledAdapterOptions {
  readonly tier: OpenCodeTier;
  readonly defaultModel: string;
  readonly createAdapter?: (auth: OpenCodeAuthFile) => ProviderAdapter;
}

export class OpenCodeCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;
  private readonly watcher?: CredentialWatcher;
  private readonly observability?: CredentialPoolObservabilityRegistry;

  constructor(config: OpenCodeCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
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
    await mkdir(this.providerDirectory(), { recursive: true });
    await writeFile(this.credentialFilePath(id), `${JSON.stringify(file, null, 2)}\n`, "utf8");
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

  async createPooledAdapter(options: CreateOpenCodePooledAdapterOptions): Promise<ProviderAdapter> {
    const pool = await this.createPool(options.tier);
    this.observability?.register(options.tier === "zen" ? "opencode-zen" : "opencode-go", pool);
    return new PooledProviderAdapter<OpenCodeAuthFile>({
      name: options.tier === "zen" ? "opencode-zen" : "opencode-go",
      pool,
      createAdapter: options.createAdapter ?? ((auth) => new OpenCodeAdapter({
        apiKey: auth.api_key,
        tier: auth.tier,
        defaultModel: options.defaultModel,
        internalRetry: false,
      })),
      mapError: mapOpenCodeProviderError,
    });
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
        softLeaseCount: 0,
      }));
  }

  private async readCredentials(): Promise<ReadonlyArray<{ readonly id: string; readonly auth: OpenCodeAuthFile }>> {
    const files = await this.listCredentialFileNames();
    const credentials = await Promise.all(files.map(async (fileName) => {
      const filePath = join(this.providerDirectory(), fileName);
      const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown;
      const auth = validateOpenCodeAuthFile(parsed, filePath);
      return {
        id: fileName.slice(0, -".json".length),
        auth,
      };
    }));
    return credentials.sort((a, b) => a.id.localeCompare(b.id));
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

  private providerDirectory(): string {
    return join(this.rootDir, OPENCODE_POOL_PROVIDER_ID);
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
