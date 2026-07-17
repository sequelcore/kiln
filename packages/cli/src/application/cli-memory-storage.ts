import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";

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
  const path = pathApi(options.platform ?? process.platform);
  const projectRoot = path.resolve(projectPath);
  const projectKey = buildProjectKey(projectRoot, path.basename(projectRoot));
  const stateDir = path.join(resolveKilnStateHome(options, path), "memory", "projects", projectKey);
  return {
    projectRoot,
    projectKey,
    stateDir,
    memoryDbPath: path.join(stateDir, "memory.db"),
  };
}

function buildProjectKey(projectRoot: string, projectName: string): string {
  const slug = projectName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "project";
  const digest = createHash("sha256").update(projectRoot.toLowerCase()).digest("hex").slice(0, 16);
  return `${slug}-${digest}`;
}

function pathApi(platform: NodeJS.Platform): typeof posix | typeof win32 {
  return platform === "win32" ? win32 : posix;
}

function resolveKilnStateHome(
  options: CliMemoryStorageOptions,
  path: typeof posix | typeof win32,
): string {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.homeDir ?? env.HOME ?? env.USERPROFILE ?? homedir();

  if (env.KILN_STATE_HOME && env.KILN_STATE_HOME.trim().length > 0) {
    return path.join(env.KILN_STATE_HOME, "kiln");
  }
  if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA ?? (home ? path.join(home, "AppData", "Local") : undefined);
    return path.join(localAppData ?? ".", "Kiln");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "Kiln");
  }
  if (env.XDG_STATE_HOME && env.XDG_STATE_HOME.trim().length > 0) {
    return path.join(env.XDG_STATE_HOME, "kiln");
  }
  return path.join(home, ".local", "state", "kiln");
}
