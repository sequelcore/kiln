import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";

const requireFromHere = createRequire(import.meta.url);
const VENDORED_TOOLS = ["rg", "fd", "jq"] as const;
const UNIX_MATERIALIZED_TOOLS = ["rg", "fd", "jq"] as const;
const DARWIN_X64_MATERIALIZED_TOOLS = ["rg", "jq"] as const;

export type VendoredToolBinary = (typeof VENDORED_TOOLS)[number];

export interface VendoredPlatformPackageDescriptor {
  readonly packageName: string;
  readonly platform: string;
  readonly arch: string;
  readonly binaries: readonly VendoredToolBinary[];
}

export interface ResolvedVendoredPlatformPackage extends VendoredPlatformPackageDescriptor {
  readonly packageJsonPath: string;
}

export interface ResolvedVendoredToolBinary {
  readonly binary: VendoredToolBinary;
  readonly path: string;
  readonly packageName: string;
  readonly packageRoot: string;
  readonly platform: string;
  readonly arch: string;
  readonly version: string;
  readonly sha256: string;
}

export interface VendoredPackageTarget {
  readonly platform: string;
  readonly arch: string;
}

export interface ResolveVendoredPackageOptions {
  readonly platform?: string;
  readonly arch?: string;
  readonly resolvePackageJson?: (specifier: string) => string;
}

export interface ResolveVendoredToolBinaryOptions extends ResolveVendoredPackageOptions {
  readonly fileExists?: (path: string) => boolean;
  readonly readTextFile?: (path: string) => string;
}

interface VendoredToolManifestEntry {
  readonly path: string;
  readonly version: string;
  readonly source: string;
  readonly sha256: string;
}

interface VendoredToolsManifest {
  readonly tools: Partial<Record<VendoredToolBinary, VendoredToolManifestEntry>>;
}

const PLATFORM_PACKAGES: readonly VendoredPlatformPackageDescriptor[] = [
  {
    packageName: "@kilnai/tools-win32-x64",
    platform: "win32",
    arch: "x64",
    binaries: UNIX_MATERIALIZED_TOOLS,
  },
  {
    packageName: "@kilnai/tools-darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    binaries: UNIX_MATERIALIZED_TOOLS,
  },
  {
    packageName: "@kilnai/tools-darwin-x64",
    platform: "darwin",
    arch: "x64",
    binaries: DARWIN_X64_MATERIALIZED_TOOLS,
  },
  {
    packageName: "@kilnai/tools-linux-x64",
    platform: "linux",
    arch: "x64",
    binaries: UNIX_MATERIALIZED_TOOLS,
  },
] as const;

export function listVendoredPlatformPackages(): readonly VendoredPlatformPackageDescriptor[] {
  return PLATFORM_PACKAGES;
}

export function getVendoredPackageCandidates(
  target: VendoredPackageTarget = { platform: process.platform, arch: process.arch },
): readonly VendoredPlatformPackageDescriptor[] {
  const preferred = PLATFORM_PACKAGES.filter(
    (candidate) =>
      candidate.platform === target.platform && candidate.arch === target.arch,
  );
  const remaining = PLATFORM_PACKAGES.filter(
    (candidate) =>
      candidate.platform !== target.platform || candidate.arch !== target.arch,
  );
  return [...preferred, ...remaining];
}

export function resolveVendoredPlatformPackage(
  options: ResolveVendoredPackageOptions = {},
): ResolvedVendoredPlatformPackage | undefined {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const resolvePackageJson = options.resolvePackageJson ?? defaultResolvePackageJson;

  for (const candidate of getVendoredPackageCandidates({ platform, arch })) {
    try {
      const packageJsonPath = resolvePackageJson(`${candidate.packageName}/package.json`);
      return {
        ...candidate,
        packageJsonPath,
      };
    } catch {
      // Continue probing candidates until one resolves.
    }
  }

  return undefined;
}

export function resolveVendoredToolBinary(
  binary: VendoredToolBinary,
  options: ResolveVendoredToolBinaryOptions = {},
): ResolvedVendoredToolBinary | undefined {
  const resolvedPackage = resolveVendoredPlatformPackage(options);
  if (!resolvedPackage?.binaries.includes(binary)) {
    return undefined;
  }

  const packageRoot = dirname(resolvedPackage.packageJsonPath);
  const manifest = readVendoredToolsManifest(packageRoot, options.readTextFile);
  const manifestEntry = manifest?.tools[binary];
  if (!manifestEntry || !isSafeRelativePath(manifestEntry.path)) {
    return undefined;
  }

  const expectedFileName = binaryFileName(binary, resolvedPackage.platform);
  if (manifestEntry.path !== `bin/${expectedFileName}`) {
    return undefined;
  }

  const binaryPath = join(packageRoot, manifestEntry.path);
  const fileExists = options.fileExists ?? existsSync;
  if (!fileExists(binaryPath)) {
    return undefined;
  }

  return {
    binary,
    path: binaryPath,
    packageName: resolvedPackage.packageName,
    packageRoot,
    platform: resolvedPackage.platform,
    arch: resolvedPackage.arch,
    version: manifestEntry.version,
    sha256: manifestEntry.sha256,
  };
}

function readVendoredToolsManifest(
  packageRoot: string,
  readTextFile: ((path: string) => string) | undefined,
): VendoredToolsManifest | undefined {
  const read = readTextFile ?? ((path: string) => readFileSync(path, "utf8"));

  try {
    return parseVendoredToolsManifest(read(join(packageRoot, "tools.json")));
  } catch {
    return undefined;
  }
}

function parseVendoredToolsManifest(raw: string): VendoredToolsManifest | undefined {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.tools)) {
    return undefined;
  }

  const tools: Partial<Record<VendoredToolBinary, VendoredToolManifestEntry>> = {};
  for (const binary of VENDORED_TOOLS) {
    const entry = parsed.tools[binary];
    if (isManifestEntry(entry)) {
      tools[binary] = entry;
    }
  }

  return { tools };
}

function isManifestEntry(value: unknown): value is VendoredToolManifestEntry {
  return (
    isRecord(value) &&
    typeof value.path === "string" &&
    typeof value.version === "string" &&
    typeof value.source === "string" &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sha256)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(path: string): boolean {
  return !isAbsolute(path) && !path.split(/[\\/]+/u).includes("..");
}

function binaryFileName(binary: VendoredToolBinary, platform: string): string {
  return platform === "win32" ? `${binary}.exe` : binary;
}

function defaultResolvePackageJson(specifier: string): string {
  return requireFromHere.resolve(specifier);
}
