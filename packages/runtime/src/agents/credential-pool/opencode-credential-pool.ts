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

export const OPENCODE_POOL_PROVIDER_ID = "opencode";

export interface OpenCodeCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly healthStore?: CredentialHealthStore;
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
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export interface CreateOpenCodePooledAdapterOptions {
  readonly tier: OpenCodeTier;
  readonly defaultModel: string;
  readonly createAdapter?: (auth: OpenCodeAuthFile) => ProviderAdapter;
}

export class OpenCodeCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;

  constructor(config: OpenCodeCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
  }

  async linkCredential(options: LinkOpenCodeCredentialOptions): Promise<void> {
    await this.migratePreviousSingletonIfNeeded();
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
              cooldownUntil: record.cooldownUntil,
              lastOutcome: record.lastOutcome,
            }
          : undefined,
      };
    });
  }

  async clearCredentials(): Promise<void> {
    const files = await this.listCredentialFileNames();
    for (const file of files) {
      await unlink(join(this.providerDirectory(), file));
    }
    await removeIfExists(this.previousSingletonFilePath());
  }

  async createPooledAdapter(options: CreateOpenCodePooledAdapterOptions): Promise<ProviderAdapter> {
    const pool = await this.createPool(options.tier);
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
    const credentials = (await this.readCredentials())
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

    return new CredentialPool<OpenCodeAuthFile>(OPENCODE_POOL_PROVIDER_ID, {
      strategy: "fill-first",
      credentials,
      statePort: this.healthStore.createStatePort<OpenCodeAuthFile>(OPENCODE_POOL_PROVIDER_ID),
    });
  }

  private async readCredentials(): Promise<ReadonlyArray<{ readonly id: string; readonly auth: OpenCodeAuthFile }>> {
    await this.migratePreviousSingletonIfNeeded();
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

  private async migratePreviousSingletonIfNeeded(): Promise<void> {
    const hasPreviousSingleton = await fileExists(this.previousSingletonFilePath());
    if (!hasPreviousSingleton) {
      return;
    }

    const directoryFiles = await this.listCredentialFileNames();
    if (directoryFiles.length > 0) {
      throw new Error("previous singleton and directory OpenCode credentials cannot coexist");
    }

    const parsed = JSON.parse(await readFile(this.previousSingletonFilePath(), "utf8")) as unknown;
    const auth = validateOpenCodeAuthFile(parsed, this.previousSingletonFilePath());
    await mkdir(this.providerDirectory(), { recursive: true });
    await writeFile(this.credentialFilePath("default"), `${JSON.stringify(auth, null, 2)}\n`, "utf8");
    validateOpenCodeAuthFile(JSON.parse(await readFile(this.credentialFilePath("default"), "utf8")), this.credentialFilePath("default"));
    await unlink(this.previousSingletonFilePath());
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

  private previousSingletonFilePath(): string {
    return join(this.rootDir, "opencode.json");
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function removeIfExists(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
