import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  CREDENTIAL_FILE_MODE,
  OpenCodeAuth,
  type CodexOAuthTokenFile,
  type OpenCodeTier,
  type ProviderUsageSnapshot,
} from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  OpenCodeCredentialPoolService,
  listOverPermissiveCredentialFiles,
  startProviderAuthRequest,
} from "@kilnai/runtime";
import { resolveNativeHarnessDir } from "../config/native-harness-home.js";
import { resolveKilnHomePath } from "../config/global-config/path.js";
import { backupNativeProjectionFile } from "../config/native-projection-backup.js";
import {
  fromNativeCodexAuthFile,
  parseNativeCodexAuthFile,
  toNativeCodexAuthFile,
  type NativeCodexAuthFile,
} from "../config/codex-native-account-sync.js";

const EXPIRING_SOON_MS = 120 * 1000;
const NATIVE_CODEX_AUTH_BACKUP_TARGET_ID = "codex-native-auth";
/** Enough history to recover across a few bad switches without retaining token material indefinitely. */
const NATIVE_CODEX_AUTH_BACKUP_RETENTION = 5;
const POOLED_PROVIDER_AUTH_FILES = new Set(["opencode.json", "codex-oauth.json"]);
const DIRECT_OPENCODE_AUTH_DIR = "opencode-api";

export interface AuthCommandOptions {
  /** Canonical operator Kiln home supplied by CLI composition. */
  readonly kilnHome?: string;
}

function resolveAuthKilnHome(explicitKilnHome?: string): string {
  return explicitKilnHome?.trim() || resolveKilnHomePath();
}

function resolveAuthDirectory(kilnHome?: string): string {
  return join(resolveAuthKilnHome(kilnHome), "auth");
}

export async function runAuth(args: string[], options: AuthCommandOptions = {}): Promise<void> {
  const [subcommand, action] = args;
  const kilnHome = resolveAuthKilnHome(options.kilnHome);

  try {
    if (!subcommand || subcommand === "help") {
      printUsage();
      return;
    }

    if (subcommand === "status") {
      await printAllProviderStatuses(kilnHome);
      return;
    }

    if (subcommand === "opencode") {
      switch (action ?? "link") {
        case "link":   await runOpenCodeLink(args.slice(2), kilnHome); return;
        case "import": await runOpenCodeImport(args.slice(2), kilnHome); return;
        case "status": await runOpenCodeStatus(args.slice(2), kilnHome); return;
        case "logout": await runOpenCodeLogout(args.slice(2), kilnHome); return;
        case "help":   printUsage(); return;
        default:       printUsage(); return;
      }
    }

    if (subcommand !== "codex") {
      printUsage();
      return;
    }

    switch (action ?? "login") {
      case "login":
        await runCodexLogin(kilnHome);
        return;
      case "status":
        await runCodexStatus(args.slice(2), kilnHome);
        return;
      case "activate":
        await runCodexActivate(args.slice(2), kilnHome);
        return;
      case "logout":
        await runCodexLogout(args.slice(2), kilnHome);
        return;
      case "help":
        printUsage();
        return;
      default:
        printUsage();
        return;
    }
  } catch (error) {
    console.log(error instanceof Error ? error.message : String(error));
  }
}

async function runCodexLogin(kilnHome?: string): Promise<void> {
  const authRequest = await startProviderAuthRequest({
    provider: "codex-oauth",
    kilnHome,
    requestId: `cli-auth:${Date.now()}`,
    flow: "device_code",
  });
  if (!authRequest.ok) {
    console.log(authRequest.error);
    return;
  }
  if (authRequest.started?.method === "device_code") {
    console.log("Prerequisite: Enable device code auth in ChatGPT Settings > Security.");
    console.log("");
    console.log(`  1. Visit: ${authRequest.started.verificationUri}`);
    console.log(`  2. Enter code: ${authRequest.started.userCode}`);
    console.log("");
  }
  console.log("Waiting for sign-in... (Ctrl+C to cancel)");
  await authRequest.complete();
  console.log("Authenticated successfully");
}

