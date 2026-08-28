import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { CodexOAuthCredentialPoolService } from "../credential-pool/codex-oauth-credential-pool.js";
import { listOverPermissiveCredentialFiles } from "../credential-pool/credential-permission-diagnostic.js";
import { OpenCodeCredentialPoolService } from "../credential-pool/opencode-credential-pool.js";
import { resolveRuntimeKilnHome } from "../../kiln-home.js";
import type { CodexOAuthTokenFile } from "./codex-oauth-auth.js";
import {
  fromNativeCodexAuthFile,
  parseNativeCodexAuthFile,
  toNativeCodexAuthFile,
  type NativeCodexAuthFile,
} from "./codex-native-account.js";
import { CREDENTIAL_FILE_MODE } from "./credential-file-mode.js";
import {
  readNativeOpenCodeCredential,
  type OpenCodeTier,
} from "./opencode-credentials.js";

const EXPIRING_SOON_MS = 120 * 1000;
const NATIVE_CODEX_AUTH_BACKUP_TARGET_ID = "codex-native-auth";
const NATIVE_CODEX_AUTH_BACKUP_RETENTION = 5;
const POOLED_PROVIDER_AUTH_FILES = new Set(["opencode.json", "codex-oauth.json"]);
const DIRECT_OPENCODE_AUTH_DIR = "opencode-api";
const CODEX_OAUTH_AUTH_DIR = "codex-oauth";

export interface ProviderCredentialApplicationServiceConfig {
  readonly kilnHome?: string;
}

export interface ImportNativeOpenCodeCredentialOptions {
  readonly tier: OpenCodeTier;
  readonly id: string;
}

export interface LegacyProviderCredentialStatus {
  readonly provider: string;
  readonly status: "unreadable" | "unknown" | "expired" | "expiring soon" | "valid";
  readonly expiresAt?: string;
}

export interface CredentialPermissionFinding {
  readonly relativePath: string;
  readonly mode: string;
  readonly repairPath: string;
}

export interface ProviderCredentialInspection {
  readonly hasStoredEntries: boolean;
  readonly hasOpenCodePool: boolean;
  readonly hasCodexOAuthPool: boolean;
  readonly legacyProviders: readonly LegacyProviderCredentialStatus[];
  readonly permissionFindings: readonly CredentialPermissionFinding[];
}

export type CodexNativeActivationSelection =
  | { readonly kind: "auto" }
  | { readonly kind: "explicit"; readonly id: string };

export type CodexNativeActivationResult =
  | {
      readonly kind: "activated";
      readonly id: string;
      readonly email?: string;
      readonly absorbedAccountId?: string;
      readonly backupPath?: string;
    }
  | { readonly kind: "unknown-credential"; readonly id: string; readonly absorbedAccountId?: string }
  | { readonly kind: "no-available-credential"; readonly absorbedAccountId?: string }
  | {
      readonly kind: "no-activatable-credential";
      readonly blockedIds: readonly string[];
      readonly absorbedAccountId?: string;
    };

interface CodexActivationTarget {
  readonly id: string;
  readonly tokenFile: CodexOAuthTokenFile & { readonly id_token: string };
}

type CodexActivationResolution =
  | { readonly kind: "selected"; readonly target: CodexActivationTarget }
  | Exclude<CodexNativeActivationResult, { readonly kind: "activated" }>;

export class ProviderCredentialApplicationService {
  private readonly kilnHome: string;

  constructor(config: ProviderCredentialApplicationServiceConfig = {}) {
    this.kilnHome = resolveRuntimeKilnHome(config.kilnHome);
  }

  async importNativeOpenCodeCredential(
    options: ImportNativeOpenCodeCredentialOptions,
  ): Promise<boolean> {
    const imported = await readNativeOpenCodeCredential({
      tier: options.tier,
    });
    if (!imported) {
      return false;
    }
    await new OpenCodeCredentialPoolService({ kilnHome: this.kilnHome }).linkCredential({
      id: options.id,
      apiKey: imported.api_key,
      tier: imported.tier,
      createdAt: imported.created_at,
    });
    return true;
  }

