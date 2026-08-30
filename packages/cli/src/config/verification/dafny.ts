import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, lstatSync, openSync, readSync, realpathSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import type { FormalVerifyToolOptions } from "@kilnai/runtime";
import type { KilnGlobalConfig } from "../global-config.js";

export type FormalVerificationConfigurationDiagnosticCode =
  | "not_configured"
  | "executable_unavailable"
  | "version_probe_failed"
  | "version_unparseable"
  | "version_mismatch"
  | "digest_probe_failed"
  | "digest_mismatch";

export interface FormalVerificationConfigurationDiagnostic {
  readonly code: FormalVerificationConfigurationDiagnosticCode;
  readonly message: string;
  readonly executable?: string;
  readonly expectedVersion?: string;
  readonly observedVersion?: string;
  readonly expectedInstallationDigest?: string;
  readonly observedInstallationDigest?: string;
}

export interface FormalVerificationConfigurationResolution {
  readonly options?: FormalVerifyToolOptions;
  readonly identity?: {
    readonly version: string;
    readonly installationDigest: `sha256:${string}`;
  };
  readonly diagnostic?: FormalVerificationConfigurationDiagnostic;
}

export interface ResolveFormalVerificationConfigurationInput {
  readonly globalConfig?: KilnGlobalConfig | null;
  readonly platform?: NodeJS.Platform;
  /** Test seam for observing `dafny --version`. */
  readonly runVersion?: (executable: string) => string;
  /** Test seam for binding the complete admitted installation tree. */
  readonly observeInstallationDigest?: (
    installationRoot: string,
    executable: string,
  ) => `sha256:${string}`;
}

export interface DafnyInstallationFile {
  readonly relativePath: string;
  readonly bytes: Uint8Array;
}

