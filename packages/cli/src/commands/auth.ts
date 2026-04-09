import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexOAuthAuth, type CodexOAuthTokenFile } from "@kilnai/core";

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
  console.log(`Visit: ${authRequest.verificationUri}`);
  console.log(`Enter code: ${authRequest.userCode}`);
  const tokenFile = await auth.pollForAuthorization({
    deviceCode: authRequest.deviceCode,
    intervalSeconds: authRequest.intervalSeconds,
    codeVerifier: authRequest.codeVerifier,
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
    const provider = file.slice(0, -".json".length);
    const tokenPath = join(AUTH_DIR, file);
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
  console.log("  kiln auth status");
}