async function runCodexStatus(rest: string[], kilnHome?: string): Promise<void> {
  const options = parseCodexStatusOptions(rest);
  const pool = new CodexOAuthCredentialPoolService({ kilnHome });
  const entries = await pool.listStatus();
  if (entries.length === 0) {
    console.log("Not authenticated");
    return;
  }
  const usage = options.usage ? await pool.refreshUsage() : [];
  // Emails are decoded from already-local token claims, never fetched from the provider,
  // and stay behind their own flag so they never merge into --usage's guarded output.
  const emails = options.emails ? await pool.listCredentialEmails() : new Map<string, string>();
  console.log("Codex OAuth");
  for (const entry of entries) {
    console.log(`  ${entry.id}`);
    const email = emails.get(entry.id);
    if (email) console.log(`    Email: ${email}`);
    console.log(`    Token expiry: ${entry.expiresAt}`);
    console.log(`    Status: ${entry.status}`);
    if (entry.invalidReason) {
      console.log(`    Reason: ${entry.invalidReason}`);
    }
    if (entry.health) {
      console.log(`    Requests: ${entry.health.requestCount}`);
      console.log(`    Cooldown: ${entry.health.cooldownUntil ?? "none"}`);
    }
    const entryUsage = usage.find((candidate) => candidate.credentialId === entry.id);
    if (entryUsage) {
      console.log(`    Usage: ${entryUsage.availability}${describeUsageCause(entryUsage)}`);
      if (entryUsage.plan) console.log(`    Plan: ${entryUsage.plan}`);
      if (entryUsage.primary) console.log(`    Primary: ${entryUsage.primary.usedPercent}%${entryUsage.primary.resetsAt ? ` (resets ${entryUsage.primary.resetsAt})` : ""}`);
      if (entryUsage.secondary) console.log(`    Secondary: ${entryUsage.secondary.usedPercent}%${entryUsage.secondary.resetsAt ? ` (resets ${entryUsage.secondary.resetsAt})` : ""}`);
      console.log(`    Usage observed: ${entryUsage.observedAt}`);
    }
  }
}

/**
 * Names why usage is unknown. Without this the operator cannot tell a provider
 * that reports nothing from a request that never succeeded.
 */
function describeUsageCause(usage: ProviderUsageSnapshot): string {
  if (usage.availability !== "unknown") return "";
  if (usage.source === "credential-unavailable") return " (credential unusable: re-authenticate)";
  if (usage.source === "provider-response-unusable") {
    return ` (provider response could not be interpreted${usage.httpStatus === undefined ? "" : `: HTTP ${usage.httpStatus}`})`;
  }
  if (usage.source === "provider-request-failed") {
    return usage.httpStatus === undefined
      ? " (usage request failed: no response)"
      : ` (usage request failed: HTTP ${usage.httpStatus})`;
  }
  return " (provider reported no usage)";
}

type CodexActivateSelection =
  | { readonly kind: "auto" }
  | { readonly kind: "explicit"; readonly id: string };

/**
 * A credential proven activatable: `id_token` is required by the type, so a
 * native auth file can never be written from a credential lacking one.
 */
interface CodexActivationTarget {
  readonly id: string;
  readonly tokenFile: CodexOAuthTokenFile & { readonly id_token: string };
}

/** Distinguishes "nothing had quota" from "something had quota but could not be made activatable". */
type CodexActivationOutcome =
  | { readonly kind: "selected"; readonly target: CodexActivationTarget }
  | { readonly kind: "unknown-credential"; readonly id: string }
  | { readonly kind: "no-available-credential" }
  | { readonly kind: "no-activatable-credential"; readonly blockedIds: readonly string[] };

