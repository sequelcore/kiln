// Engine domain: tool environment detection for Phase 9a (native runtime)

export interface BinaryInfo {
  readonly path: string;
  readonly version: string;
}

export interface ToolEnvironment {
  readonly rg?: BinaryInfo;
  readonly fd?: BinaryInfo;
  readonly jq?: BinaryInfo;
  readonly git?: BinaryInfo;
  readonly bash?: BinaryInfo;
}

export interface ToolEnvironmentOptions {
  readonly searchPaths?: readonly string[];
  readonly commandExecutor?: ToolEnvironmentCommandExecutor;
  readonly detectionTimeoutMs?: number;
  readonly platform?: NodeJS.Platform;
}

export interface ToolEnvironmentCommandResult {
  readonly stdout: string;
}

export type ToolEnvironmentCommandExecutor = (
  command: string,
  args: readonly string[],
  searchPaths?: readonly string[],
  timeoutMs?: number,
) => Promise<ToolEnvironmentCommandResult>;

const TOOL_NAMES = ["rg", "fd", "jq", "git", "bash"] as const;
const DEFAULT_DETECTION_TIMEOUT_MS = 1_500;

/**
 * Process-wide cache. The first successful detection result is reused for all subsequent calls.
 * Options (e.g. searchPaths) are only applied on the first invocation.
 * Call clearToolEnvironmentCache() to reset (e.g. in tests or after PATH changes).
 */
let cachedToolEnvironment: ToolEnvironment | undefined;

const unavailableCommandExecutor: ToolEnvironmentCommandExecutor = async () => {
  throw new Error("Tool environment detection requires a Runtime-owned command executor");
};

async function detectBinary(
  name: (typeof TOOL_NAMES)[number],
  searchPaths?: readonly string[],
  commandExecutor: ToolEnvironmentCommandExecutor = unavailableCommandExecutor,
  detectionTimeoutMs: number = DEFAULT_DETECTION_TIMEOUT_MS,
  platform: NodeJS.Platform = "linux",
): Promise<BinaryInfo | undefined> {
  try {
    const locator = platform === "win32" ? "where" : "which";
    const locationResult = await commandExecutor(locator, [name], searchPaths, detectionTimeoutMs);
    const paths = locationResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const path of paths) {
      try {
        const versionResult = await commandExecutor(path, ["--version"], searchPaths, detectionTimeoutMs);
        const version = versionResult.stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line.length > 0);

        if (version) {
          return { path, version };
        }
      } catch {
        continue;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}

export async function detectToolEnvironment(
  options: ToolEnvironmentOptions = {},
): Promise<ToolEnvironment> {
  if (cachedToolEnvironment) {
    return cachedToolEnvironment;
  }

  const commandExecutor = options.commandExecutor ?? unavailableCommandExecutor;
  const detectionTimeoutMs = options.detectionTimeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  const platform = options.platform ?? "linux";
  const [rg, fd, jq, git, bash] = await Promise.all([
    detectBinary("rg", options.searchPaths, commandExecutor, detectionTimeoutMs, platform),
    detectBinary("fd", options.searchPaths, commandExecutor, detectionTimeoutMs, platform),
    detectBinary("jq", options.searchPaths, commandExecutor, detectionTimeoutMs, platform),
    detectBinary("git", options.searchPaths, commandExecutor, detectionTimeoutMs, platform),
    detectBinary("bash", options.searchPaths, commandExecutor, detectionTimeoutMs, platform),
  ]);

  const environment: ToolEnvironment = {
    ...(rg && { rg }),
    ...(fd && { fd }),
    ...(jq && { jq }),
    ...(git && { git }),
    ...(bash && { bash }),
  };

  cachedToolEnvironment = environment;
  return environment;
}

export function clearToolEnvironmentCache(): void {
  cachedToolEnvironment = undefined;
}
