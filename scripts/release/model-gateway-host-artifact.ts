import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import cliPackage from "../../packages/cli/package.json" with { type: "json" };
import {
  MODEL_GATEWAY_HOST_REVISION,
  MODEL_GATEWAY_HOST_SHA256,
  MODEL_GATEWAY_HOST_VERSION,
} from "../../packages/cli/src/application/model-gateway-host.js";

const PLATFORM_PACKAGE_NAME = "@kilnai/model-gateway-host-win32-x64";

interface ModelGatewayHostReleaseBundle {
  readonly version: string;
  readonly packages: readonly { readonly name: string }[];
  readonly tarballs: readonly { readonly name: string; readonly version: string }[];
}

export async function assertModelGatewayHostReleaseArtifact(
  packageDirectory: string,
  calculateSha256: (bytes: Uint8Array) => string = (bytes) => createHash("sha256").update(bytes).digest("hex"),
): Promise<void> {
  let manifest: unknown;
  let artifact: Uint8Array;
  let host: unknown;
  try {
    manifest = JSON.parse(await readFile(join(packageDirectory, "package.json"), "utf8")) as unknown;
    host = JSON.parse(await readFile(join(packageDirectory, "host.json"), "utf8")) as unknown;
    artifact = await readFile(join(packageDirectory, "bin", "bun.exe"));
  } catch {
    throw new Error("Windows Model Gateway host release artifact is missing; public packaging is blocked.");
  }
  if (!isPlatformManifest(manifest)) {
    throw new Error("Windows Model Gateway host package manifest is invalid; public packaging is blocked.");
  }
  if (!isHostManifest(host))
    throw new Error("Windows Model Gateway host identity is invalid; public packaging is blocked.");
  if (calculateSha256(artifact) !== MODEL_GATEWAY_HOST_SHA256) {
    throw new Error("Windows Model Gateway host artifact digest is invalid; public packaging is blocked.");
  }
}

export function assertModelGatewayHostReleaseBundle(bundle: ModelGatewayHostReleaseBundle): void {
  const hasPackage = bundle.packages.some((candidate) => candidate.name === PLATFORM_PACKAGE_NAME);
  const hasTarball = bundle.tarballs.some(
    (candidate) => candidate.name === PLATFORM_PACKAGE_NAME && candidate.version === bundle.version,
  );
  if (!hasPackage || !hasTarball) {
    throw new Error("Windows Model Gateway host release artifact is absent from the release bundle; publishing is blocked.");
  }
}

function isPlatformManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const manifest = value as Record<string, unknown>;
  return (
    manifest.name === PLATFORM_PACKAGE_NAME &&
    manifest.version === cliPackage.version &&
    Array.isArray(manifest.os) &&
    manifest.os.length === 1 &&
    manifest.os[0] === "win32" &&
    Array.isArray(manifest.cpu) &&
    manifest.cpu.length === 1 &&
    manifest.cpu[0] === "x64" &&
    Array.isArray(manifest.files) &&
    manifest.files.includes("bin/bun.exe") &&
    manifest.files.includes("host.json")
  );
}

function isHostManifest(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const host = value as Record<string, unknown>;
  return (
    host.schemaVersion === 1 &&
    host.version === MODEL_GATEWAY_HOST_VERSION &&
    host.revision === MODEL_GATEWAY_HOST_REVISION &&
    host.sha256 === MODEL_GATEWAY_HOST_SHA256
  );
}
