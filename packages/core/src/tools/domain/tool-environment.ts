// Engine domain: tool environment detection for Phase 9a (native runtime)

import { spawn } from "node:child_process";
import { promisify } from "node:util";

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
}

interface CommandResult {
  readonly stdout: string;
}

export type ToolEnvironmentCommandExecutor = (
  command: string,
  args: readonly string[],
  searchPaths?: readonly string[],
  timeoutMs?: number,
) => Promise<CommandResult>;

const TOOL_NAMES = ["rg", "fd", "jq", "git", "bash"] as const;
const DEFAULT_DETECTION_TIMEOUT_MS = 1_500;

/**
 * Process-wide cache. The first successful detection result is reused for all subsequent calls.
 * Options (e.g. searchPaths) are only applied on the first invocation.
 * Call clearToolEnvironmentCache() to reset (e.g. in tests or after PATH changes).
 */
let cachedToolEnvironment: ToolEnvironment | undefined;

function buildPath(searchPaths?: readonly string[]): string | undefined {
  if (!searchPaths || searchPaths.length === 0) {
    return process.env.PATH;
  }

  const separator = process.platform === "win32" ? ";" : ":";
  const inheritedPath = process.env.PATH ? [process.env.PATH] : [];
  return [...searchPaths, ...inheritedPath].join(separator);
}

function executeCommand(
  command: string,
  args: readonly string[],
  searchPaths: readonly string[] | undefined,
  timeoutMs: number | undefined,
  callback: (error: Error | null, result?: CommandResult) => void,
): void {
  let completed = false;
  const child = spawn(command, [...args], {
    env: {
      ...process.env,
      PATH: buildPath(searchPaths),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => {
    if (completed) return;
    completed = true;
    child.kill();
    callback(Object.assign(new Error(`Command timed out: ${command}`), { code: "ETIMEDOUT" }));
  }, timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS);

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    callback(error);
  });

  child.on("close", (exitCode) => {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    if (exitCode !== 0) {
      callback(new Error(stderr.trim() || `Command failed: ${command}`));
      return;
    }

    callback(null, { stdout });
  });
}

const executeCommandAsync = promisify(executeCommand);

const defaultCommandExecutor: ToolEnvironmentCommandExecutor = async (command, args, searchPaths, timeoutMs) =>
  await executeCommandAsync(command, args, searchPaths, timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS) as CommandResult;

async function detectBinary(
  name: (typeof TOOL_NAMES)[number],
  searchPaths?: readonly string[],
  commandExecutor: ToolEnvironmentCommandExecutor = defaultCommandExecutor,
  detectionTimeoutMs: number = DEFAULT_DETECTION_TIMEOUT_MS,
): Promise<BinaryInfo | undefined> {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
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

  const commandExecutor = options.commandExecutor ?? defaultCommandExecutor;
  const detectionTimeoutMs = options.detectionTimeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  const [rg, fd, jq, git, bash] = await Promise.all([
    detectBinary("rg", options.searchPaths, commandExecutor, detectionTimeoutMs),
    detectBinary("fd", options.searchPaths, commandExecutor, detectionTimeoutMs),
    detectBinary("jq", options.searchPaths, commandExecutor, detectionTimeoutMs),
    detectBinary("git", options.searchPaths, commandExecutor, detectionTimeoutMs),
    detectBinary("bash", options.searchPaths, commandExecutor, detectionTimeoutMs),
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
