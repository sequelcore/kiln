import { constants, type BigIntStats } from "node:fs";
import { lstat, mkdir, open, readdir, readFile, rename, unlink, type FileHandle } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  CodexOAuthAdapter,
  CodexOAuthAuth,
  CredentialPool,
  AllCredentialsExhaustedError,
  KilnError,
  PooledProviderAdapter,
  type CodexOAuthTokenFile,
  type Credential,
  type CredentialExhaustionDiagnostic,
  type CredentialOutcome,
  type ProviderUsageSnapshot,
  type ProviderAdapter,
} from "@kilnai/core";
import { CodexProviderUsageReader } from "../provider-usage/codex-provider-usage-reader.js";
import { FileProviderUsageStore, type ProviderUsageStore } from "../provider-usage/file-provider-usage-store.js";
import { CredentialHealthStore } from "./credential-health-store.js";
import type { CredentialPoolObservabilityRegistry } from "./credential-pool-observability.js";
import type { CredentialWatcher } from "./credential-watcher.js";

export const CODEX_OAUTH_POOL_PROVIDER_ID = "codex-oauth";

export interface CodexOAuthCredentialPoolServiceConfig {
  readonly rootDir?: string;
  readonly healthStore?: CredentialHealthStore;
  readonly watcher?: CredentialWatcher;
  readonly observability?: CredentialPoolObservabilityRegistry;
  readonly usageStore?: ProviderUsageStore;
  readonly usageReader?: CodexProviderUsageReader;
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

export interface CodexOAuthExecutionAccount {
  readonly credentialId: string;
  readonly fileIdentity: string;
  /** Opaque revision derived only from filesystem metadata, never token contents. */
  readonly revision: string;
}

export interface CodexOAuthExecutionCredential {
  readonly credentialId: string;
  readonly accessToken: string;
  /** Observed provider transport header value; never selection authority. */
  readonly chatgptAccountId: string;
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

interface CredentialFileSnapshot {
  readonly identity: string;
  readonly revision: string;
}

const EXPIRING_SOON_MS = 120 * 1000;

export class CodexOAuthCredentialPoolService {
  private readonly rootDir: string;
  private readonly healthStore: CredentialHealthStore;
  private readonly watcher?: CredentialWatcher;
  private readonly observability?: CredentialPoolObservabilityRegistry;
  private readonly usageStore: ProviderUsageStore;
  private readonly usageReader: CodexProviderUsageReader;
  private readonly credentialLocks = new Map<string, Promise<void>>();
  private catalogLock: Promise<void> = Promise.resolve();

  constructor(config: CodexOAuthCredentialPoolServiceConfig = {}) {
    this.rootDir = config.rootDir ?? join(homedir(), ".kiln", "auth");
    this.healthStore = config.healthStore ?? new CredentialHealthStore({ rootDir: this.rootDir });
    this.watcher = config.watcher;
    this.observability = config.observability;
    this.usageStore = config.usageStore ?? new FileProviderUsageStore({ rootDir: this.rootDir });
    this.usageReader = config.usageReader ?? new CodexProviderUsageReader({ store: this.usageStore });
  }

