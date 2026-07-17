import { execFileSync } from "node:child_process";

export interface ResolveNativeCliExecutableInput {
  readonly command: string;
  readonly fallbackPaths: readonly string[];
  readonly platform?: NodeJS.Platform;
  readonly discoveredPaths?: readonly string[];
  readonly verify?: (executable: string) => boolean;
}

export function resolveNativeCliExecutable(input: ResolveNativeCliExecutableInput): string {
  const platform = input.platform ?? process.platform;
  const discoveredPaths = input.discoveredPaths ?? discoverExecutablePaths(input.command, platform);
  const candidates = platform === "win32"
    ? unique([...input.fallbackPaths, ...discoveredPaths]).filter(isSpawnableWindowsExecutable)
    : unique([input.command, ...discoveredPaths, ...input.fallbackPaths]);
  const verify = input.verify ?? verifyExecutable;

  for (const candidate of candidates) {
    if (verify(candidate)) {
      return candidate;
    }
  }

  if (platform === "win32" && unique([...input.fallbackPaths, ...discoveredPaths]).some(isWindowsCommandShim)) {
    throw new Error(
      `${input.command} requires a native Windows executable; PATH exposes only .cmd/.bat shims that cannot be launched safely by the runtime.`,
    );
  }
  throw new Error(`${input.command} executable not found or not runnable.`);
}

function discoverExecutablePaths(command: string, platform: NodeJS.Platform): readonly string[] {
  if (platform !== "win32") {
    return [];
  }
  try {
    return execFileSync("where.exe", [command], { encoding: "utf8", windowsHide: true })
      .split(/\r?\n/u)
      .map((path) => path.trim())
      .filter((path) => path.length > 0);
  } catch {
    return [];
  }
}

function verifyExecutable(executable: string): boolean {
  try {
    execFileSync(executable, ["--version"], { stdio: "ignore", windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function isSpawnableWindowsExecutable(path: string): boolean {
  return /\.(?:exe|com)$/iu.test(path);
}

function isWindowsCommandShim(path: string): boolean {
  return /\.(?:cmd|bat)$/iu.test(path);
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
