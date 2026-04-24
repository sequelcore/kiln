import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexOAuthAuth, OpenCodeAuth, type CodexOAuthTokenFile, type OpenCodeTier } from "@kilnai/core";

const AUTH_DIR = join(homedir(), ".kiln", "auth");
const EXPIRING_SOON_MS = 120 * 1000;

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
        case "status": await runOpenCodeStatus(); return;
        case "logout": await runOpenCodeLogout(); return;
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
  const auth = new CodexOAuthAuth();
  const authRequest = await auth.startDeviceAuthorization();
  console.log("Prerequisite: Enable device code auth in ChatGPT Settings > Security.");
  console.log("");
  console.log("  1. Visit: https://auth.openai.com/codex/device");
  console.log(`  2. Enter code: ${authRequest.userCode}`);
  console.log("");
  console.log("Waiting for sign-in... (Ctrl+C to cancel)");
  const tokenFile = await auth.pollForAuthorization({
    deviceAuthId: authRequest.deviceAuthId,
    userCode: authRequest.userCode,
    intervalSeconds: authRequest.intervalSeconds,
  });
  await auth.saveTokenFile(tokenFile);
  console.log("Authenticated successfully");
}

async function runCodexStatus(): Promise<void> {
  const auth = new CodexOAuthAuth();
  const tokenFile = await auth.loadTokenFile();
  if (!tokenFile) {
    console.log("Not authenticated");
    return;
  }

  console.log(`Token expiry: ${tokenFile.expires_at}`);
  console.log(`Status: ${describeExpiry(tokenFile.expires_at)}`);
}

async function runCodexLogout(): Promise<void> {
  const auth = new CodexOAuthAuth();
  await auth.clearTokenFile();
  console.log("Logged out");
}

async function runOpenCodeLink(rest: string[]): Promise<void> {
  const tier = parseTier(rest);
  const explicitKey = parseKeyFlag(rest);
  const auth = new OpenCodeAuth();

  if (explicitKey) {
    await auth.saveAuthFile({ api_key: explicitKey, tier, created_at: new Date().toISOString() });
    console.log(`Linked OpenCode (${tier}) from --key`);
    return;
  }

  const imported = await auth.importFromOpenCodeConfig({ tier });
  if (imported) {
    console.log(`Linked OpenCode (${tier}) — imported key from OpenCode config`);
    return;
  }

  console.log("Get your API key from https://opencode.ai/auth");
  console.log("Paste it below and press Enter:");
  const key = (await readLineFromStdin()).trim();
  if (!key) {
    console.log("No key provided. Aborted.");
    return;
  }
  await auth.saveAuthFile({ api_key: key, tier, created_at: new Date().toISOString() });
  console.log(`Linked OpenCode (${tier})`);
}

async function runOpenCodeStatus(): Promise<void> {
  const auth = new OpenCodeAuth();
  const file = await auth.loadAuthFile();
  if (!file) {
    console.log("Not authenticated");
    return;
  }
  console.log(`Tier: ${file.tier}`);
  console.log(`Linked at: ${file.created_at}`);
  console.log(`Key: ${maskKey(file.api_key)}`);
}

async function runOpenCodeLogout(): Promise<void> {
  const auth = new OpenCodeAuth();
  await auth.clearAuthFile();
  console.log("Logged out of OpenCode");
}

function parseTier(args: readonly string[]): OpenCodeTier {
  const idx = args.findIndex((a) => a === "--tier" || a === "-t");
  const value = idx >= 0 ? args[idx + 1] : undefined;
  return value === "zen" ? "zen" : "go";
}

function parseKeyFlag(args: readonly string[]): string | null {
  const idx = args.findIndex((a) => a === "--key" || a === "-k");
  return idx >= 0 ? (args[idx + 1] ?? null) : null;
}

function maskKey(key: string): string {
  if (key.length <= 8) return "****";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
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

  const providerFiles = entries.filter((entry) => entry.endsWith(".json"));
  if (providerFiles.length === 0) {
    console.log("No authenticated providers");
    return;
  }

  for (const file of providerFiles) {
    const tokenPath = join(AUTH_DIR, file);

    if (file === "opencode.json") {
      const auth = new OpenCodeAuth({ tokenPath });
      const authFile = await auth.loadAuthFile();
      if (!authFile) {
        console.log("OpenCode: unreadable");
        continue;
      }
      console.log("OpenCode");
      console.log(`  Tier: ${authFile.tier}`);
      console.log(`  Linked at: ${authFile.created_at}`);
      continue;
    }

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

function printUsage(): void {
  console.log("Usage: kiln auth <subcommand>");
  console.log("  kiln auth codex login");
  console.log("  kiln auth codex status");
  console.log("  kiln auth codex logout");
  console.log("  kiln auth opencode link [--tier go|zen] [--key <key>]    Link OpenCode API key (imports from OpenCode config if present)");
  console.log("  kiln auth opencode status                                  Show linked OpenCode account");
  console.log("  kiln auth opencode logout                                  Remove linked OpenCode account");
  console.log("  kiln auth status");
}
