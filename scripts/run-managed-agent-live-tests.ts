import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import {
  KILN_LIVE_CODEX_MODEL,
  KILN_LIVE_CODEX_TESTS_ENV,
  KILN_LIVE_CLAUDE_TESTS_ENV,
  KILN_LIVE_OPENCODE_MODEL,
  KILN_LIVE_OPENCODE_TESTS_ENV,
  evaluateManagedAgentLivePreflight,
  projectClaudeNativeEntitlementEnvironment,
} from "./managed-agent-live-preflight.js";

const detectedProviderFlags = detectLocalLiveProviderFlags();
const preflight = evaluateManagedAgentLivePreflight(process.env, detectedProviderFlags);

if (!preflight.ok) {
  console.error(preflight.message);
  process.exit(1);
}

console.log(preflight.message);
const childEnv = {
  ...(preflight.enabledProviders.includes(KILN_LIVE_CLAUDE_TESTS_ENV)
    ? projectClaudeNativeEntitlementEnvironment(process.env)
    : process.env),
  ...preflight.environment,
};

if (
  preflight.enabledProviders.includes(KILN_LIVE_CODEX_TESTS_ENV)
  && childEnv[KILN_LIVE_CODEX_MODEL] === undefined
) {
  childEnv[KILN_LIVE_CODEX_MODEL] = "gpt-5.3-codex-spark";
}

if (
  preflight.enabledProviders.includes(KILN_LIVE_OPENCODE_TESTS_ENV)
  && childEnv[KILN_LIVE_OPENCODE_MODEL] === undefined
) {
  childEnv[KILN_LIVE_OPENCODE_MODEL] = "opencode/minimax-m2.5-free";
}

const exitCode = await runLiveTests(childEnv);
process.exitCode = exitCode;

function detectLocalLiveProviderFlags(): readonly string[] {
  const detected: string[] = [];
  if (hasExecutable("codex") && existsSync(join(homedir(), ".codex", "auth.json"))) {
    detected.push(KILN_LIVE_CODEX_TESTS_ENV);
  }
  if (hasExecutable("claude") && hasClaudeCredential()) {
    detected.push(KILN_LIVE_CLAUDE_TESTS_ENV);
  }
  if (hasExecutable("opencode") && hasOpenCodeCredential()) {
    detected.push(KILN_LIVE_OPENCODE_TESTS_ENV);
  }
  return detected;
}

function hasOpenCodeCredential(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY)
    || existsSync(join(homedir(), ".local", "share", "opencode", "auth.json"));
}

function hasClaudeCredential(): boolean {
  const result = spawnSync("claude", ["auth", "status", "--json"], {
    encoding: "utf8",
    env: projectClaudeNativeEntitlementEnvironment(process.env),
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  });
  if (result.status !== 0 || typeof result.stdout !== "string") return false;
  try {
    const status = JSON.parse(result.stdout) as { readonly loggedIn?: unknown; readonly authMethod?: unknown };
    return status.loggedIn === true && status.authMethod === "claude.ai";
  } catch {
    return false;
  }
}

function hasExecutable(command: string): boolean {
  const lookup = process.platform === "win32" ? "where" : "command";
  const args = process.platform === "win32" ? [command] : ["-v", command];
  const result = spawnSync(lookup, args, { stdio: "ignore", shell: false, windowsHide: true });
  return result.status === 0;
}

function runLiveTests(env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["run", "--cwd", "packages/runtime", "test:live"], {
      env,
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    child.on("error", (error) => {
      console.error(`[test:managed-agents:live] failed to start Bun: ${error.message}`);
      resolve(1);
    });
    child.on("exit", (code) => resolve(code ?? 1));
  });
}