async function runCodexActivate(rest: string[], kilnHome?: string): Promise<void> {
  const selection = parseCodexActivateOptions(rest);
  const pool = new CodexOAuthCredentialPoolService({ kilnHome });
  const nativeAuthPath = join(resolveNativeHarnessDir("codex"), "auth.json");

  const absorbedAccountId = await absorbCurrentNativeAccount(pool, nativeAuthPath);
  if (absorbedAccountId) {
    console.log(`Absorbed currently active native Codex account (${absorbedAccountId}) into the Kiln pool.`);
  }

  const outcome = await resolveActivationTarget(pool, selection);
  if (outcome.kind !== "selected") {
    console.log(describeActivationFailure(outcome));
    return;
  }
  const target = outcome.target;

  const backupPath = backupNativeProjectionFile({
    kilnDir: resolveAuthKilnHome(kilnHome),
    targetId: NATIVE_CODEX_AUTH_BACKUP_TARGET_ID,
    filePath: nativeAuthPath,
    retain: NATIVE_CODEX_AUTH_BACKUP_RETENTION,
    mode: CREDENTIAL_FILE_MODE,
  });
  if (backupPath) {
    console.log(`Backed up previous native Codex auth to ${backupPath}`);
  }

  await writeNativeAuthFileAtomically(nativeAuthPath, toNativeCodexAuthFile(target.tokenFile, new Date().toISOString()));

  const email = (await pool.listCredentialEmails()).get(target.id);
  console.log(`Activated Codex OAuth credential ${target.id}${email ? ` (${email})` : ""} in native Codex CLI/App.`);
}

function parseCodexActivateOptions(rest: string[]): CodexActivateSelection {
  const [only] = rest;
  if (rest.length !== 1 || !only) throw new Error("Usage: kiln auth codex activate <id> | --auto");
  if (only === "--auto") return { kind: "auto" };
  if (only.startsWith("-")) throw new Error("Usage: kiln auth codex activate <id> | --auto");
  return { kind: "explicit", id: only };
}

/** Never fails the activation flow; a missing or unreadable native auth file just means nothing to absorb. */
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
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const native: NativeCodexAuthFile | null = parseNativeCodexAuthFile(parsed);
  if (!native) return undefined;
  await pool.linkCredential({ tokenFile: fromNativeCodexAuthFile(native) });
  return native.tokens.account_id ?? undefined;
}

async function resolveActivationTarget(
  pool: CodexOAuthCredentialPoolService,
  selection: CodexActivateSelection,
): Promise<CodexActivationOutcome> {
  if (selection.kind === "explicit") {
    const id = selection.id;
    const tokenFile = await pool.ensureCredentialIdToken(id);
    if (!tokenFile) return { kind: "unknown-credential", id };
    return tokenFile.id_token
      ? { kind: "selected", target: { id, tokenFile: { ...tokenFile, id_token: tokenFile.id_token } } }
      : { kind: "no-activatable-credential", blockedIds: [id] };
  }

  const [usage, status] = await Promise.all([pool.refreshUsage(), pool.listStatus()]);
  const executableIds = new Set(
    status.filter((entry) => entry.status === "valid" || entry.status === "expiring-soon").map((entry) => entry.id),
  );
  const ranked = usage
    .filter((entry) => executableIds.has(entry.credentialId) && entry.availability === "available")
    .sort((a, b) => (a.primary?.usedPercent ?? 0) - (b.primary?.usedPercent ?? 0));
  if (ranked.length === 0) return { kind: "no-available-credential" };

  const blockedIds: string[] = [];
  for (const candidate of ranked) {
    const tokenFile = await pool.ensureCredentialIdToken(candidate.credentialId);
    if (tokenFile?.id_token) {
      return {
        kind: "selected",
        target: { id: candidate.credentialId, tokenFile: { ...tokenFile, id_token: tokenFile.id_token } },
      };
    }
    blockedIds.push(candidate.credentialId);
  }
  return { kind: "no-activatable-credential", blockedIds };
}

function describeActivationFailure(outcome: Exclude<CodexActivationOutcome, { kind: "selected" }>): string {
  switch (outcome.kind) {
    case "unknown-credential":
      return `Unknown Codex OAuth credential: ${outcome.id}. Run 'kiln auth codex status' to list linked credentials.`;
    case "no-available-credential":
      return "No Codex OAuth credential currently has available quota. Run 'kiln auth codex status --usage' to see reset times.";
    case "no-activatable-credential":
      return `Native Codex CLI/App requires an id_token, and none could be recovered for: ${outcome.blockedIds.join(", ")}. Run 'kiln auth codex login' to relink ${outcome.blockedIds.length === 1 ? "this account" : "these accounts"}, then activate again.`;
  }
}

