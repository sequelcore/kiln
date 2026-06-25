import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface CliMemoryStorageOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly platform?: NodeJS.Platform;
  readonly homeDir?: string;
}

export interface CliMemoryStorageResolution {
  readonly projectRoot: string;
  readonly projectKey: string;
  readonly stateDir: string;
  readonly memoryDbPath: string;
}

export function resolveCliMemoryStorage(
  projectPath: string,
  options: CliMemoryStorageOptions = {},
): CliMemoryStorageResolution {
  const projectRoot = normalizeProjectRoot(projectPath);
  const projectKey = buildProjectKey(projectRoot);
  const stateDir = join(resolveKilnStateHome(options), "memory", "projects", projectKey);
  return {
    projectRoot,
    projectKey,
    stateDir,
    memoryDbPath: join(stateDir, "memory.db"),
  };
}

function buildProjectKey(projectRoot: string): string {
  const slug = basename(projectRoot).replace(/[^a-zA-Z0-9._-]+/g, "-") || "project";
  const digest = createHash("sha256").update(projectRoot.toLowerCase()).digest("hex").slice(0, 16);
  return `${slug}-${digest}`;
}

function normalizeProjectRoot(projectPath: string): string {
  return resolve(projectPath);
}

function resolveKilnStateHome(options: CliMemoryStorageOptions): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir();

  if (env.KILN_STATE_HOME && env.KILN_STATE_HOME.trim().length > 0) {
    return join(env.KILN_STATE_HOME, "kiln");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? (home ? join(home, "AppData", "Local") : undefined);
    return join(localAppData ?? ".", "Kiln");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Kiln");
  }
  if (env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim().length > 0) {
    return join(env.XDG_STATE_HOME, "kiln");
  }
  return join(home, ".local", "state", "kiln");
}
