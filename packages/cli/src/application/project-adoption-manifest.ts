import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { chmodSync, type Dirent, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import type { ProjectStateBinding } from "./project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "./private-project-state-filesystem.js";

export type ProjectStateSourceDigest = "absent" | `sha256:${string}`;

export interface ProjectStateSourceDigests {
  readonly config: ProjectStateSourceDigest;
  readonly context: ProjectStateSourceDigest;
  readonly agents: ProjectStateSourceDigest;
  readonly instructions: ProjectStateSourceDigest;
  readonly skills: ProjectStateSourceDigest;
}

export interface ProjectAdoptionManifest {
  readonly version: 1;
  readonly projectRuntimeId: `krp_${string}`;
}

export type ProjectAdoptionRejectionReason = "missing" | "malformed" | "non-canonical" | "copied" | "unsafe-manifest";

export type ProjectAdoptionResolution =
  | {
      readonly status: "adopted";
      readonly manifest: ProjectAdoptionManifest;
      readonly adoptionRevision: `sha256:${string}`;
    }
  | {
      readonly status: "unadopted";
      readonly reason: ProjectAdoptionRejectionReason;
    };

export interface ProjectAdoptionBootstrapResult {
  readonly status: "written" | "unchanged";
  readonly manifest: ProjectAdoptionManifest;
  readonly adoptionRevision: `sha256:${string}`;
}

const PROJECT_STATE_SOURCE_DOMAIN = "kiln:project-state-source:v1\0";

/** Capture stable, path-independent source digests for one private project state. */
export function captureProjectStateSourceDigests(binding: ProjectStateBinding): ProjectStateSourceDigests {
  const canonicalStateRoot = resolve(binding.projectStateRoot);
  assertSafeDirectoryChain(canonicalStateRoot);
  return {
    config: captureSourceDigest(canonicalStateRoot, binding.configPath),
    context: captureSourceDigest(canonicalStateRoot, binding.contextPath),
    agents: captureSourceDigest(canonicalStateRoot, binding.agentsPath),
    instructions: captureSourceDigest(canonicalStateRoot, binding.instructionsPath),
    skills: captureSourceDigest(canonicalStateRoot, binding.skillsPath),
  };
}

/**
 * Create the private identity binding after private sources have been
 * published. The final file is created with `wx`, so an existing binding can
 * never be overwritten by a concurrent or copied adoption.
 */
export function bootstrapProjectAdoption(binding: ProjectStateBinding): ProjectAdoptionBootstrapResult {
  const manifest = makeManifest(binding.projectRuntimeId);
  const canonicalBytes = serializeProjectAdoptionManifest(manifest);
  ensurePrivateStateDirectorySync(binding.projectStateRoot, binding.projectStateRoot);
  chmodSync(binding.projectStateRoot, 0o700);
  // Validate the published private sources before making the identity
  // durable. Their mutable content belongs to Runtime project-state, not to
  // this manifest, so the capture is intentionally not persisted here.
  captureProjectStateSourceDigests(binding);
  assertPrivateStateFileTargetSync(binding.projectStateRoot, binding.adoptionManifestPath);

  try {
    writeFileSync(binding.adoptionManifestPath, canonicalBytes, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if (!isExistsError(error)) throw error;
    const existing = readStableFile(binding.adoptionManifestPath);
    if (existing === null) throw new Error("Project adoption manifest disappeared during bootstrap.");
    const parsed = parseCanonicalManifest(existing);
    if (!parsed || parsed.projectRuntimeId !== binding.projectRuntimeId) {
      throw new Error("Project adoption manifest already exists for another project identity.");
    }
    if (existing !== canonicalBytes)
      throw new Error("Project adoption manifest already exists with different identity.");
    chmodSync(binding.adoptionManifestPath, 0o600);
    return {
      status: "unchanged",
      manifest: parsed,
      adoptionRevision: digestBytes(existing),
    };
  }
  return {
    status: "written",
    manifest,
    adoptionRevision: digestBytes(canonicalBytes),
  };
}

/** Read and verify one private adoption binding without any legacy fallback. */
export function readProjectAdoption(binding: ProjectStateBinding): ProjectAdoptionResolution {
  let bytes: string;
  try {
    assertSafeDirectoryChain(binding.projectStateRoot);
    const stat = lstatSync(binding.adoptionManifestPath);
    if (!stat.isFile() || stat.isSymbolicLink()) return { status: "unadopted", reason: "unsafe-manifest" };
    const first = readStableFile(binding.adoptionManifestPath);
    if (first === null) return { status: "unadopted", reason: "missing" };
    bytes = first;
  } catch (error) {
    return { status: "unadopted", reason: isMissingError(error) ? "missing" : "unsafe-manifest" };
  }

  const manifest = parseManifestShape(bytes);
  if (manifest === null) return { status: "unadopted", reason: "malformed" };
  if (serializeProjectAdoptionManifest(manifest) !== bytes) {
    return { status: "unadopted", reason: "non-canonical" };
  }
  if (manifest.projectRuntimeId !== binding.projectRuntimeId) {
    return { status: "unadopted", reason: "copied" };
  }

  return {
    status: "adopted",
    manifest,
    adoptionRevision: digestBytes(bytes),
  };
}

/** Canonical JSON bytes used for hashing and durable writes. */
export function serializeProjectAdoptionManifest(manifest: ProjectAdoptionManifest): string {
  return `${JSON.stringify({
    version: manifest.version,
    projectRuntimeId: manifest.projectRuntimeId,
  })}\n`;
}

function makeManifest(projectRuntimeId: `krp_${string}`): ProjectAdoptionManifest {
  assertProjectRuntimeId(projectRuntimeId);
  return { version: 1, projectRuntimeId };
}

function parseCanonicalManifest(bytes: string): ProjectAdoptionManifest | null {
  const manifest = parseManifestShape(bytes);
  return manifest !== null && serializeProjectAdoptionManifest(manifest) === bytes ? manifest : null;
}

function parseManifestShape(bytes: string): ProjectAdoptionManifest | null {
  let value: unknown;
  try {
    value = JSON.parse(bytes) as unknown;
  } catch {
    return null;
  }
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isProjectRuntimeId(value.projectRuntimeId) ||
    Object.keys(value).length !== 2
  )
    return null;
  return makeManifest(value.projectRuntimeId);
}

function captureSourceDigest(root: string, sourcePath: string | null | undefined): ProjectStateSourceDigest {
  if (sourcePath === null || sourcePath === undefined) return "absent";
  const absolutePath = resolve(sourcePath);
  if (!isInsideOrEqual(root, absolutePath)) throw new UnsafeSourceError("Source is outside the project root.");
  const kind = trySourceKind(absolutePath);
  if (kind === "absent") return "absent";
  if (kind === "unsafe") throw new UnsafeSourceError("Source contains a link, reparse point, or special entry.");
  assertSafeSourcePathChain(root, absolutePath);
  if (kind === "file") {
    const bytes = readStableBytes(absolutePath);
    return digestBytesWithDomain("file", bytes);
  }

  const before = requireDirectoryStat(absolutePath);
  const records = captureDirectoryRecords(absolutePath, "");
  const after = requireDirectoryStat(absolutePath);
  if (!sameStat(before, after)) throw new UnstableSourceError("Source directory changed during capture.");
  const canonical = [PROJECT_STATE_SOURCE_DOMAIN, "directory\0", ...records].join("");
  return digestText(canonical);
}

function captureDirectoryRecords(directory: string, relativeDirectory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true }).sort(compareDirents);
  const records: string[] = [];
  for (const entry of entries) {
    const child = join(directory, entry.name);
    // Keep `/` as the canonical snapshot separator while preserving a valid
    // POSIX `\\` filename byte-for-byte inside the JSON string.
    const relativePath = relativeDirectory.length === 0 ? entry.name : `${relativeDirectory}/${entry.name}`;
    const kind = trySourceKind(child);
    if (kind === "unsafe") throw new UnsafeSourceError("Source contains a link, reparse point, or special entry.");
    if (kind === "absent") throw new UnstableSourceError("Source entry disappeared during capture.");
    if (kind === "file") {
      const bytes = readStableBytes(child);
      records.push(`${JSON.stringify(["file", relativePath, digestBytesWithDomain("content", bytes)])}\0`);
    } else {
      records.push(`${JSON.stringify(["directory", relativePath])}\0`);
      records.push(...captureDirectoryRecords(child, relativePath));
    }
  }
  return records;
}