async function writeNativeAuthFileAtomically(nativeAuthPath: string, native: NativeCodexAuthFile): Promise<void> {
  await mkdir(dirname(nativeAuthPath), { recursive: true });
  const tempPath = join(dirname(nativeAuthPath), `.auth.json.${randomBytes(8).toString("hex")}.tmp`);
  let renamed = false;
  try {
    await writeFile(tempPath, `${JSON.stringify(native, null, 2)}\n`, { encoding: "utf8", mode: CREDENTIAL_FILE_MODE });
    await rename(tempPath, nativeAuthPath);
    renamed = true;
  } finally {
    if (!renamed) await rm(tempPath, { force: true });
  }
}

async function runCodexLogout(rest: string[], kilnHome?: string): Promise<void> {
  const id = parseCodexLogoutOptions(rest);
  const pool = new CodexOAuthCredentialPoolService({ kilnHome });
  if (id) {
    await pool.removeCredential(id);
    console.log(`Logged out of Codex credential ${id}`);
    return;
  }
  await pool.clearCredentials();
  console.log("Logged out of all Codex credentials");
}

interface CodexStatusOptions {
  readonly usage: boolean;
  readonly emails: boolean;
}

function parseCodexStatusOptions(rest: string[]): CodexStatusOptions {
  const flags = new Set(rest);
  const recognized = new Set(["--usage", "--emails"]);
  if (rest.length !== flags.size || [...flags].some((flag) => !recognized.has(flag))) {
    throw new Error("Usage: kiln auth codex status [--usage] [--emails]");
  }
  return { usage: flags.has("--usage"), emails: flags.has("--emails") };
}

function parseCodexLogoutOptions(rest: string[]): string | undefined {
  if (rest.length === 0) return undefined;
  if (rest.length === 2 && rest[0] === "--id" && rest[1]?.trim()) return rest[1];
  throw new Error("Usage: kiln auth codex logout [--id <id>]");
}

async function runOpenCodeLink(rest: string[], kilnHome?: string): Promise<void> {
  const options = parseOpenCodeOptions(rest);
  const id = options.id ?? `${options.tier}-primary`;
  const auth = new OpenCodeAuth({ kilnHome });
  const pool = new OpenCodeCredentialPoolService({ kilnHome });

  if (options.key) {
    const linked = await startProviderAuthRequest({
      provider: options.tier === "zen" ? "opencode-zen" : "opencode-go",
      kilnHome,
      requestId: `cli-auth:${Date.now()}`,
      apiKey: options.key,
      tier: options.tier,
      credentialId: id,
    });
    if (!linked.ok) {
      console.log(linked.error);
      return;
    }
    await linked.complete();
    console.log(`Linked OpenCode (${options.tier}) as ${id} from --key`);
    return;
  }

  const imported = await auth.readFromOpenCodeConfig({ tier: options.tier });
  if (imported) {
    await pool.linkCredential({
      id,
      apiKey: imported.api_key,
      tier: imported.tier,
      createdAt: imported.created_at,
    });
    console.log(`Linked OpenCode (${options.tier}) as ${id} from OpenCode config`);
    return;
  }

  console.log("Get your API key from https://opencode.ai/auth");
  console.log("Paste it below and press Enter:");
  const key = (await readLineFromStdin()).trim();
  if (!key) {
    console.log("No key provided. Aborted.");
    return;
  }
  const linked = await startProviderAuthRequest({
    provider: options.tier === "zen" ? "opencode-zen" : "opencode-go",
    kilnHome,
    requestId: `cli-auth:${Date.now()}`,
    apiKey: key,
    tier: options.tier,
    credentialId: id,
  });
  if (!linked.ok) {
    console.log(linked.error);
    return;
  }
  await linked.complete();
  console.log(`Linked OpenCode (${options.tier}) as ${id}`);
}

async function runOpenCodeImport(rest: string[], kilnHome?: string): Promise<void> {
  const options = parseOpenCodeOptions(rest, { allowKey: false });
  const id = options.id ?? `${options.tier}-primary`;
  const auth = new OpenCodeAuth({ kilnHome });
  const pool = new OpenCodeCredentialPoolService({ kilnHome });
  const imported = await auth.readFromOpenCodeConfig({ tier: options.tier });
  if (!imported) {
    console.log(`No OpenCode ${options.tier} API key found in OpenCode config`);
    return;
  }
  await pool.linkCredential({
    id,
    apiKey: imported.api_key,
    tier: imported.tier,
    createdAt: imported.created_at,
  });
  console.log(`Imported OpenCode (${options.tier}) as ${id} from OpenCode config`);
}

