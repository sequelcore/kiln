import { execFile as execFileCallback } from "node:child_process";
import {
  detectToolEnvironment,
  type GitCommandRunner,
  type OcrImageRunner,
  type ToolEnvironment,
  type ToolEnvironmentCommandExecutor,
} from "@kilnai/core/tools";

const DEFAULT_MAX_BUFFER = 2 * 1024 * 1024;

export async function runNativeCommand(
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  stdin?: string,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return await new Promise((resolveCommand, rejectCommand) => {
    const child = execFileCallback(
      binary,
      [...args],
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectCommand(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolveCommand({ stdout, stderr });
      },
    );
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}

export const runNativeGitCommand: GitCommandRunner = async (args, cwd, timeoutMs) =>
  runNativeCommand("git", args, cwd, timeoutMs);

export const runNativeTesseractOcr: OcrImageRunner = async (request) => {
  const result = await runCommandWithMaxBuffer(
    "tesseract",
    [request.path, "stdout", "-l", request.language],
    process.cwd(),
    60_000,
    10 * 1024 * 1024,
  );
  return { text: result.stdout.trim(), source: "tesseract" };
};

const runtimeEnvironmentCommandExecutor: ToolEnvironmentCommandExecutor = async (
  command,
  args,
  searchPaths,
  timeoutMs,
) => {
  const inheritedPath = process.env.PATH;
  const separator = process.platform === "win32" ? ";" : ":";
  const path =
    searchPaths && searchPaths.length > 0
      ? [...searchPaths, ...(inheritedPath ? [inheritedPath] : [])].join(separator)
      : inheritedPath;
  return await new Promise((resolveCommand, rejectCommand) => {
    execFileCallback(
      command,
      [...args],
      {
        env: { ...process.env, PATH: path },
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer: DEFAULT_MAX_BUFFER,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectCommand(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolveCommand({ stdout });
      },
    );
  });
};

export async function detectRuntimeToolEnvironment(): Promise<ToolEnvironment> {
  return detectToolEnvironment({
    commandExecutor: runtimeEnvironmentCommandExecutor,
    platform: process.platform,
  });
}

async function runCommandWithMaxBuffer(
  binary: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  maxBuffer: number,
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  return await new Promise((resolveCommand, rejectCommand) => {
    execFileCallback(
      binary,
      [...args],
      {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        maxBuffer,
      },
      (error, stdout, stderr) => {
        if (error) {
          rejectCommand(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolveCommand({ stdout, stderr });
      },
    );
  });
}