function readStableBytes(path: string): Buffer {
  try {
    const first = requireRegularFileStat(path);
    const bytes = readFileSync(path);
    const second = requireRegularFileStat(path);
    if (!sameStat(first, second)) throw new UnstableSourceError("Source file changed during capture.");
    const secondBytes = readFileSync(path);
    if (!bytes.equals(secondBytes)) throw new UnstableSourceError("Source file changed during capture.");
    return bytes;
  } catch (error) {
    if (isMissingError(error)) throw new UnstableSourceError("Source file disappeared during capture.");
    throw error;
  }
}

function readStableFile(path: string): string | null {
  try {
    const first = requireRegularFileStat(path);
    const bytes = readFileSync(path, "utf8");
    const second = requireRegularFileStat(path);
    if (!sameStat(first, second)) throw new UnstableSourceError("Manifest changed during capture.");
    if (bytes !== readFileSync(path, "utf8")) throw new UnstableSourceError("Manifest changed during capture.");
    return bytes;
  } catch (error) {
    if (isMissingError(error)) return null;
    throw error;
  }
}

/** Reject a private state path that crosses a link, reparse point, or special entry. */
function assertSafeDirectoryChain(path: string): void {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  const segments = relative(root, absolutePath)
    .split(/[\\/]+/u)
    .filter((segment) => segment.length > 0 && segment !== ".");
  let current = root;
  for (const segment of segments) {
    current = join(current, segment);
    let stat: Stats;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (isMissingError(error)) return;
      throw error;
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new UnsafeManifestError("Private state path contains an unsafe entry.");
    }
  }
}