  async linkCredential(options: LinkCodexOAuthCredentialOptions): Promise<void> {
    const accountId = readCodexOAuthAccountId(options.tokenFile.access_token);
    const id = options.id ?? stableCodexOAuthCredentialId(accountId);
    assertSafeCredentialId(id);
    validateCodexOAuthTokenFile(options.tokenFile, this.credentialFilePath(id));
    await this.withCatalogLock(async () => {
      await mkdir(this.providerDirectory(), { recursive: true });
      const predecessorIds = !options.id && accountId
        ? (await this.readCredentials()).filter((credential) => credential.id !== id && readCodexOAuthAccountId(credential.tokenFile.access_token) === accountId).map((credential) => credential.id)
        : [];
      await this.withCredentialLocks([id, ...predecessorIds], async () => {
        await atomicReplaceCredentialFile(this.credentialFilePath(id), options.tokenFile);
        await this.healthStore.removeCredentialHealth(CODEX_OAUTH_POOL_PROVIDER_ID, id);
        await this.usageStore.remove(CODEX_OAUTH_POOL_PROVIDER_ID, id);
        if (!options.id && accountId) {
          const existing = await this.readCredentials();
          for (const credential of existing) {
            if (credential.id === id || readCodexOAuthAccountId(credential.tokenFile.access_token) !== accountId) {
              continue;
            }
            await unlinkIfPresent(credential.tokenPath);
            await this.healthStore.removeCredentialHealth(CODEX_OAUTH_POOL_PROVIDER_ID, credential.id);
            await this.usageStore.remove(CODEX_OAUTH_POOL_PROVIDER_ID, credential.id);
          }
        }
      });
    });
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

  /** Explicit secret-bearing read for native-harness projection (e.g. activating a Codex CLI/App account). */
  async getCredentialTokenFile(credentialId: string): Promise<CodexOAuthTokenFile | null> {
    assertSafeCredentialId(credentialId);
    const credentials = await this.readCredentials();
    return credentials.find((credential) => credential.id === credentialId)?.tokenFile ?? null;
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
        const token = await this.withCredentialLocks([credential.id], () => (
          new CodexOAuthAuth({ tokenPath: credential.tokenPath }).getValidAccessToken()
        ));
        if (token.trim().length > 0) {
          candidates.push({ credentialId: credential.id, accessToken: token });
        }
      } catch {
        continue;
      }
    }
    return candidates;
  }

  /** Secret-free enumeration for admission/selection; token files are never opened or decoded. */
  async listExecutionAccounts(): Promise<readonly CodexOAuthExecutionAccount[]> {
    const health = await this.healthStore.readProviderHealth(CODEX_OAUTH_POOL_PROVIDER_ID);
    const unhealthy = new Set(health.filter((entry) => entry.lastOutcome?.type === "auth-failed" || (entry.cooldownUntil ?? 0) > Date.now()).map((entry) => entry.credentialId));
    const accounts: CodexOAuthExecutionAccount[] = [];
    for (const fileName of await this.listCredentialFileNames()) {
      const credentialId = fileName.slice(0, -".json".length);
      if (!isSafeCredentialId(credentialId) || unhealthy.has(credentialId)) continue;
      const snapshot = credentialSnapshot(await lstat(join(this.providerDirectory(), fileName), { bigint: true }));
      accounts.push({ credentialId, fileIdentity: snapshot.identity, revision: snapshot.revision });
    }
    return accounts;
  }

