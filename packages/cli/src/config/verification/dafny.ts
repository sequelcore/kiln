import { execFileSync } from "node:child_process";
import type { FormalVerifyToolOptions } from "@kilnai/core";
import type { KilnGlobalConfig } from "../global-config.js";
import { resolveNativeCliExecutable } from "../../wrapper/native-cli-executable.js";

export type FormalVerificationConfigurationDiagnosticCode =
  | "not_configured"
  | "executable_unavailable"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_mismatch";

export interface FormalVerificationConfigurationDiagnostic {
  readonly code: FormalVerificationConfigurationDiagnosticCode;
  readonly message: string;
  readonly executable?: string;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
}

export interface FormalVerificationConfigurationResolution {
  readonly options?: FormalVerifyToolOptions;
  readonly diagnostic?: FormalVerificationConfigurationDiagnostic;
}

export interface ResolveFormalVerificationConfigurationInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly platform?: NodeJS.Platform;
  /** Test seam for the executable resolver's Windows PATH results. */
  readonly discoveredPaths?: readonly string[];
  /** Test seam for observing `dafny --version`. */
  readonly runVersion?: (executable: string) => string;
}

const CANONICAL_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const DAFNY_VERSION_OUTPUT_PATTERN = /^(?:dafny(?:\s+version)?\s+)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\+[0-9A-Za-z.-]+)?$/iu;

export function parseObservedDafnyVersion(output: string): string {
  const normalized = output.trim();
  const match = DAFNY_VERSION_OUTPUT_PATTERN.exec(normalized);
  if (match?.[1] === undefined || !CANONICAL_VERSION_PATTERN.test(match[1])) {
    throw new Error("Dafny --version output is not a closed canonical version with optional build metadata");
  }
  return match[1];
}

export function resolveFormalVerificationConfiguration(
  input: ResolveFormalVerificationConfigurationInput,
): FormalVerificationConfigurationResolution {
  const dafny = input.globalConfig?.verification?.formal?.dafny;
  if (dafny === undefined) {
    return resolveFailure({
      code: "not_configured",
      message: "Dafny formal verification is not configured in the operator global config.",
    });
  }

  const executableReference = dafny.executable.trim();
  const discoveredPaths = input.discoveredPaths
    ?? (/[\\/]/u.test(executableReference) ? [] : undefined);
  const observedOutputs = new Map<string, string>();
  let lastProbeFailure: unknown;
  const runVersion = input.runVersion ?? observeDafnyVersion;
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
    return resolveFailure({
      code: lastProbeFailure === undefined ? "executable_unavailable" : "version_probe_failed",
      message: lastProbeFailure === undefined
        ? `Configured Dafny executable "${executableReference}" is unavailable: ${detail}`
        : `Configured Dafny executable "${executableReference}" could not report its version: ${detail}`,
      executable: executableReference,
      expectedVersion: dafny.expectedVersion,
    });
  }

  let observedVersion: string;
  try {
    observedVersion = parseObservedDafnyVersion(probe(executable));
  } catch (error) {
    return resolveFailure({
      code: "version_unparseable",
      message: `Configured Dafny executable "${executable}" returned an unrecognized version: ${errorMessage(error)}`,
      executable,
      expectedVersion: dafny.expectedVersion,
    });
  }

  if (observedVersion !== dafny.expectedVersion) {
    return resolveFailure({
      code: "version_mismatch",
      message: `Configured Dafny executable "${executable}" reported version "${observedVersion}", expected "${dafny.expectedVersion}".`,
      executable,
      expectedVersion: dafny.expectedVersion,
      observedVersion,
    });
  }

  return {
    options: {
      executable,
      verifierVersion: observedVersion,
    },
  };
}

function resolveFailure(
  diagnostic: FormalVerificationConfigurationDiagnostic,
): FormalVerificationConfigurationResolution {
  return { diagnostic };
}

function observeDafnyVersion(executable: string): string {
  return execFileSync(executable, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
