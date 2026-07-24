import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Resolves the directory each native harness writer targets, matching the
 * exact env var each harness's own CLI honors for its config/state home:
 * `CLAUDE_CONFIG_DIR` (Claude Code), `CODEX_HOME` (Codex), and
 * `OPENCODE_CONFIG_DIR` (OpenCode). Without this, Kiln's native projection
 * writers always targeted `os.homedir()` even when an operator had
 * redirected a harness elsewhere (multiple profiles, isolated test/sandbox
 * homes), so Kiln silently wrote to a location the harness never read from.
 */
export type NativeHarnessId = "claude" | "codex" | "opencode";

const HARNESS_HOME_ENV_VAR: Record<NativeHarnessId, string> = {
  claude: "CLAUDE_CONFIG_DIR",
  codex: "CODEX_HOME",
  opencode: "OPENCODE_CONFIG_DIR",
};

const HARNESS_DEFAULT_SUBPATH: Record<NativeHarnessId, readonly string[]> = {
  claude: [".claude"],
  codex: [".codex"],
  opencode: [".config", "opencode"],
};

/**
 * Resolve the directory Kiln should read/write for one native harness.
 *
 * Precedence:
 * 1. `userHome` — an explicit isolation root (tests, sandboxes). When set,
 *    every harness is joined under this single directory so callers get one
 *    predictable, ambient-environment-independent sandbox.
 * 2. The harness's own env var override — the same variable its real CLI
 *    reads, so Kiln never targets a path the harness itself won't use.
 * 3. The OS home directory, matching each harness's own default.
 */
export function resolveNativeHarnessDir(harness: NativeHarnessId, userHome?: string): string {
  if (userHome !== undefined) {
    return join(userHome, ...HARNESS_DEFAULT_SUBPATH[harness]);
  }
  const envOverride = process.env[HARNESS_HOME_ENV_VAR[harness]]?.trim();
  if (envOverride) {
    return envOverride;
  }
  return join(homedir(), ...HARNESS_DEFAULT_SUBPATH[harness]);
}
