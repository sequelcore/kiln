import { execFileSync } from "node:child_process";
import type { StaticAnalyzeToolOptions } from "@kilnai/core/tools";
import { STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST } from "@kilnai/core/verification";
import { resolveVendoredToolBinary, type ResolvedVendoredToolBinary } from "@kilnai/tools";
import type { KilnGlobalConfig } from "../global-config.js";

export type StaticAnalysisConfigurationDiagnosticCode =
  | "not_configured"
  | "managed_artifact_unavailable"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_mismatch";

export interface StaticAnalysisConfigurationDiagnostic {
  readonly code: StaticAnalysisConfigurationDiagnosticCode;
  readonly message: string;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
}

export interface StaticAnalysisImplementationIdentity {
  readonly version: string;
  readonly executableDigest: `sha256:${string}`;
  readonly sourceArchiveDigest: `sha256:${string}`;
  readonly profileConfigDigest: `sha256:${string}`;
}

export interface StaticAnalysisConfigurationResolution {
  readonly options?: StaticAnalyzeToolOptions;
  readonly identity?: StaticAnalysisImplementationIdentity;
  readonly diagnostic?: StaticAnalysisConfigurationDiagnostic;
}

export interface ResolveStaticAnalysisConfigurationInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
  readonly runVersion?: (executable: string) => string;
  readonly resolveManagedBinary?: (
    platform: NodeJS.Platform,
    arch: string,
  ) => ResolvedVendoredToolBinary | undefined;
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
  if (input.globalConfig?.verification?.static?.oxlint === undefined) {
    return failure({
      code: "not_configured",
      message: "Oxlint static analysis is not enabled in the operator global config.",
    });
  }

  const platform = input.platform ?? process.platform;
  const arch = input.arch ?? process.arch;
  const resolveManagedBinary =
    input.resolveManagedBinary ??
    ((targetPlatform, targetArch) =>
      resolveVendoredToolBinary("oxlint", { platform: targetPlatform, arch: targetArch }));
  const managedBinary = resolveManagedBinary(platform, arch);
  if (managedBinary === undefined) {
    return failure({
      code: "managed_artifact_unavailable",
      message: `Kiln's managed Oxlint artifact is unavailable for ${platform}-${arch}.`,
    });
  }

  let rawVersion: string;
  try {
    rawVersion = (input.runVersion ?? observeOxlintVersion)(managedBinary.path);
  } catch (error) {
    return failure({
      code: "version_probe_failed",
      message: `Kiln's managed Oxlint artifact could not report its version: ${errorMessage(error)}`,
      expectedVersion: managedBinary.version,
    });
  }

  let observedVersion: string;
  try {
    observedVersion = parseObservedOxlintVersion(rawVersion);
  } catch (error) {
    return failure({
      code: "version_unparseable",
      message: `Kiln's managed Oxlint artifact returned an unrecognized version: ${errorMessage(error)}`,
      expectedVersion: managedBinary.version,
    });
  }

  if (observedVersion !== managedBinary.version) {
    return failure({
      code: "version_mismatch",
      message: `Kiln's managed Oxlint artifact reported version "${observedVersion}", expected "${managedBinary.version}".`,
      expectedVersion: managedBinary.version,
      observedVersion,
    });
  }

  return {
    options: { executable: managedBinary.path, analyzerVersion: observedVersion },
    identity: {
      version: observedVersion,
      executableDigest: `sha256:${managedBinary.binarySha256}`,
      sourceArchiveDigest: `sha256:${managedBinary.archiveSha256}`,
      profileConfigDigest: STATIC_ANALYSIS_PROFILE_CONFIG_DIGEST,
    },
  };
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
