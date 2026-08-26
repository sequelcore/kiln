import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { GentleReviewToolOptions } from "@kilnai/core";
import { resolveNativeCliExecutable } from "../../wrapper/native-cli-executable.js";
import type { KilnGlobalConfig } from "../global-config.js";

export type GentleAiConfigurationDiagnosticCode =
  | "not_configured"
  | "executable_unavailable"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_mismatch"
  | "digest_probe_failed"
  | "digest_mismatch";
export interface GentleAiConfigurationDiagnostic {
  readonly code: GentleAiConfigurationDiagnosticCode;
  readonly message: string;
}
export interface GentleAiConfigurationResolution {
  readonly options?: GentleReviewToolOptions;
  readonly diagnostic?: GentleAiConfigurationDiagnostic;
}
export interface ResolveGentleAiConfigurationInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly repositoryRoot: string;
  readonly platform?: NodeJS.Platform;
  readonly discoveredPaths?: readonly string[];
  readonly runVersion?: (executable: string) => string;
  readonly readExecutable?: (executable: string) => Uint8Array;
}

export function parseObservedGentleAiVersion(output: string): string {
  const match = /^(?:(?:gentle-ai)(?:\s+version)?\s+)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\s.*)?$/u.exec(
    output.trim(),
  );
  if (!match?.[1]) throw new Error("Gentle AI --version output is not canonical");
  return match[1];
}

export function resolveGentleAiConfiguration(
  input: ResolveGentleAiConfigurationInput,
): GentleAiConfigurationResolution {
  const config = input.globalConfig?.verification?.inferential?.gentleAi;
  if (config === undefined)
    return { diagnostic: { code: "not_configured", message: "Gentle AI inferential review is not configured." } };
  const reference = config.executable.trim();
  const runVersion =
    input.runVersion ??
    ((executable) => execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true }));
  let executable: string;
  try {
    executable = resolveNativeCliExecutable({
      command: reference,
      fallbackPaths: [reference],
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(input.discoveredPaths === undefined ? {} : { discoveredPaths: input.discoveredPaths }),
      verify: (candidate) => {
        try {
          runVersion(candidate);
          return true;
        } catch {
          return false;
        }
      },
    });
  } catch (error) {
    return {
      diagnostic: {
        code: "executable_unavailable",
        message: `Configured Gentle AI executable is unavailable: ${message(error)}`,
      },
    };
  }
  let observedVersion: string;
  try {
    observedVersion = parseObservedGentleAiVersion(runVersion(executable));
  } catch (error) {
    return { diagnostic: { code: "version_unparseable", message: message(error) } };
  }
  if (observedVersion !== config.expectedVersion)
    return {
      diagnostic: {
        code: "version_mismatch",
        message: `Gentle AI reported ${observedVersion}, expected ${config.expectedVersion}.`,
      },
    };
  let bytes: Uint8Array;
  try {
    bytes = (input.readExecutable ?? readFileSync)(executable);
  } catch (error) {
    return {
      diagnostic: {
        code: "digest_probe_failed",
        message: `Configured Gentle AI executable bytes could not be read: ${message(error)}`,
      },
    };
  }
  const observedDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (observedDigest !== config.expectedExecutableDigest)
    return {
      diagnostic: {
        code: "digest_mismatch",
        message: `Gentle AI executable digest ${observedDigest} does not match configured ${config.expectedExecutableDigest}.`,
      },
    };
  return {
    options: {
      executable,
      expectedVersion: config.expectedVersion,
      expectedExecutableDigest: config.expectedExecutableDigest,
      expectedBuildRevision: config.expectedBuildRevision,
      repositoryRoot: input.repositoryRoot,
    },
  };
}
function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