  /** Resolves exactly one already-selected credential after its account lease is held. */
  async resolveExecutionCredential(selected: CodexOAuthExecutionAccount): Promise<CodexOAuthExecutionCredential> {
    if (!selected || typeof selected !== "object") throw new Error("Selected Codex OAuth account is invalid.");
    assertSafeCredentialId(selected.credentialId);
    if (!/^[a-f0-9]{64}$/.test(selected.fileIdentity)) throw new Error("Selected Codex OAuth account file identity is invalid.");
    if (!/^[a-f0-9]{64}$/.test(selected.revision)) throw new Error("Selected Codex OAuth account revision is invalid.");
    const credentialId = selected.credentialId;
    return this.withCredentialLocks([credentialId], async () => {
    const health = await this.healthStore.readProviderHealth(CODEX_OAUTH_POOL_PROVIDER_ID);
    if (health.some((entry) => entry.credentialId === credentialId && (entry.lastOutcome?.type === "auth-failed" || (entry.cooldownUntil ?? 0) > Date.now()))) {
      throw new Error("Selected Codex OAuth credential is unhealthy.");
    }
    const tokenPath = this.credentialFilePath(credentialId);
    let handle: FileHandle | undefined;
    try {
      const before = credentialSnapshot(await lstat(tokenPath, { bigint: true }));
      if (before.identity !== selected.fileIdentity || before.revision !== selected.revision) throw new Error("revision");
      handle = await openSelectedCredential(tokenPath);
      if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), before)) throw new Error("revision");
      const tokenFile = validateCodexOAuthTokenFile(JSON.parse(await handle.readFile("utf8")) as unknown, tokenPath);
      if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), before) || !sameSnapshot(credentialSnapshot(await lstat(tokenPath, { bigint: true })), before)) throw new Error("revision");
      const initialAccountId = readCodexOAuthAccountId(tokenFile.access_token);
      if (initialAccountId === null) throw new Error("shape");
      let accessToken = tokenFile.access_token;
      if (new Date(tokenFile.expires_at).getTime() <= Date.now() + EXPIRING_SOON_MS) {
        const refreshed = await new CodexOAuthAuth({ tokenPath }).refreshToken(tokenFile);
        if (readCodexOAuthAccountId(refreshed.access_token) !== initialAccountId) throw new Error("account");
        await persistRefreshOnSelectedHandle(handle, tokenPath, before, refreshed);
        accessToken = refreshed.access_token;
      }
      const chatgptAccountId = readCodexOAuthAccountId(accessToken);
      if (chatgptAccountId === null) throw new Error("shape");
      return { credentialId, accessToken, chatgptAccountId };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") throw new Error("Selected Codex OAuth credential is unavailable.");
      if (error instanceof Error && error.message === "revision") throw new Error("Selected Codex OAuth credential revision changed.");
      throw new Error("Selected Codex OAuth credential is invalid.");
    } finally {
      await handle?.close();
    }
    });
  }

  async recordAuthenticationFailure(credentialId: string): Promise<void> {
    await this.healthStore.recordOutcome(
      CODEX_OAUTH_POOL_PROVIDER_ID,
      credentialId,
      { type: "auth-failed" },
      null,
    );
  }

  async recordProviderOutcome(credentialId: string, error?: unknown): Promise<void> {
    const outcome: CredentialOutcome = error === undefined ? { type: "ok" } : mapCodexOAuthProviderError(error);
    const cooldownUntil = outcome.type === "rate-limited"
      ? outcome.resetAt ?? Date.now() + 60_000
      : outcome.type === "connection-failed"
        ? Date.now() + 30_000
        : outcome.type === "quota-exceeded"
          ? Date.now() + 5 * 60_000
          : null;
    await this.healthStore.recordOutcome(CODEX_OAUTH_POOL_PROVIDER_ID, credentialId, outcome, cooldownUntil);
  }

  async refreshUsage(): Promise<readonly ProviderUsageSnapshot[]> {
    return this.refreshUsageForAccounts(await this.listExecutionAccounts());
  }

  async refreshUsageForCredentials(
    credentialIds: readonly string[],
  ): Promise<readonly ProviderUsageSnapshot[]> {
    const requested = new Set(credentialIds.map((credentialId) => {
      assertSafeCredentialId(credentialId);
      return credentialId;
    }));
    return this.refreshUsageForAccounts(
      (await this.listExecutionAccounts()).filter((account) => requested.has(account.credentialId)),
    );
  }

  private async refreshUsageForAccounts(
    accounts: readonly CodexOAuthExecutionAccount[],
  ): Promise<readonly ProviderUsageSnapshot[]> {
    const snapshots: ProviderUsageSnapshot[] = [];
    for (const account of accounts) {
      const snapshot = await this.usageReader.read({
        provider: CODEX_OAUTH_POOL_PROVIDER_ID,
        credentialId: account.credentialId,
        resolveCredential: () => this.resolveExecutionCredential(account),
      });
      const stillCurrent = (await this.listExecutionAccounts()).some((candidate) =>
        candidate.credentialId === account.credentialId
        && candidate.fileIdentity === account.fileIdentity
        && candidate.revision === account.revision);
      if (!stillCurrent) {
        await this.usageStore.remove(CODEX_OAUTH_POOL_PROVIDER_ID, account.credentialId);
        continue;
      }
      snapshots.push(snapshot);
    }
    return snapshots;
  }

  async listUsage(now = new Date()): Promise<readonly ProviderUsageSnapshot[]> {
    return this.usageStore.list(CODEX_OAUTH_POOL_PROVIDER_ID, now);
  }

  /** Opt-in identity lookup decoded from already-local token claims; never fetched from the provider. */
  async listCredentialEmails(): Promise<ReadonlyMap<string, string>> {
    const credentials = await this.readCredentials();
    const emails = new Map<string, string>();
    for (const credential of credentials) {
      const email = readCodexOAuthProfileEmail(credential.tokenFile.access_token);
      if (email) emails.set(credential.id, email);
    }
    return emails;
  }

  async removeCredential(credentialId: string): Promise<void> {
    assertSafeCredentialId(credentialId);
    await this.withCatalogLock(() => this.withCredentialLocks([credentialId], async () => {
      await unlinkIfPresent(this.credentialFilePath(credentialId));
      await this.healthStore.removeCredentialHealth(CODEX_OAUTH_POOL_PROVIDER_ID, credentialId);
      await this.usageStore.remove(CODEX_OAUTH_POOL_PROVIDER_ID, credentialId);
    }));
  }

  async clearCredentials(): Promise<void> {
    await this.withCatalogLock(async () => {
      const files = await this.listCredentialFileNames();
      const entries = files.map((file) => ({ file, credentialId: file.slice(0, -".json".length) })).filter(({ credentialId }) => isSafeCredentialId(credentialId));
      await this.withCredentialLocks(entries.map(({ credentialId }) => credentialId), async () => {
        for (const { file, credentialId } of entries) {
          await unlinkIfPresent(join(this.providerDirectory(), file));
          await this.healthStore.removeCredentialHealth(CODEX_OAUTH_POOL_PROVIDER_ID, credentialId);
          await this.usageStore.remove(CODEX_OAUTH_POOL_PROVIDER_ID, credentialId);
        }
      });
    });
  }

  async createPooledAdapter(options: CreateCodexOAuthPooledAdapterOptions): Promise<ProviderAdapter> {
    const status = await this.listStatus();
    const executable = status.filter(isExecutableCredentialStatus);
    if (executable.length === 0) {
      throw new AllCredentialsExhaustedError(
        undefined,
        undefined,
        buildCodexOAuthExhaustionDiagnostic(status),
      );
    }
    if (executable.length !== 1) throw new KilnError("CONFIG_INVALID", "Codex OAuth pooled execution requires exactly one executable credential; bind additional accounts through explicit virtual models.");
    const pool = await this.#createPool();
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

  async #createPool(): Promise<CredentialPool<CodexOAuthPoolCredential>> {
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

  private async withCredentialLocks<T>(credentialIds: readonly string[], operation: () => Promise<T>): Promise<T> {
    const ids = [...new Set(credentialIds)].sort();
    const acquire = async (index: number): Promise<T> => {
      const id = ids[index];
      if (id === undefined) return operation();
      return this.withCredentialLock(id, () => acquire(index + 1));
    };
    return acquire(0);
  }

  /** Administrative lock order is always catalog, then canonical sorted credential IDs. */
  private async withCatalogLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.catalogLock;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.catalogLock = tail;
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.catalogLock === tail) this.catalogLock = Promise.resolve();
    }
  }

  private async withCredentialLock<T>(credentialId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.credentialLocks.get(credentialId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.credentialLocks.set(credentialId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.credentialLocks.get(credentialId) === tail) this.credentialLocks.delete(credentialId);
    }
  }
}

