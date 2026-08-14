import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { ModelGatewayHostIdentity } from "@kilnai/runtime";

const execFileAsync = promisify(execFile);

export const MODEL_GATEWAY_HOST_VERSION = "1.4.0";
export const MODEL_GATEWAY_HOST_REVISION = "1.4.0-canary.1+1cf8af0a1";
export const MODEL_GATEWAY_HOST_SHA256 = "4cf25fbfe259cff169e2e9a831c83e7d157f7374be34fc148484ad49a50d5b44";

const HOST_STORE_DIRECTORY = "model-gateway-hosts";
const HOST_EXECUTABLE = "bun.exe";
const HOST_MANIFEST = "manifest.json";
const LEGACY_EXECUTABLE = ["bun-canary", "bun-windows-x64", "bun.exe"] as const;

export interface ResolvedModelGatewayHost {
  readonly executable: string;
  readonly host: ModelGatewayHostIdentity;
  readonly source: "bundled" | "legacy-migration";
}

export interface ModelGatewayHostInspector {
  inspect(executable: string, args: readonly string[]): Promise<string>;
}

export interface ResolveModelGatewayHostInput {
  /** The Kiln-owned global runtime directory (normally ~/.kiln/runtime). */
  readonly runtimeDir: string;
  /** Bytes shipped by the installed Kiln package. No network source is accepted. */
  readonly bundledArtifact?: Uint8Array;
  readonly inspect?: ModelGatewayHostInspector;
  /** Test seam; production always hashes the exact executable bytes. */
  readonly calculateSha256?: (bytes: Uint8Array) => string;
  /** Test seam; the admitted preview artifact is intentionally Windows x64 only. */
  readonly platform?: NodeJS.Platform;
  readonly arch?: string;
}

interface StoredHostManifest {
  readonly schemaVersion: 1;
  readonly executable: string;
  readonly host: ModelGatewayHostIdentity;
}

/**
 * Resolves the pinned Windows Bun host without consulting PATH or the network.
 * A legacy canary executable is copied into the same verified bundled-host
 * identity, never removed; lifecycle convergence owns its eventual deletion.
 */
