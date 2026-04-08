import { createRequire } from "node:module";

const requireFromHere = createRequire(import.meta.url);
const VENDORED_TOOLS = ["rg", "fd", "jq"] as const;

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

export interface VendoredPackageTarget {
  readonly platform: string;
  readonly arch: string;
}

export interface ResolveVendoredPackageOptions {
  readonly platform?: string;
  readonly arch?: string;
  readonly resolvePackageJson?: (specifier: string) => string;
}

const PLATFORM_PACKAGES: readonly VendoredPlatformPackageDescriptor[] = [
  {
    packageName: "@kilnai/tools-win32-x64",
    platform: "win32",
    arch: "x64",
    binaries: VENDORED_TOOLS,
  },
  {
    packageName: "@kilnai/tools-darwin-arm64",
    platform: "darwin",
    arch: "arm64",
    binaries: VENDORED_TOOLS,
  },
  {
    packageName: "@kilnai/tools-darwin-x64",
    platform: "darwin",
    arch: "x64",
    binaries: VENDORED_TOOLS,
  },
  {
    packageName: "@kilnai/tools-linux-x64",
    platform: "linux",
    arch: "x64",
    binaries: VENDORED_TOOLS,
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

function defaultResolvePackageJson(specifier: string): string {
  return requireFromHere.resolve(specifier);
}
