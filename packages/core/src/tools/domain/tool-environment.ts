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
}

export interface ToolEnvironmentOptions {
  readonly searchPaths?: readonly string[];
  readonly commandExecutor?: ToolEnvironmentCommandExecutor;
}

interface CommandResult {
  readonly stdout: string;
}

export type ToolEnvironmentCommandExecutor = (
  command: string,
  args: readonly string[],
  searchPaths?: readonly string[],
) => Promise<CommandResult>;

const TOOL_NAMES = ["rg", "fd", "jq", "git"] as const;

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
  callback: (error: Error | null, result?: CommandResult) => void,
): void {
  const child = spawn(command, [...args], {
    env: {
      ...process.env,
      PATH: buildPath(searchPaths),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";

  child.stdout.on("data", (chunk: Buffer | string) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    callback(error);
  });

  child.on("close", (exitCode) => {
    if (exitCode !== 0) {
      callback(new Error(stderr.trim() || `Command failed: ${command}`));
      return;
    }

    callback(null, { stdout });
  });
}

const executeCommandAsync = promisify(executeCommand);

const defaultCommandExecutor: ToolEnvironmentCommandExecutor = async (command, args, searchPaths) =>
  await executeCommandAsync(command, args, searchPaths) as CommandResult;

async function detectBinary(
  name: (typeof TOOL_NAMES)[number],
  searchPaths?: readonly string[],
  commandExecutor: ToolEnvironmentCommandExecutor = defaultCommandExecutor,
): Promise<BinaryInfo | undefined> {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const locationResult = await commandExecutor(locator, [name], searchPaths);
    const paths = locationResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    for (const path of paths) {
      try {
        const versionResult = await commandExecutor(path, ["--version"], searchPaths);
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
  const [rg, fd, jq, git] = await Promise.all([
    detectBinary("rg", options.searchPaths, commandExecutor),
    detectBinary("fd", options.searchPaths, commandExecutor),
    detectBinary("jq", options.searchPaths, commandExecutor),
    detectBinary("git", options.searchPaths, commandExecutor),
  ]);

  const environment: ToolEnvironment = {
    ...(rg && { rg }),
    ...(fd && { fd }),
    ...(jq && { jq }),
    ...(git && { git }),
  };

  cachedToolEnvironment = environment;
  return environment;
}

export function clearToolEnvironmentCache(): void {
  cachedToolEnvironment = undefined;
}