export async function resolveModelGatewayHost(input: ResolveModelGatewayHostInput): Promise<ResolvedModelGatewayHost> {
  if ((input.platform ?? process.platform) !== "win32" || (input.arch ?? process.arch) !== "x64") {
    throw new Error("No approved model gateway host artifact is available for this platform and architecture.");
  }
  const runtimeDir = absoluteDirectory(input.runtimeDir, "Model gateway host runtime directory");
  const destination = confinedJoin(runtimeDir, HOST_STORE_DIRECTORY, MODEL_GATEWAY_HOST_SHA256);
  const installed = await readInstalledHost(destination, input);
  if (installed) return { ...installed, source: "bundled" };

  const artifact = await selectArtifact(runtimeDir, input);
  const sha256 = hash(artifact.bytes, input);
  if (sha256 !== MODEL_GATEWAY_HOST_SHA256)
    throw new Error("Model gateway host artifact SHA-256 does not match the approved host.");

  await mkdir(confinedJoin(runtimeDir, HOST_STORE_DIRECTORY), { recursive: true, mode: 0o700 });
  const temporary = confinedJoin(
    runtimeDir,
    HOST_STORE_DIRECTORY,
    `.${MODEL_GATEWAY_HOST_SHA256}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await mkdir(temporary, { mode: 0o700 });
    const executable = confinedJoin(temporary, HOST_EXECUTABLE);
    await writeFile(executable, artifact.bytes, { mode: 0o700 });
    const host = await verifyExecutable(executable, artifact.bytes, input);
    const manifest: StoredHostManifest = { schemaVersion: 1, executable: HOST_EXECUTABLE, host };
    await writeFile(confinedJoin(temporary, HOST_MANIFEST), `${JSON.stringify(manifest)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await rename(temporary, destination);
    } catch (error) {
      if (!isFsCode(error, "EEXIST") && !isFsCode(error, "ENOTEMPTY")) throw error;
      const raced = await readInstalledHost(destination, input);
      if (!raced) throw new Error("Model gateway host publish raced with an invalid installed host.");
      return { ...raced, source: artifact.source };
    }
    return { executable: confinedJoin(destination, HOST_EXECUTABLE), host, source: artifact.source };
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function selectArtifact(
  runtimeDir: string,
  input: ResolveModelGatewayHostInput,
): Promise<{ readonly bytes: Uint8Array; readonly source: "bundled" | "legacy-migration" }> {
  if (input.bundledArtifact) return { bytes: input.bundledArtifact, source: "bundled" };
  const legacy = confinedJoin(runtimeDir, ...LEGACY_EXECUTABLE);
  try {
    return { bytes: await readFile(legacy), source: "legacy-migration" };
  } catch (error) {
    if (isFsCode(error, "ENOENT"))
      throw new Error("No approved bundled model gateway host is available and no legacy host can be migrated.");
    throw error;
  }
}

async function readInstalledHost(
  destination: string,
  input: ResolveModelGatewayHostInput,
): Promise<Omit<ResolvedModelGatewayHost, "source"> | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(confinedJoin(destination, HOST_MANIFEST), "utf8")) as unknown;
  } catch (error) {
    if (isFsCode(error, "ENOENT")) return null;
    throw new Error("Installed model gateway host manifest is invalid.");
  }
  if (!isManifestShape(parsed)) throw new Error("Installed model gateway host manifest is invalid.");
  const executable = relativeExecutable(destination, parsed.executable);
  const bytes = await readFile(executable);
  const host = await verifyExecutable(executable, bytes, input);
  if (!sameHost(host, parsed.host) && !isExactHostIdentityPredecessor(parsed.host, host))
    throw new Error("Installed model gateway host manifest identity does not match its executable.");
  if (!sameHost(host, parsed.host)) {
    await writeManifestAtomically(destination, { schemaVersion: 1, executable: HOST_EXECUTABLE, host });
  }
  return { executable, host };
}