async function runOpenCodeStatus(rest: string[] = [], kilnHome?: string): Promise<void> {
  const options = parseOpenCodeFilterOptions(rest);
  const pool = new OpenCodeCredentialPoolService({ kilnHome });
  const entries = (await pool.listStatus()).filter((entry) => {
    if (options.tier !== undefined && entry.tier !== options.tier) {
      return false;
    }
    if (options.id !== undefined && entry.id !== options.id) {
      return false;
    }
    return true;
  });
  if (entries.length === 0) {
    console.log(options.tier || options.id ? "No matching OpenCode credentials" : "Not authenticated");
    return;
  }
  console.log("OpenCode");
  console.log(formatStatusRow(["Name", "Tier", "Requests", "Health"]));
  for (const entry of entries) {
    console.log(formatStatusRow([
      entry.id,
      entry.tier,
      String(entry.health?.requestCount ?? 0),
      describeCredentialHealth(entry.health),
    ]));
    console.log(`  Linked at: ${entry.createdAt}`);
    console.log(`  Key: ${entry.key}`);
  }
}

async function runOpenCodeLogout(rest: string[] = [], kilnHome?: string): Promise<void> {
  const options = parseOpenCodeFilterOptions(rest);
  await new OpenCodeCredentialPoolService({ kilnHome }).clearCredentials(options);
  if (!options.tier && !options.id) {
    console.log("Logged out of OpenCode");
    return;
  }
  console.log(`Logged out of OpenCode credentials matching ${describeOpenCodeCredentialFilter(options)}`);
}

interface OpenCodeCliOptions {
  readonly tier: OpenCodeTier;
  readonly id?: string;
  readonly key?: string;
}

interface OpenCodeCredentialFilter {
  readonly tier?: OpenCodeTier;
  readonly id?: string;
}

function parseOpenCodeOptions(
  args: readonly string[],
  options: { readonly allowKey?: boolean } = {},
): OpenCodeCliOptions {
  const allowKey = options.allowKey ?? true;
  const tier = parseTierOption(args) ?? "go";
  const id = parseValueFlag(args, "--id", "-i");
  const key = allowKey ? parseValueFlag(args, "--key", "-k") : undefined;
  return { tier, id, key };
}

function parseOpenCodeFilterOptions(args: readonly string[]): OpenCodeCredentialFilter {
  return {
    tier: parseTierOption(args),
    id: parseValueFlag(args, "--id", "-i"),
  };
}

function parseTierOption(args: readonly string[]): OpenCodeTier | undefined {
  const value = parseValueFlag(args, "--tier", "-t");
  if (value === undefined) {
    return undefined;
  }
  if (value !== "go" && value !== "zen") {
    throw new Error(`Invalid OpenCode tier '${value}'. Expected 'go' or 'zen'.`);
  }
  return value;
}

