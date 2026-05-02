import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CodexOAuthAdapter,
  CodexOAuthAuth,
  CredentialPool,
  PooledProviderAdapter,
  type CodexOAuthTokenFile,
  type Credential,
  type CredentialOutcome,
  type ProviderAdapter,
} from "@kilnai/core";
import { CredentialHealthStore } from "./credential-health-store.js";
import type { CredentialWatcher } from "./credential-watcher.js";

export const CODEX_OAUTH_POOL_PROVIDER_ID = "codex-oauth";

export interface CodexOAuthCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly healthStore?: CredentialHealthStore;
  readonly watcher?: CredentialWatcher;
}

export interface LinkCodexOAuthCredentialOptions {
  readonly id?: string;
  readonly tokenFile: CodexOAuthTokenFile;
}

export interface CodexOAuthCredentialStatus {
  readonly id: string;
  readonly label: string;
  readonly expiresAt: string;
  readonly status: "valid" | "expiring-soon" | "expired";
  readonly health?: {
    readonly requestCount: number;
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export interface CreateCodexOAuthPooledAdapterOptions {
  readonly defaultModel: string;
  readonly createAdapter?: (credential: CodexOAuthPoolCredential) => ProviderAdapter;
}

export interface CodexOAuthPoolCredential {
  readonly tokenFile: CodexOAuthTokenFile;
  readonly tokenPath: string;
}

const EXPIRING_SOON_MS = 120 * 1000;

export class CodexOAuthCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;
  private readonly watcher?: CredentialWatcher;

  constructor(config: CodexOAuthCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
    this.watcher = config.watcher;
  }

  async linkCredential(options: LinkCodexOAuthCredentialOptions): Promise<void> {
    const id = options.id ?? `account-${Date.now()}`;
    assertSafeCredentialId(id);
    validateCodexOAuthTokenFile(options.tokenFile, this.credentialFilePath(id));
    await mkdir(this.providerDirectory(), { recursive: true });
    await writeFile(this.credentialFilePath(id), `${JSON.stringify(options.tokenFile, null, 2)}\n`, "utf8");
  }

  async listStatus(): Promise<readonly CodexOAuthCredentialStatus[]> {
    const credentials = await this.readCredentials();
    const health = await this.healthStore.readProviderHealth(CODEX_OAUTH_POOL_PROVIDER_ID);
    return credentials.map((entry) => {
      const record = health.find((candidate) => candidate.credentialId === entry.id);
      return {
        id: entry.id,
        label: entry.id,
        expiresAt: entry.tokenFile.expires_at,
        status: describeExpiry(entry.tokenFile.expires_at),
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
  }

  async createPooledAdapter(options: CreateCodexOAuthPooledAdapterOptions): Promise<ProviderAdapter> {
    const pool = await this.createPool();
    return new PooledProviderAdapter<CodexOAuthPoolCredential>({
      name: CODEX_OAUTH_POOL_PROVIDER_ID,
      pool,
      createAdapter: options.createAdapter ?? ((credential) => new CodexOAuthAdapter({
        auth: new CodexOAuthAuth({ tokenPath: credential.tokenPath }),
        defaultModel: options.defaultModel,
      })),
      mapError: mapCodexOAuthProviderError,
    });
  }

  async createPool(): Promise<CredentialPool<CodexOAuthPoolCredential>> {
    const pool = new CredentialPool<CodexOAuthPoolCredential>(CODEX_OAUTH_POOL_PROVIDER_ID, {
      strategy: "fill-first",
      credentials: await this.loadCredentialsForPool(),
      statePort: this.healthStore.createStatePort<CodexOAuthPoolCredential>(CODEX_OAUTH_POOL_PROVIDER_ID),
    });
    this.watcher?.onProviderChanged(CODEX_OAUTH_POOL_PROVIDER_ID, async () => {
      pool.reloadCredentials(await this.loadCredentialsForPool());
    });
    return pool;
  }

  private async loadCredentialsForPool(): Promise<Credential<CodexOAuthPoolCredential>[]> {
    return (await this.readCredentials())
      .map((entry): Credential<CodexOAuthPoolCredential> => ({
        id: entry.id,
        label: entry.id,
        providerId: CODEX_OAUTH_POOL_PROVIDER_ID,
        source: "manual",
        priority: 0,
        tier: undefined,
        auth: {
          tokenFile: entry.tokenFile,
          tokenPath: entry.tokenPath,
        },
        requestCount: 0,
        lastSuccess: null,
        lastExhausted: null,
        cooldownUntil: null,
        softLeaseCount: 0,
      }));
  }

  private async readCredentials(): Promise<ReadonlyArray<{
    readonly id: string;
    readonly tokenFile: CodexOAuthTokenFile;
    readonly tokenPath: string;
  }>> {
    const files = await this.listCredentialFileNames();
    const credentials = await Promise.all(files.map(async (fileName) => {
      const tokenPath = join(this.providerDirectory(), fileName);
      const parsed = JSON.parse(await readFile(tokenPath, "utf8")) as unknown;
      const tokenFile = validateCodexOAuthTokenFile(parsed, tokenPath);
      return {
        id: fileName.slice(0, -".json".length),
        tokenFile,
        tokenPath,
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
    return join(this.rootDir, CODEX_OAUTH_POOL_PROVIDER_ID);
  }

  private credentialFilePath(id: string): string {
    return join(this.providerDirectory(), `${id}.json`);
  }
}

export function mapCodexOAuthProviderError(error: unknown): CredentialOutcome {
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

function validateCodexOAuthTokenFile(value: unknown, filePath: string): CodexOAuthTokenFile {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Malformed Codex OAuth credential file: ${filePath}`);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.trim().length === 0) {
    throw new Error(`Malformed Codex OAuth credential file: ${filePath}`);
  }
  if (typeof record.refresh_token !== "string" || record.refresh_token.trim().length === 0) {
    throw new Error(`Malformed Codex OAuth credential file: ${filePath}`);
  }
  if (typeof record.expires_at !== "string" || !Number.isFinite(new Date(record.expires_at).getTime())) {
    throw new Error(`Malformed Codex OAuth credential file: ${filePath}`);
  }
  if (typeof record.client_id !== "string" || record.client_id.trim().length === 0) {
    throw new Error(`Malformed Codex OAuth credential file: ${filePath}`);
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_at: record.expires_at,
    client_id: record.client_id,
  };
}

function describeExpiry(expiresAt: string): "valid" | "expiring-soon" | "expired" {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (expiresAtMs <= Date.now()) {
    return "expired";
  }
  if (expiresAtMs <= Date.now() + EXPIRING_SOON_MS) {
    return "expiring-soon";
  }
  return "valid";
}

function readStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  if ("status" in error) {
    const status = (error as { readonly status?: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  if ("context" in error) {
    const context = (error as { readonly context?: unknown }).context;
    if (typeof context === "object" && context !== null && "status" in context) {
      const status = (context as { readonly status?: unknown }).status;
      return typeof status === "number" ? status : null;
    }
  }
  return null;
}

function assertSafeCredentialId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id)) {
    throw new Error(`Invalid Codex OAuth credential id: ${id}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