  async activateNativeCodexCredential(
    selection: CodexNativeActivationSelection,
  ): Promise<CodexNativeActivationResult> {
    const pool = new CodexOAuthCredentialPoolService({ kilnHome: this.kilnHome });
    const nativeAuthPath = join(resolveNativeCodexHome(), "auth.json");
    const absorbedAccountId = await absorbCurrentNativeAccount(pool, nativeAuthPath);
    const resolution = await resolveActivationTarget(pool, selection);
    if (resolution.kind !== "selected") {
      return {
        ...resolution,
        ...(absorbedAccountId ? { absorbedAccountId } : {}),
      };
    }

    const backupPath = await backupNativeCredentialFile({
      kilnHome: this.kilnHome,
      targetId: NATIVE_CODEX_AUTH_BACKUP_TARGET_ID,
      filePath: nativeAuthPath,
      retain: NATIVE_CODEX_AUTH_BACKUP_RETENTION,
    });
    await writeNativeAuthFileAtomically(
      nativeAuthPath,
      toNativeCodexAuthFile(resolution.target.tokenFile, new Date().toISOString()),
    );
    const email = (await pool.listCredentialEmails()).get(resolution.target.id);
    return {
      kind: "activated",
      id: resolution.target.id,
      ...(email ? { email } : {}),
      ...(absorbedAccountId ? { absorbedAccountId } : {}),
      ...(backupPath ? { backupPath } : {}),
    };
  }

  async inspectStoredCredentials(): Promise<ProviderCredentialInspection> {
    const authDir = join(this.kilnHome, "auth");
    let entries: string[];
    try {
      entries = await readdir(authDir);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return emptyInspection();
      }
      throw error;
    }
    if (entries.length === 0) {
      return emptyInspection();
    }

    const providerFiles = entries.filter((entry) => entry.endsWith(".json") && !POOLED_PROVIDER_AUTH_FILES.has(entry));
    const providerDirs = entries.filter((entry) => !entry.endsWith(".json"));
    if (providerFiles.length === 0 && providerDirs.length === 0) {
      return emptyInspection();
    }
    const legacyProviders: LegacyProviderCredentialStatus[] = [];
    for (const file of providerFiles) {
      legacyProviders.push(await inspectLegacyProviderCredential(join(authDir, file), file));
    }
    const permissionFindings = (await listOverPermissiveCredentialFiles({ rootDir: authDir })).map((finding) => ({
      ...finding,
      repairPath: join(authDir, finding.relativePath),
    }));

    return {
      hasStoredEntries: true,
      hasOpenCodePool: providerDirs.includes(DIRECT_OPENCODE_AUTH_DIR),
      hasCodexOAuthPool: providerDirs.includes(CODEX_OAUTH_AUTH_DIR),
      legacyProviders,
      permissionFindings,
    };
  }
}

