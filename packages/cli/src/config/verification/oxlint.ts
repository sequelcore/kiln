import { execFileSync } from "node:child_process";
import type { StaticAnalyzeToolOptions } from "@kilnai/core";
import { resolveNativeCliExecutable } from "../../wrapper/native-cli-executable.js";
import type { KilnGlobalConfig } from "../global-config.js";

export type StaticAnalysisConfigurationDiagnosticCode =
  | "not_configured"
  | "executable_unavailable"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_mismatch";

export interface StaticAnalysisConfigurationDiagnostic {
  readonly code: StaticAnalysisConfigurationDiagnosticCode;
  readonly message: string;
  readonly executable?: string;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
}

export interface StaticAnalysisConfigurationResolution {
  readonly options?: StaticAnalyzeToolOptions;
  readonly diagnostic?: StaticAnalysisConfigurationDiagnostic;
}

export interface ResolveStaticAnalysisConfigurationInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly platform?: NodeJS.Platform;
  readonly discoveredPaths?: readonly string[];
  readonly runVersion?: (executable: string) => string;
}

const CANONICAL_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const OXLINT_VERSION_OUTPUT_PATTERN =
  /^(?:(?:version:|oxlint)\s+)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\+[0-9A-Za-z.-]+)?$/iu;

export function parseObservedOxlintVersion(output: string): string {
  const match = OXLINT_VERSION_OUTPUT_PATTERN.exec(output.trim());
  if (match?.[1] === undefined || !CANONICAL_VERSION_PATTERN.test(match[1])) {
    throw new Error("Oxlint --version output is not a closed canonical version with optional build metadata");
  }
  return match[1];
}

export function resolveStaticAnalysisConfiguration(
  input: ResolveStaticAnalysisConfigurationInput,
): StaticAnalysisConfigurationResolution {
  const oxlint = input.globalConfig?.verification?.static?.oxlint;
  if (oxlint === undefined) {
    return failure({
      code: "not_configured",
      message: "Oxlint static analysis is not configured in the operator global config.",
    });
  }

  const executableReference = oxlint.executable.trim();
  const discoveredPaths = input.discoveredPaths ?? (/[\\/]/u.test(executableReference) ? [] : undefined);
  const observedOutputs = new Map<string, string>();
  const runVersion = input.runVersion ?? observeOxlintVersion;
  let lastProbeFailure: unknown;
  const probe = (executable: string): string => {
    const cached = observedOutputs.get(executable);
    if (cached !== undefined) return cached;
    const output = runVersion(executable);
    observedOutputs.set(executable, output);
    return output;
  };

  let executable: string;
  try {
    executable = resolveNativeCliExecutable({
      command: executableReference,
      fallbackPaths: [executableReference],
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      ...(discoveredPaths === undefined ? {} : { discoveredPaths }),
      verify: (candidate) => {
        try {
          probe(candidate);
          return true;
        } catch (error) {
          lastProbeFailure = error;
          return false;
        }
      },
    });
  } catch (error) {
    const detail = errorMessage(lastProbeFailure ?? error);
    return failure({
      code: lastProbeFailure === undefined ? "executable_unavailable" : "version_probe_failed",
      message:
        lastProbeFailure === undefined
          ? `Configured Oxlint executable "${executableReference}" is unavailable: ${detail}`
          : `Configured Oxlint executable "${executableReference}" could not report its version: ${detail}`,
      executable: executableReference,
      expectedVersion: oxlint.expectedVersion,
    });
  }

  let observedVersion: string;
  try {
    observedVersion = parseObservedOxlintVersion(probe(executable));
  } catch (error) {
    return failure({
      code: "version_unparseable",
      message: `Configured Oxlint executable "${executable}" returned an unrecognized version: ${errorMessage(error)}`,
      executable,
      expectedVersion: oxlint.expectedVersion,
    });
  }
  if (observedVersion !== oxlint.expectedVersion) {
    return failure({
      code: "version_mismatch",
      message: `Configured Oxlint executable "${executable}" reported version "${observedVersion}", expected "${oxlint.expectedVersion}".`,
      executable,
      expectedVersion: oxlint.expectedVersion,
      observedVersion,
    });
  }
  return { options: { executable, analyzerVersion: observedVersion } };
}

function failure(diagnostic: StaticAnalysisConfigurationDiagnostic): StaticAnalysisConfigurationResolution {
  return { diagnostic };
}

function observeOxlintVersion(executable: string): string {
  return execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