function trySourceKind(path: string): "absent" | "file" | "directory" | "unsafe" {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return "unsafe";
    return stat.isFile() ? "file" : "directory";
  } catch (error) {
    return isMissingError(error) ? "absent" : "unsafe";
  }
}

function assertSafeSourcePathChain(root: string, target: string): void {
  const relativeTarget = relative(root, target);
  let current = root;
  if (relativeTarget.length === 0) return;
  const segments = relativeTarget.split(/[\\/]+/u).filter((segment) => segment.length > 0 && segment !== ".");
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (index < segments.length - 1 && !stat.isDirectory())) {
      throw new UnsafeSourceError("Source path contains a link, reparse point, or special entry.");
    }
  }
}

function requireRegularFileStat(path: string): Stats {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new UnsafeSourceError("Expected a regular source file.");
  return stat;
}

function requireDirectoryStat(path: string): Stats {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new UnsafeSourceError("Expected a regular source directory.");
  return stat;
}

function sameStat(left: Stats, right: Stats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.mode === right.mode
  );
}

function compareDirents(left: Dirent, right: Dirent): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function digestBytes(bytes: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes, "utf8").digest("hex")}`;
}

function digestBytesWithDomain(kind: string, bytes: Buffer): `sha256:${string}` {
  return digestText(
    `${PROJECT_STATE_SOURCE_DOMAIN}${kind}\0${bytes.byteLength}\0${createHash("sha256").update(bytes).digest("hex")}\0`,
  );
}

function digestText(value: string): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function assertProjectRuntimeId(value: string): asserts value is `krp_${string}` {
  if (!isProjectRuntimeId(value)) throw new TypeError("Project adoption identity is malformed.");
}

function isProjectRuntimeId(value: unknown): value is `krp_${string}` {
  return typeof value === "string" && /^krp_[a-f0-9]{64}$/u.test(value);
}

function isInsideOrEqual(ancestor: string, candidate: string): boolean {
  const path = relative(ancestor, candidate);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    ((error as { readonly code?: unknown }).code === "ENOENT" ||
      (error as { readonly code?: unknown }).code === "ENOTDIR")
  );
}

function isExistsError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "EEXIST"
  );
}

class UnsafeSourceError extends Error {}
class UnstableSourceError extends Error {}
class UnsafeManifestError extends Error {}