const CANONICAL_VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u;
const DAFNY_VERSION_OUTPUT_PATTERN = /^(?:dafny(?:\s+version)?\s+)?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))(?:\+[0-9A-Za-z.-]+)?$/iu;
const MAX_INSTALLATION_FILES = 2_048;
const MAX_INSTALLATION_BYTES = 512 * 1024 * 1024;
const MAX_INSTALLATION_DEPTH = 16;
const MAX_RELATIVE_PATH_BYTES = 1_024;
const READ_BUFFER_BYTES = 1024 * 1024;

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

  const executable = dafny.executable.trim();
  const platform = input.platform ?? process.platform;
  if (!isAbsolute(executable) || (platform === "win32" && !/\.(?:exe|com)$/iu.test(executable))) {
    return resolveFailure({
      code: "executable_unavailable",
      message: "Configured Dafny executable must be an absolute native executable path.",
      executable,
      expectedVersion: dafny.expectedVersion,
    });
  }

  let observedInstallationDigest: `sha256:${string}`;
  try {
    observedInstallationDigest = (input.observeInstallationDigest ?? observeDafnyInstallationDigest)(
      dafny.installationRoot,
      executable,
    );
  } catch (error) {
    return resolveFailure({
      code: "digest_probe_failed",
      message: `Configured Dafny installation could not be bound: ${errorMessage(error)}`,
      executable,
      expectedVersion: dafny.expectedVersion,
      expectedInstallationDigest: dafny.expectedInstallationDigest,
    });
  }
  if (observedInstallationDigest !== dafny.expectedInstallationDigest) {
    return resolveFailure({
      code: "digest_mismatch",
      message: `Configured Dafny installation digest ${observedInstallationDigest} does not match configured ${dafny.expectedInstallationDigest}.`,
      executable,
      expectedVersion: dafny.expectedVersion,
      expectedInstallationDigest: dafny.expectedInstallationDigest,
      observedInstallationDigest,
    });
  }

  let rawVersion: string;
  try {
    rawVersion = (input.runVersion ?? observeDafnyVersion)(executable);
  } catch (error) {
    return resolveFailure({
      code: "version_probe_failed",
      message: `Bound Dafny executable could not report its version: ${errorMessage(error)}`,
      executable,
      expectedVersion: dafny.expectedVersion,
    });
  }
  let observedVersion: string;
  try {
    observedVersion = parseObservedDafnyVersion(rawVersion);
  } catch (error) {
    return resolveFailure({
      code: "version_unparseable",
      message: `Bound Dafny executable returned an unrecognized version: ${errorMessage(error)}`,
      executable,
      expectedVersion: dafny.expectedVersion,
    });
  }

  if (observedVersion !== dafny.expectedVersion) {
    return resolveFailure({
      code: "version_mismatch",
      message: `Bound Dafny executable reported version "${observedVersion}", expected "${dafny.expectedVersion}".`,
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
    identity: {
      version: observedVersion,
      installationDigest: dafny.expectedInstallationDigest as `sha256:${string}`,
    },
  };
}

/** Hashes canonical relative paths and bytes; timestamps and permissions are deliberately excluded. */
export function digestDafnyInstallation(
  files: readonly DafnyInstallationFile[],
): `sha256:${string}` {
  if (files.length === 0) throw new Error("Dafny installation contains no regular files");
  const normalized = files.map((file) => {
    const relativePath = file.relativePath.replaceAll("\\", "/");
    if (
      relativePath.length === 0 ||
      relativePath.startsWith("/") ||
      /^[A-Za-z]:\//u.test(relativePath) ||
      relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) throw new Error("Dafny installation contains an unsafe relative path");
    return { relativePath, bytes: file.bytes };
  }).sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  if (normalized.some((file, index) => index > 0 && file.relativePath === normalized[index - 1]!.relativePath)) {
    throw new Error("Dafny installation contains duplicate relative paths");
  }

  const hash = createHash("sha256");
  hash.update("kiln.dafny-installation/v1\0");
  for (const file of normalized) {
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    hash.update(unsignedLength(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(unsignedLength(file.bytes.byteLength));
    hash.update(file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

/** Binds one explicit, dedicated installation root without loading its contents into memory. */
export function observeDafnyInstallationDigest(
  installationRoot: string,
  executable: string,
): `sha256:${string}` {
  if (!isAbsolute(installationRoot)) throw new Error("Dafny installation root must be absolute");
  const rootStat = lstatSync(installationRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Dafny installation root must be a real directory");
  }
  const root = realpathSync.native(installationRoot);
  const executableStat = lstatSync(executable);
  if (!executableStat.isFile() || executableStat.isSymbolicLink()) {
    throw new Error("Dafny executable must be a regular file inside the installation root");
  }
  const realExecutable = realpathSync.native(executable);
  const executableRelative = relative(root, realExecutable);
  if (!isContainedRelativePath(executableRelative)) {
    throw new Error("Dafny executable is outside the configured installation root");
  }

  const files: Array<{ readonly relativePath: string; readonly absolutePath: string; readonly size: number }> = [];
  let totalBytes = 0;
  const visit = (directory: string, depth: number): void => {
    if (depth > MAX_INSTALLATION_DEPTH) throw new Error("Dafny installation exceeds the depth limit");
    const entries = readdirSync(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(directory, entry.name);
      const stat = lstatSync(absolutePath);
      if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
        throw new Error("Dafny installation contains a symbolic link or reparse point");
      }
      if (entry.isDirectory() && stat.isDirectory()) {
        visit(absolutePath, depth + 1);
      } else if (entry.isFile() && stat.isFile()) {
        const relativePath = relative(root, absolutePath).split(sep).join("/");
        if (!isContainedRelativePath(relativePath)) throw new Error("Dafny installation entry escaped its root");
        if (Buffer.byteLength(relativePath, "utf8") > MAX_RELATIVE_PATH_BYTES) {
          throw new Error("Dafny installation contains an overlong relative path");
        }
        totalBytes += stat.size;
        if (files.length >= MAX_INSTALLATION_FILES) throw new Error("Dafny installation exceeds the file limit");
        if (!Number.isSafeInteger(totalBytes) || totalBytes > MAX_INSTALLATION_BYTES) {
          throw new Error("Dafny installation exceeds the byte limit");
        }
        files.push({ relativePath, absolutePath, size: stat.size });
      } else {
        throw new Error("Dafny installation contains a non-regular filesystem entry");
      }
    }
  };
  visit(root, 0);
  if (files.length === 0) throw new Error("Dafny installation contains no regular files");
  files.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));

  const hash = createHash("sha256");
  hash.update("kiln.dafny-installation/v1\0");
  const buffer = Buffer.allocUnsafe(READ_BUFFER_BYTES);
  for (const file of files) {
    const pathBytes = Buffer.from(file.relativePath, "utf8");
    hash.update(unsignedLength(pathBytes.byteLength));
    hash.update(pathBytes);
    hash.update(unsignedLength(file.size));
    const descriptor = openSync(file.absolutePath, "r");
    try {
      let offset = 0;
      while (offset < file.size) {
        const bytesRead = readSync(descriptor, buffer, 0, Math.min(buffer.byteLength, file.size - offset), offset);
        if (bytesRead <= 0) throw new Error("Dafny installation file changed while it was being hashed");
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
      }
      if (lstatSync(file.absolutePath).size !== file.size) {
        throw new Error("Dafny installation file changed while it was being hashed");
      }
    } finally {
      closeSync(descriptor);
    }
  }
  return `sha256:${hash.digest("hex")}`;
}

function isContainedRelativePath(value: string): boolean {
  return value.length > 0 && !isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`);
}

function unsignedLength(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Dafny installation entry is too large");
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(BigInt(value));
  return bytes;
}

function compareCodeUnits(left: string, right: string): number {
  const sharedLength = Math.min(left.length, right.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
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