async function absorbCurrentNativeAccount(
  pool: CodexOAuthCredentialPoolService,
  nativeAuthPath: string,
): Promise<string | undefined> {
  let raw: string;
  try {
    raw = await readFile(nativeAuthPath, "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
  const native = parseNativeCodexAuthFile(parsed);
  if (!native) return undefined;
  await pool.linkCredential({ tokenFile: fromNativeCodexAuthFile(native) });
  return native.tokens.account_id ?? undefined;
}

async function resolveActivationTarget(
  pool: CodexOAuthCredentialPoolService,
  selection: CodexNativeActivationSelection,
): Promise<CodexActivationResolution> {
  if (selection.kind === "explicit") {
    const tokenFile = await pool.ensureCredentialIdToken(selection.id);
    if (!tokenFile) return { kind: "unknown-credential", id: selection.id };
    return tokenFile.id_token
      ? { kind: "selected", target: { id: selection.id, tokenFile: { ...tokenFile, id_token: tokenFile.id_token } } }
      : { kind: "no-activatable-credential", blockedIds: [selection.id] };
  }

  const [usage, status] = await Promise.all([pool.refreshUsage(), pool.listStatus()]);
  const executableIds = new Set(
    status.filter((entry) => entry.status === "valid" || entry.status === "expiring-soon").map((entry) => entry.id),
  );
  const ranked = usage
    .filter((entry) => executableIds.has(entry.credentialId) && entry.availability === "available")
    .sort((left, right) => (left.primary?.usedPercent ?? 0) - (right.primary?.usedPercent ?? 0));
  if (ranked.length === 0) return { kind: "no-available-credential" };

  const blockedIds: string[] = [];
  for (const candidate of ranked) {
    const tokenFile = await pool.ensureCredentialIdToken(candidate.credentialId);
    if (tokenFile?.id_token) {
      return {
        kind: "selected",
        target: {
          id: candidate.credentialId,
          tokenFile: { ...tokenFile, id_token: tokenFile.id_token },
        },
      };
    }
    blockedIds.push(candidate.credentialId);
  }
  return { kind: "no-activatable-credential", blockedIds };
}

async function writeNativeAuthFileAtomically(
  nativeAuthPath: string,
  native: NativeCodexAuthFile,
): Promise<void> {
  await mkdir(dirname(nativeAuthPath), { recursive: true });
  const tempPath = join(dirname(nativeAuthPath), `.auth.json.${randomBytes(8).toString("hex")}.tmp`);
  let renamed = false;
  try {
    await writeFile(tempPath, `${JSON.stringify(native, null, 2)}\n`, {
      encoding: "utf8",
      mode: CREDENTIAL_FILE_MODE,
    });
    await rename(tempPath, nativeAuthPath);
    renamed = true;
  } finally {
    if (!renamed) await rm(tempPath, { force: true });
  }
}

async function backupNativeCredentialFile(input: {
  readonly kilnHome: string;
  readonly targetId: string;
  readonly filePath: string;
  readonly retain: number;
}): Promise<string | undefined> {
  let bytes: Buffer;
  try {
    bytes = await readFile(input.filePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
  const sourceName = basename(input.filePath);
  const backupDir = join(input.kilnHome, "backups", input.targetId);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${timestamp}-${sourceName}.bak`);
  await mkdir(backupDir, { recursive: true });
  await writeFile(backupPath, bytes, { mode: CREDENTIAL_FILE_MODE });
  const backups = (await readdir(backupDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(`-${sourceName}.bak`))
    .map((entry) => entry.name)
    .sort();
  for (const name of backups.slice(0, Math.max(0, backups.length - input.retain))) {
    await rm(join(backupDir, name), { force: true });
  }
  return backupPath;
}

async function inspectLegacyProviderCredential(
  path: string,
  fileName: string,
): Promise<LegacyProviderCredentialStatus> {
  const provider = fileName.slice(0, -".json".length);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return { provider, status: "unreadable" };
  }
  if (!parsed) {
    return { provider, status: "unreadable" };
  }
  if (!isRecord(parsed) || typeof parsed.expires_at !== "string") {
    return { provider, status: "unknown" };
  }
  return {
    provider,
    status: describeExpiry(parsed.expires_at),
    expiresAt: parsed.expires_at,
  };
}

function describeExpiry(expiresAt: string): "unknown" | "expired" | "expiring soon" | "valid" {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) return "unknown";
  if (expiresAtMs <= Date.now()) return "expired";
  if (expiresAtMs <= Date.now() + EXPIRING_SOON_MS) return "expiring soon";
  return "valid";
}

function resolveNativeCodexHome(): string {
  return process.env.CODEX_HOME?.trim() || join(homedir(), ".codex");
}

function emptyInspection(): ProviderCredentialInspection {
  return {
    hasStoredEntries: false,
    hasOpenCodePool: false,
    hasCodexOAuthPool: false,
    legacyProviders: [],
    permissionFindings: [],
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
