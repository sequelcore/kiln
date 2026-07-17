import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CodexOAuthAdapter,
  CodexOAuthAuth,
  CredentialPool,
  AllCredentialsExhaustedError,
  KilnError,
  PooledProviderAdapter,
  isRetryable,
  type CodexOAuthTokenFile,
  type Credential,
  type CredentialExhaustionDiagnostic,
  type CredentialOutcome,
  type ProviderAdapter,
} from "@kilnai/core";
import { CredentialHealthStore } from "./credential-health-store.js";
import type { CredentialPoolObservabilityRegistry } from "./credential-pool-observability.js";
import type { CredentialWatcher } from "./credential-watcher.js";

export const CODEX_OAUTH_POOL_PROVIDER_ID = "codex-oauth";

export interface CodexOAuthCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly healthStore?: CredentialHealthStore;
  readonly watcher?: CredentialWatcher;
  readonly observability?: CredentialPoolObservabilityRegistry;
}

export interface LinkCodexOAuthCredentialOptions {
  readonly id?: string;
  readonly tokenFile: CodexOAuthTokenFile;
}

export interface CodexOAuthCredentialStatus {
  readonly id: string;
  readonly label: string;
  readonly expiresAt: string;
  readonly status: "valid" | "expiring-soon" | "expired" | "invalid";
  readonly invalidReason?: string;
  readonly health?: {
    readonly requestCount: number;
    readonly lastSuccess: number | null;
    readonly lastExhausted: number | null;
    readonly cooldownUntil: number | null;
    readonly lastOutcome: CredentialOutcome | null;
  };
}

export interface CodexOAuthAccessTokenCandidate {
  readonly credentialId: string;
  readonly accessToken: string;
}

export interface CreateCodexOAuthPooledAdapterOptions {
  readonly defaultModel: string;
  readonly createAdapter?: (credential: CodexOAuthPoolCredential) => ProviderAdapter;
}

export interface CodexOAuthPoolCredential {
  readonly tokenFile: CodexOAuthTokenFile;
  readonly tokenPath: string;
}

interface CodexOAuthCredentialRecord {
  readonly id: string;
  readonly tokenPath: string;
  readonly tokenFile?: CodexOAuthTokenFile;
  readonly invalidReason?: string;
}

const EXPIRING_SOON_MS = 120 * 1000;