function stableCodexOAuthCredentialId(accountId: string | null): string {
  if (!accountId) return "primary";
  const digest = createHash("sha256").update(accountId).digest("hex").slice(0, 16);
  return `account-${digest}`;
}

function credentialSnapshot(value: BigIntStats): CredentialFileSnapshot {
  if (!value.isFile() || value.isSymbolicLink() || value.ino <= 0n) {
    throw new Error("Selected Codex OAuth credential is not a stable regular file.");
  }
  const fields = [value.dev, value.ino, value.mode, value.nlink, value.size, value.mtimeNs, value.ctimeNs, value.birthtimeNs];
  const revision = createHash("sha256").update(fields.map(String).join(":"), "utf8").digest("hex");
  const identity = createHash("sha256").update([value.dev, value.ino, value.birthtimeNs].map(String).join(":"), "utf8").digest("hex");
  return { identity, revision };
}

function sameSnapshot(left: CredentialFileSnapshot, right: CredentialFileSnapshot): boolean {
  return left.identity === right.identity && left.revision === right.revision;
}

/** O_NOFOLLOW is not supported by every Windows filesystem; identity checks remain mandatory on fallback. */
async function openSelectedCredential(tokenPath: string): Promise<FileHandle> {
  try {
    return await open(tokenPath, constants.O_RDWR | constants.O_NOFOLLOW);
  } catch (error) {
    if (!isNodeError(error) || !["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error.code ?? "")) throw error;
    return open(tokenPath, constants.O_RDWR);
  }
}

async function persistRefreshOnSelectedHandle(
  handle: FileHandle,
  tokenPath: string,
  expected: CredentialFileSnapshot,
  tokenFile: CodexOAuthTokenFile,
): Promise<void> {
  if (!sameSnapshot(credentialSnapshot(await handle.stat({ bigint: true })), expected) || !sameSnapshot(credentialSnapshot(await lstat(tokenPath, { bigint: true })), expected)) {
    throw new Error("revision");
  }
  const serialized = Buffer.from(`${JSON.stringify(tokenFile, null, 2)}\n`, "utf8");
  await handle.truncate(0);
  await writeAll(handle, serialized);
  await handle.sync();
  const openedAfter = credentialSnapshot(await handle.stat({ bigint: true }));
  const pathAfter = credentialSnapshot(await lstat(tokenPath, { bigint: true }));
  if (openedAfter.identity !== expected.identity || pathAfter.identity !== expected.identity || openedAfter.revision !== pathAfter.revision) {
    throw new Error("revision");
  }
}

async function atomicReplaceCredentialFile(tokenPath: string, tokenFile: CodexOAuthTokenFile): Promise<void> {
  const tempPath = `${tokenPath}.${randomBytes(12).toString("hex")}.tmp`;
  let handle: FileHandle | undefined;
  let renamed = false;
  try {
    handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    await writeAll(handle, Buffer.from(`${JSON.stringify(tokenFile, null, 2)}\n`, "utf8"));
    await handle.sync();
    await handle.close();
    handle = undefined;
    // Node rename is atomic on supported same-filesystem replacements. Windows failures are not
    // downgraded to unlink+rename because that would create a destructive replacement gap.
    await rename(tempPath, tokenPath);
    renamed = true;
  } finally {
    await handle?.close().catch(() => undefined);
    if (!renamed) await unlinkIfPresent(tempPath);
  }
}

async function writeAll(handle: FileHandle, bytes: Buffer): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, offset);
    if (bytesWritten <= 0) throw new Error("Credential persistence made no progress.");
    offset += bytesWritten;
  }
}