function parseValueFlag(args: readonly string[], longName: string, shortName: string): string | undefined {
  const idx = args.findIndex((arg) => arg === longName || arg === shortName);
  if (idx < 0) {
    return undefined;
  }
  const value = args[idx + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${longName} requires a value`);
  }
  return value;
}

function describeOpenCodeCredentialFilter(filter: OpenCodeCredentialFilter): string {
  const parts: string[] = [];
  if (filter.tier) {
    parts.push(`tier ${filter.tier}`);
  }
  if (filter.id) {
    parts.push(`id ${filter.id}`);
  }
  return parts.join(" and ");
}

function readLineFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    process.stdin.setEncoding("utf8");
    process.stdin.once("data", (chunk) => {
      const data = chunk.toString();
      const nl = data.indexOf("\n");
      resolve(nl >= 0 ? data.slice(0, nl) : data);
    });
  });
}

async function printAllProviderStatuses(kilnHome?: string): Promise<void> {
  const authDir = resolveAuthDirectory(kilnHome);
  let entries: string[];
  try {
    entries = await readdir(authDir);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? (error as { code?: string }).code : undefined;
    if (code === "ENOENT") {
      console.log("No authenticated providers");
      return;
    }
    throw error;
  }

  const providerFiles = entries.filter((entry) => entry.endsWith(".json") && !POOLED_PROVIDER_AUTH_FILES.has(entry));
  const providerDirs = entries.filter((entry) => !entry.endsWith(".json"));
  if (providerFiles.length === 0 && providerDirs.length === 0) {
    console.log("No authenticated providers");
    return;
  }

  if (providerDirs.includes(DIRECT_OPENCODE_AUTH_DIR)) {
    await runOpenCodeStatus([], kilnHome);
  }
  if (providerDirs.includes("codex-oauth")) {
    await runCodexStatus([], kilnHome);
  }

  for (const file of providerFiles) {
    const tokenPath = join(authDir, file);

    const provider = file.slice(0, -".json".length);
    const tokenFile = await loadGenericTokenFile(tokenPath);
    if (!tokenFile) {
      console.log(`${provider}: unreadable`);
      continue;
    }

    const expiry = typeof tokenFile.expires_at === "string" ? tokenFile.expires_at : "unknown";
    const status = typeof tokenFile.expires_at === "string"
      ? describeExpiry(tokenFile.expires_at)
      : "unknown";
    console.log(`${provider}: ${status}${expiry === "unknown" ? "" : ` (expires ${expiry})`}`);
  }

  await printCredentialPermissionWarnings(kilnHome);
}

/**
 * Store-wide finding, so it belongs on the store-wide command rather than being
 * repeated by each provider status.
 */
async function printCredentialPermissionWarnings(kilnHome?: string): Promise<void> {
  const authDir = resolveAuthDirectory(kilnHome);
  const findings = await listOverPermissiveCredentialFiles({ rootDir: authDir });
  if (findings.length === 0) return;
  console.log("");
  console.log("Warning: credential files readable beyond their owner:");
  for (const finding of findings) {
    console.log(`  ${finding.relativePath} (mode ${finding.mode})`);
  }
  console.log("These repair themselves the next time Kiln writes them. To fix now:");
  console.log(`  chmod 600 ${findings.map((finding) => `${authDir}/${finding.relativePath}`).join(" ")}`);
}

async function loadGenericTokenFile(path: string): Promise<Partial<CodexOAuthTokenFile> | null> {
  try {
    const contents = await readFile(path, "utf8");
    return JSON.parse(contents) as Partial<CodexOAuthTokenFile>;
  } catch {
    return null;
  }
}

function describeExpiry(expiresAt: string): string {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return "unknown";
  }
  if (expiresAtMs <= Date.now()) {
    return "expired";
  }
  if (expiresAtMs <= Date.now() + EXPIRING_SOON_MS) {
    return "expiring soon";
  }
  return "valid";
}

function describeCredentialHealth(
  health: { readonly lastExhausted?: number | null; readonly cooldownUntil: number | null } | undefined,
): "ok" | "cooling" | "exhausted" {
  if (!health?.cooldownUntil || health.cooldownUntil <= Date.now()) {
    return "ok";
  }
  return health.lastExhausted === null || health.lastExhausted === undefined ? "cooling" : "exhausted";
}

function formatStatusRow(cells: readonly string[]): string {
  const widths = [24, 8, 10, 10];
  return `  ${cells.map((cell, index) => cell.padEnd(widths[index] ?? 10)).join("  ").trimEnd()}`;
}

function printUsage(): void {
  console.log("Usage: kiln auth <subcommand>");
  console.log("  kiln auth codex login");
  console.log("  kiln auth codex status [--usage] [--emails]");
  console.log("  kiln auth codex activate <id> | --auto                              Point native Codex CLI/App at a pooled account (backs up the previous one)");
  console.log("  kiln auth codex logout [--id <id>]");
  console.log("  kiln auth opencode link [--tier go|zen] [--id <id>] [--key <key>]    Link OpenCode API key (imports from OpenCode config if present)");
  console.log("  kiln auth opencode import [--tier go|zen] [--id <id>]                Import OpenCode API key from native OpenCode config");
  console.log("  kiln auth opencode status [--tier go|zen] [--id <id>]                Show linked OpenCode credentials");
  console.log("  kiln auth opencode logout [--tier go|zen] [--id <id>]                Remove linked OpenCode credentials");
  console.log("  kiln auth status");
}