async function writeManifestAtomically(destination: string, manifest: StoredHostManifest): Promise<void> {
  const temporary = confinedJoin(destination, `.${HOST_MANIFEST}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(manifest)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, confinedJoin(destination, HOST_MANIFEST));
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

async function verifyExecutable(
  executable: string,
  bytes: Uint8Array,
  input: ResolveModelGatewayHostInput,
): Promise<ModelGatewayHostIdentity> {
  if (hash(bytes, input) !== MODEL_GATEWAY_HOST_SHA256)
    throw new Error("Model gateway host executable SHA-256 does not match the approved host.");
  const inspector = input.inspect ?? nodeModelGatewayHostInspector;
  const [version, revision] = await Promise.all([
    inspector.inspect(executable, ["--version"]),
    inspector.inspect(executable, ["--revision"]),
  ]);
  if (version.trim() !== MODEL_GATEWAY_HOST_VERSION || revision.trim() !== MODEL_GATEWAY_HOST_REVISION) {
    throw new Error("Model gateway host executable version or revision does not match the approved host.");
  }
  return canonicalHostIdentity();
}

export const nodeModelGatewayHostInspector: ModelGatewayHostInspector = {
  async inspect(executable, args) {
    const result = await execFileAsync(executable, [...args], { encoding: "utf8", windowsHide: true });
    return result.stdout;
  },
};

export function canonicalModelGatewayHostIdentity(): ModelGatewayHostIdentity {
  return canonicalHostIdentity();
}

/** Returns the desired immutable reference without reading or executing it; teardown uses this so a damaged host cannot block recovery. */
export function expectedModelGatewayHost(runtimeDir: string): ResolvedModelGatewayHost {
  const base = absoluteDirectory(runtimeDir, "Model gateway host runtime directory");
  return {
    executable: confinedJoin(base, HOST_STORE_DIRECTORY, MODEL_GATEWAY_HOST_SHA256, HOST_EXECUTABLE),
    host: canonicalHostIdentity(),
    source: "bundled",
  };
}

function canonicalHostIdentity(): ModelGatewayHostIdentity {
  return {
    schemaVersion: 1,
    runtimeKind: "bun",
    version: MODEL_GATEWAY_HOST_VERSION,
    revision: MODEL_GATEWAY_HOST_REVISION,
    provenance: "https://github.com/oven-sh/bun/commit/1cf8af0a1",
    sha256: MODEL_GATEWAY_HOST_SHA256,
    platform: "win32",
    arch: "x64",
    packageName: "@kilnai/model-gateway-host-win32-x64",
    source: "bundled",
  };
}

function hash(bytes: Uint8Array, input: ResolveModelGatewayHostInput): string {
  return (input.calculateSha256 ?? ((value) => createHash("sha256").update(value).digest("hex")))(bytes);
}

function isManifestShape(value: unknown): value is StoredHostManifest {
  if (!value || typeof value !== "object") return false;
  const manifest = value as Partial<StoredHostManifest>;
  return manifest.schemaVersion === 1 && typeof manifest.executable === "string" && isHostShape(manifest.host);
}

function isHostShape(value: unknown): value is ModelGatewayHostIdentity {
  if (!value || typeof value !== "object") return false;
  const host = value as Partial<ModelGatewayHostIdentity>;
  return (
    host.schemaVersion === 1 &&
    host.runtimeKind === "bun" &&
    typeof host.version === "string" &&
    typeof host.revision === "string" &&
    typeof host.provenance === "string" &&
    typeof host.sha256 === "string" &&
    typeof host.platform === "string" &&
    typeof host.arch === "string" &&
    typeof host.packageName === "string" &&
    (host.source === "bundled" || host.source === "repository")
  );
}

function isExactHostIdentityPredecessor(
  observed: ModelGatewayHostIdentity,
  desired: ModelGatewayHostIdentity,
): boolean {
  const normalized = {
    ...observed,
    source: observed.source === "repository" ? "bundled" : observed.source,
    packageName:
      observed.packageName === "@kilnai/model-gateway-host"
        ? "@kilnai/model-gateway-host-win32-x64"
        : observed.packageName,
  } satisfies ModelGatewayHostIdentity;
  return sameHost(normalized, desired);
}

function sameHost(left: ModelGatewayHostIdentity, right: ModelGatewayHostIdentity): boolean {
  return (
    left.schemaVersion === right.schemaVersion &&
    left.runtimeKind === right.runtimeKind &&
    left.version === right.version &&
    left.revision === right.revision &&
    left.provenance === right.provenance &&
    left.sha256 === right.sha256 &&
    left.platform === right.platform &&
    left.arch === right.arch &&
    left.packageName === right.packageName &&
    left.source === right.source
  );
}

function absoluteDirectory(path: string, label: string): string {
  if (!path.trim() || !isAbsolute(path)) throw new Error(`${label} must be an absolute path.`);
  return resolve(path);
}

function confinedJoin(base: string, ...segments: readonly string[]): string {
  const target = resolve(base, ...segments);
  const path = relative(base, target);
  if (path === "" || path.startsWith("..") || isAbsolute(path))
    throw new Error("Model gateway host path escapes the Kiln runtime directory.");
  return target;
}

function relativeExecutable(destination: string, executable: string): string {
  if (!executable || isAbsolute(executable) || basename(executable) !== executable)
    throw new Error("Installed model gateway host manifest executable must be a single relative filename.");
  return confinedJoin(destination, executable);
}

function isFsCode(error: unknown, code: string): boolean {
  return !!error && typeof error === "object" && (error as { readonly code?: unknown }).code === code;
}