export class CodexOAuthCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;
  private readonly watcher?: CredentialWatcher;
  private readonly observability?: CredentialPoolObservabilityRegistry;

  constructor(config: CodexOAuthCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
    this.watcher = config.watcher;
    this.observability = config.observability;
  }

  async linkCredential(options: LinkCodexOAuthCredentialOptions): Promise<void> {
    const id = options.id ?? `account-${Date.now()}`;
    assertSafeCredentialId(id);
    validateCodexOAuthTokenFile(options.tokenFile, this.credentialFilePath(id));
    await mkdir(this.providerDirectory(), { recursive: true });
    await writeFile(this.credentialFilePath(id), `${JSON.stringify(options.tokenFile, null, 2)}\n`, "utf8");
    await this.healthStore.removeCredentialHealth(CODEX_OAUTH_POOL_PROVIDER_ID, id);
  }

  async listStatus(): Promise<readonly CodexOAuthCredentialStatus[]> {
    const credentials = await this.readCredentialRecords();
    const health = await this.healthStore.readProviderHealth(CODEX_OAUTH_POOL_PROVIDER_ID);
    return credentials.map((entry) => {
      const record = health.find((candidate) => candidate.credentialId === entry.id);
      if (!entry.tokenFile) {
        return {
          id: entry.id,
          label: entry.id,
          expiresAt: "unknown",
          status: "invalid",
          ...(entry.invalidReason ? { invalidReason: entry.invalidReason } : {}),
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
      }
      const remotelyInvalid = record?.lastOutcome?.type === "auth-failed";
      return {
        id: entry.id,
        label: entry.id,
        expiresAt: entry.tokenFile.expires_at,
        status: remotelyInvalid ? "invalid" : describeExpiry(entry.tokenFile.expires_at),
        ...(remotelyInvalid ? { invalidReason: "Provider rejected this credential. Sign in again." } : {}),
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

  async getValidAccessToken(): Promise<string> {
    const candidates = await this.listValidAccessTokenCandidates();
    return candidates[0]?.accessToken ?? "";
  }

  async listValidAccessTokenCandidates(): Promise<readonly CodexOAuthAccessTokenCandidate[]> {
    const credentials = await this.readCredentials();
    const health = await this.healthStore.readProviderHealth(CODEX_OAUTH_POOL_PROVIDER_ID);
    const invalidCredentialIds = new Set(
      health.filter((record) => record.lastOutcome?.type === "auth-failed").map((record) => record.credentialId),
    );
    const candidates: CodexOAuthAccessTokenCandidate[] = [];
    for (const credential of credentials) {
      if (invalidCredentialIds.has(credential.id)) {
        continue;
      }
      try {
        const token = await new CodexOAuthAuth({ tokenPath: credential.tokenPath }).getValidAccessToken();
        if (token.trim().length > 0) {
          candidates.push({ credentialId: credential.id, accessToken: token });
        }
      } catch {
        continue;
      }
    }
    return candidates;
  }

  async recordAuthenticationFailure(credentialId: string): Promise<void> {
    await this.healthStore.recordOutcome(
      CODEX_OAUTH_POOL_PROVIDER_ID,
      credentialId,
      { type: "auth-failed" },
      null,
    );
  }

  async clearCredentials(): Promise<void> {
    const files = await this.listCredentialFileNames();
    for (const file of files) {
      await unlink(join(this.providerDirectory(), file));
    }
  }

  async createPooledAdapter(options: CreateCodexOAuthPooledAdapterOptions): Promise<ProviderAdapter> {
    const status = await this.listStatus();
    if (!status.some(isExecutableCredentialStatus)) {
      throw new AllCredentialsExhaustedError(
        undefined,
        undefined,
        buildCodexOAuthExhaustionDiagnostic(status),
      );
    }
    const pool = await this.createPool();
    this.observability?.register(CODEX_OAUTH_POOL_PROVIDER_ID, pool);
    return new PooledProviderAdapter<CodexOAuthPoolCredential>({
      name: CODEX_OAUTH_POOL_PROVIDER_ID,
      pool,
      createAdapter: options.createAdapter ?? ((credential) => new CodexOAuthAdapter({
        auth: new CodexOAuthAuth({ tokenPath: credential.tokenPath }),
        defaultModel: options.defaultModel,
      })),
      mapError: mapCodexOAuthProviderError,
      shouldRetryOutcome: isRetryableCodexOAuthOutcome,
    });
  }

  async createPool(): Promise<CredentialPool<CodexOAuthPoolCredential>> {
    const pool = new CredentialPool<CodexOAuthPoolCredential>(CODEX_OAUTH_POOL_PROVIDER_ID, {
      strategy: "round-robin",
      credentials: await this.loadCredentialsForPool(),
      statePort: this.healthStore.createStatePort<CodexOAuthPoolCredential>(CODEX_OAUTH_POOL_PROVIDER_ID),
    });
    this.watcher?.onProviderChanged(CODEX_OAUTH_POOL_PROVIDER_ID, async () => {
      pool.reloadCredentials(await this.loadCredentialsForPool());
    });
    return pool;
  }

  private async loadCredentialsForPool(): Promise<Credential<CodexOAuthPoolCredential>[]> {
    const health = await this.healthStore.readProviderHealth(CODEX_OAUTH_POOL_PROVIDER_ID);
    return (await this.readCredentials())
      .filter((entry) => isExecutableTokenFile(entry.tokenFile))
      .map((entry): Credential<CodexOAuthPoolCredential> => {
        const record = health.find((candidate) => candidate.credentialId === entry.id);
        return {
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
          requestCount: record?.requestCount ?? 0,
          lastSuccess: record?.lastSuccess ?? null,
          lastExhausted: record?.lastExhausted ?? null,
          cooldownUntil: record?.cooldownUntil ?? null,
          invalidReason: record?.lastOutcome?.type === "auth-failed" ? "auth-failed" : null,
          softLeaseCount: 0,
        };
      });
  }

  private async readCredentials(): Promise<ReadonlyArray<CodexOAuthCredentialRecord & {
    readonly tokenFile: CodexOAuthTokenFile;
  }>> {
    return (await this.readCredentialRecords()).flatMap((entry) => (
      entry.tokenFile ? [{ ...entry, tokenFile: entry.tokenFile }] : []
    ));
  }

  private async readCredentialRecords(): Promise<readonly CodexOAuthCredentialRecord[]> {
    const files = await this.listCredentialFileNames();
    const credentials = await Promise.all(files.map(async (fileName) => {
      const tokenPath = join(this.providerDirectory(), fileName);
      const id = fileName.slice(0, -".json".length);
      const raw = await readFile(tokenPath, "utf8");
      try {
        const parsed = JSON.parse(raw) as unknown;
        const tokenFile = validateCodexOAuthTokenFile(parsed, tokenPath);
        return { id, tokenFile, tokenPath };
      } catch (error) {
        if (!isCredentialShapeError(error)) {
          throw error;
        }
        return { id, tokenPath, invalidReason: errorMessage(error) };
      }
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

function isRetryableCodexOAuthOutcome(outcome: CredentialOutcome): boolean {
  return isRetryable(outcome) || outcome.type === "auth-failed";
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
  if (error instanceof KilnError && error.code === "PROVIDER_AUTH_FAILED") {
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
    throw new CodexOAuthCredentialShapeError(filePath);
  }
  const record = value as Record<string, unknown>;
  if (typeof record.access_token !== "string" || record.access_token.trim().length === 0) {
    throw new CodexOAuthCredentialShapeError(filePath);
  }
  if (typeof record.refresh_token !== "string" || record.refresh_token.trim().length === 0) {
    throw new CodexOAuthCredentialShapeError(filePath);
  }
  if (typeof record.expires_at !== "string" || !Number.isFinite(new Date(record.expires_at).getTime())) {
    throw new CodexOAuthCredentialShapeError(filePath);
  }
  if (typeof record.client_id !== "string" || record.client_id.trim().length === 0) {
    throw new CodexOAuthCredentialShapeError(filePath);
  }
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_at: record.expires_at,
    client_id: record.client_id,
  };
}

class CodexOAuthCredentialShapeError extends Error {
  constructor(filePath: string) {
    super(`Malformed Codex OAuth credential file: ${filePath}`);
    this.name = "CodexOAuthCredentialShapeError";
  }
}

function isCredentialShapeError(error: unknown): boolean {
  return error instanceof SyntaxError || error instanceof CodexOAuthCredentialShapeError;
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

function isExecutableTokenFile(tokenFile: CodexOAuthTokenFile): boolean {
  return describeExpiry(tokenFile.expires_at) !== "expired";
}

function isExecutableCredentialStatus(status: CodexOAuthCredentialStatus): boolean {
  return status.status === "valid" || status.status === "expiring-soon";
}

function buildCodexOAuthExhaustionDiagnostic(
  statuses: readonly CodexOAuthCredentialStatus[],
): CredentialExhaustionDiagnostic {
  const availableCredentials = statuses.filter(isExecutableCredentialStatus).length;
  return {
    providerId: CODEX_OAUTH_POOL_PROVIDER_ID,
    reason: "no-executable-credentials",
    totalCredentials: statuses.length,
    availableCredentials,
    unavailableCredentials: statuses.length - availableCredentials,
    lastOutcome: null,
    entries: statuses.map((status) => ({
      id: status.id,
      label: status.label,
      health: status.status === "valid" || status.status === "expiring-soon" ? "ok" : status.status,
      expiresAt: status.expiresAt,
      ...(status.invalidReason ? { invalidReason: status.invalidReason } : {}),
      ...(status.health
        ? {
            requestCount: status.health.requestCount,
            lastSuccess: status.health.lastSuccess,
            lastExhausted: status.health.lastExhausted,
            cooldownUntil: status.health.cooldownUntil,
          }
        : {}),
    })),
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown credential parsing error";
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
