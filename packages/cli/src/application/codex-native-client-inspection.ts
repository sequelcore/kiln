import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { CodexNativeCatalog } from "../config/global-codex-model-gateway-projection.js";
import { resolveNativeCliExecutable } from "../wrapper/native-cli-executable.js";

export interface CodexNativeClientInspection {
  readonly executable: string;
  readonly version: string;
  readonly nativeCatalog: CodexNativeCatalog;
}

export interface CodexNativeClientInspectionDependencies {
  readonly resolveExecutable?: () => string;
  readonly execute?: (executable: string, args: readonly string[]) => string;
}

export function inspectCodexNativeClient(
  dependencies: CodexNativeClientInspectionDependencies = {},
): CodexNativeClientInspection {
  const executable = (dependencies.resolveExecutable ?? resolveCodexExecutable)();
  const execute = dependencies.execute ?? executeCodex;
  let versionOutput: string;
  let catalogOutput: string;
  try {
    versionOutput = execute(executable, ["--version"]);
    catalogOutput = execute(executable, ["debug", "models", "--bundled"]);
  } catch {
    throw new Error("Codex native client inspection failed.");
  }
  const version = parseCodexNativeVersion(versionOutput);
  let parsed: unknown;
  try {
    parsed = JSON.parse(catalogOutput);
  } catch {
    throw new Error("Codex native model catalog was not valid JSON.");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.models) || parsed.models.length === 0) {
    throw new Error("Codex native model catalog was empty or malformed.");
  }
  return { executable, version, nativeCatalog: parsed as unknown as CodexNativeCatalog };
}

export function parseCodexNativeVersion(output: string): string {
  const match = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+)\r?\n?$/u.exec(output);
  if (!match) throw new Error("Codex native version output was malformed.");
  return match[1]!;
}

function resolveCodexExecutable(): string {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const appData = process.env.APPDATA ?? "";
  return resolveNativeCliExecutable({
    command: "codex",
    fallbackPaths: [
      ...(home ? [join(home, ".codex", "sandbox-bin", "codex.exe")] : []),
      ...(appData
        ? [
            join(
              appData,
              "npm",
              "node_modules",
              "@openai",
              "codex",
              "node_modules",
              "@openai",
              "codex-win32-x64",
              "vendor",
              "x86_64-pc-windows-msvc",
              "bin",
              "codex.exe",
            ),
          ]
        : []),
    ],
  });
}

function executeCodex(executable: string, args: readonly string[]): string {
  return execFileSync(executable, [...args], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