async function unlinkIfPresent(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (!isNodeError(error) || error.code !== "ENOENT") throw error;
  }
}

function readCodexOAuthAccountId(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const auth = claims["https://api.openai.com/auth"];
    if (typeof auth !== "object" || auth === null || Array.isArray(auth)) return null;
    const accountId = (auth as Record<string, unknown>).chatgpt_account_id;
    return typeof accountId === "string" && accountId.trim().length > 0 ? accountId.trim() : null;
  } catch {
    return null;
  }
}

function readCodexOAuthProfileEmail(accessToken: string): string | null {
  const payload = accessToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const profile = claims["https://api.openai.com/profile"];
    if (typeof profile !== "object" || profile === null || Array.isArray(profile)) return null;
    const email = (profile as Record<string, unknown>).email;
    return typeof email === "string" && email.trim().length > 0 ? email.trim() : null;
  } catch {
    return null;
  }
}

function isRetryableCodexOAuthOutcome(_outcome: CredentialOutcome): boolean {
  return false;
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
  if (status === 408 || status === 425 || status === 500 || status === 502 || status === 503 || status === 504) {
    return { type: "connection-failed" };
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
  const idToken = typeof record.id_token === "string" && record.id_token.trim().length > 0
    ? record.id_token
    : undefined;
  return {
    access_token: record.access_token,
    refresh_token: record.refresh_token,
    expires_at: record.expires_at,
    client_id: record.client_id,
    ...(idToken ? { id_token: idToken } : {}),
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
  if (!isSafeCredentialId(id)) {
    throw new Error(`Invalid Codex OAuth credential id: ${id}`);
  }
}

function isSafeCredentialId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
