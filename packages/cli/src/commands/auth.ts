import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { OpenCodeAuth, type CodexOAuthTokenFile, type OpenCodeTier } from "@kilnai/core";
import {
  CodexOAuthCredentialPoolService,
  OpenCodeCredentialPoolService,
  startProviderAuthRequest,
} from "@kilnai/runtime";

const AUTH_DIR = join(homedir(), ".kiln", "auth");
const EXPIRING_SOON_MS = 120 * 1000;
const POOLED_PROVIDER_AUTH_FILES = new Set(["opencode.json", "codex-oauth.json"]);
const DIRECT_OPENCODE_AUTH_DIR = "opencode-api";

export async function runAuth(args: string[]): Promise<void> {
  const [subcommand, action] = args;

  try {
    if (!subcommand || subcommand === "help") {
      printUsage();
      return;
    }

    if (subcommand === "status") {
      await printAllProviderStatuses();
      return;
    }

    if (subcommand === "opencode") {
      switch (action ?? "link") {
        case "link":   await runOpenCodeLink(args.slice(2)); return;
        case "import": await runOpenCodeImport(args.slice(2)); return;
        case "status": await runOpenCodeStatus(args.slice(2)); return;
        case "logout": await runOpenCodeLogout(args.slice(2)); return;
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
        await runCodexLogin();
        return;
      case "status":
        await runCodexStatus();
        return;
      case "logout":
        await runCodexLogout();
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

async function runCodexLogin(): Promise<void> {
  const authRequest = await startProviderAuthRequest({
    provider: "codex-oauth",
    requestId: `cli-auth:${Date.now()}`,
  });
  if (!authRequest.ok) {
    console.log(authRequest.error);
    return;
  }
  if (authRequest.started) {
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

async function runCodexStatus(): Promise<void> {
  const pool = new CodexOAuthCredentialPoolService();
  const entries = await pool.listStatus();
  if (entries.length === 0) {
    console.log("Not authenticated");
    return;
  }
  console.log("Codex OAuth");
  for (const entry of entries) {
    console.log(`  ${entry.id}`);
    console.log(`    Token expiry: ${entry.expiresAt}`);
    console.log(`    Status: ${entry.status}`);
    if (entry.health) {
      console.log(`    Requests: ${entry.health.requestCount}`);
      console.log(`    Cooldown: ${entry.health.cooldownUntil ?? "none"}`);
    }
  }
}

async function runCodexLogout(): Promise<void> {
  await new CodexOAuthCredentialPoolService().clearCredentials();
  console.log("Logged out");
}

async function runOpenCodeLink(rest: string[]): Promise<void> {
  const options = parseOpenCodeOptions(rest);
  const id = options.id ?? `${options.tier}-primary`;
  const auth = new OpenCodeAuth();
  const pool = new OpenCodeCredentialPoolService();

  if (options.key) {
    const linked = await startProviderAuthRequest({
      provider: options.tier === "zen" ? "opencode-zen" : "opencode-go",
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

async function runOpenCodeImport(rest: string[]): Promise<void> {
  const options = parseOpenCodeOptions(rest, { allowKey: false });
  const id = options.id ?? `${options.tier}-primary`;
  const auth = new OpenCodeAuth();
  const pool = new OpenCodeCredentialPoolService();
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

async function runOpenCodeStatus(rest: string[] = []): Promise<void> {
  const options = parseOpenCodeFilterOptions(rest);
  const pool = new OpenCodeCredentialPoolService();
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

async function runOpenCodeLogout(rest: string[] = []): Promise<void> {
  const options = parseOpenCodeFilterOptions(rest);
  await new OpenCodeCredentialPoolService().clearCredentials(options);
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

async function printAllProviderStatuses(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(AUTH_DIR);
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
    await runOpenCodeStatus();
  }
  if (providerDirs.includes("codex-oauth")) {
    await runCodexStatus();
  }

  for (const file of providerFiles) {
    const tokenPath = join(AUTH_DIR, file);

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
  console.log("  kiln auth codex status");
  console.log("  kiln auth codex logout");
  console.log("  kiln auth opencode link [--tier go|zen] [--id <id>] [--key <key>]    Link OpenCode API key (imports from OpenCode config if present)");
  console.log("  kiln auth opencode import [--tier go|zen] [--id <id>]                Import OpenCode API key from native OpenCode config");
  console.log("  kiln auth opencode status [--tier go|zen] [--id <id>]                Show linked OpenCode credentials");
  console.log("  kiln auth opencode logout [--tier go|zen] [--id <id>]                Remove linked OpenCode credentials");
  console.log("  kiln auth status");
}
