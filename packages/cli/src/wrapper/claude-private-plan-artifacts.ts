import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { ExecutionSessionEphemeralHarnessStateEvidence } from "@kilnai/core";

/**
 * The only Claude private artifact location admitted by Kiln. The exact
 * version is intentional: a moving harness version cannot silently change the
 * location or retention semantics of the operator's credential home.
 */
export const CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY = Object.freeze({
  capabilityId: "claude-code-private-plan-artifacts-v1",
  harness: "claude-code",
  version: "2.1.220",
  relativeDirectory: "plans",
} as const);

export const CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY_2_1_226 = Object.freeze({
  capabilityId: "claude-code-private-plan-artifacts-v1",
  harness: "claude-code",
  version: "2.1.226",
  relativeDirectory: "plans",
} as const);

/**
 * Explicitly admitted Claude Code versions. Keep this list exact: a new
 * executable version needs fresh artifact-location evidence before admission.
 */
export const CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITIES = Object.freeze([
  CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY,
  CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITY_2_1_226,
] as const);

/** The lock lives beside the admitted plans directory, never in a generic home. */
export const CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE = ".kiln-claude-private-plan-artifacts.lock";

const PRIVATE_PLAN_LOCK_SCHEMA = 1 as const;

/**
 * A selected Claude account is unavailable while its owner lock exists. The
 * lock is intentionally never stolen: without a durable artifact snapshot,
 * removing an orphan could make a concurrent owner unsafe.
 */
export class ClaudePrivatePlanArtifactUnavailableError extends Error {
  readonly code = "claude_private_plan_artifact_unavailable" as const;
  readonly repairAction = "verify no active owner, then remove the lock before retrying" as const;

  constructor() {
    super("Claude private plan artifact capability is unavailable; repair the selected account lock before retrying");
    this.name = "ClaudePrivatePlanArtifactUnavailableError";
  }
}

export type ClaudePrivatePlanArtifactCapability = (typeof CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITIES)[number];

export function resolveClaudePrivatePlanArtifactCapability(
  harnessVersion: string | undefined,
): ClaudePrivatePlanArtifactCapability | undefined {
  const normalizedVersion = harnessVersion?.trim();
  return CLAUDE_PRIVATE_PLAN_ARTIFACT_CAPABILITIES.find(
    (capability) => capability.version === normalizedVersion,
  );
}

/**
 * Tracks only the version-admitted plans directory inside the selected
 * CLAUDE_CONFIG_DIR. It never reads, copies, or reports the surrounding auth
 * home and always restores the observed plan artifacts before returning. A
 * process-local keyed lease is paired with an exclusive lock file in the
 * selected physical config directory so independent Kiln processes cannot
 * share one selected home. Existing locks fail closed and are never stolen.
 */
export interface ClaudePrivatePlanArtifactTracker {
  snapshot(): Promise<void>;
  finalize(): Promise<ExecutionSessionEphemeralHarnessStateEvidence>;
}

export function createClaudePrivatePlanArtifactTracker(input: {
  readonly capability: ClaudePrivatePlanArtifactCapability;
  readonly selectedConfigDir: string | undefined;
}): ClaudePrivatePlanArtifactTracker | undefined {
  const selectedConfigDir = input.selectedConfigDir?.trim();
  if (!selectedConfigDir) return undefined;

  return new FilesystemClaudePrivatePlanArtifactTracker(selectedConfigDir, input.capability);
}

interface PrivatePlanFile {
  readonly relativePath: string;
  readonly contents: Uint8Array;
}

interface PhysicalDirectoryIdentity {
  readonly canonicalPath: string;
  readonly device: number;
  readonly inode: number;
  readonly birthtimeMs: number;
}

interface PrivatePlanTree {
  readonly files: ReadonlyMap<string, PrivatePlanFile>;
  readonly directories: ReadonlySet<string>;
}

interface PrivatePlanSnapshot {
  readonly selectedConfig: PhysicalDirectoryIdentity;
  readonly root: PhysicalDirectoryIdentity;
  readonly files: ReadonlyMap<string, PrivatePlanFile>;
  readonly directories: ReadonlySet<string>;
}

interface PrivatePlanLockDocument {
  readonly schema: typeof PRIVATE_PLAN_LOCK_SCHEMA;
  readonly pid: number;
  readonly token: string;
}

const privatePlanLeaseTails = new Map<string, Promise<void>>();

async function acquirePrivatePlanLease(key: string): Promise<() => void> {
  const previous = privatePlanLeaseTails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const held = new Promise<void>((resolveHeld) => {
    release = resolveHeld;
  });
  const tail = previous.then(() => held);
  privatePlanLeaseTails.set(key, tail);
  await previous;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (privatePlanLeaseTails.get(key) === tail) {
      privatePlanLeaseTails.delete(key);
    }
  };
}

async function acquirePrivatePlanArtifactLock(
  selectedConfigPath: string,
  selectedConfig: PhysicalDirectoryIdentity,
): Promise<() => Promise<void>> {
  const lockPath = join(selectedConfig.canonicalPath, CLAUDE_PRIVATE_PLAN_ARTIFACT_LOCK_FILE);
  const owner: PrivatePlanLockDocument = {
    schema: PRIVATE_PLAN_LOCK_SCHEMA,
    pid: process.pid,
    token: randomUUID(),
  };
  let lockIdentity: Awaited<ReturnType<typeof lstat>>;
  try {
    assertSamePhysicalIdentity(selectedConfig, await inspectPhysicalDirectory(selectedConfigPath));
    await writeFile(lockPath, `${JSON.stringify(owner)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    lockIdentity = await lstat(lockPath);
    if (lockIdentity.isSymbolicLink() || !lockIdentity.isFile()) {
      throw new ClaudePrivatePlanArtifactUnavailableError();
    }
    assertSamePhysicalIdentity(selectedConfig, await inspectPhysicalDirectory(selectedConfigPath));
  } catch (error) {
    if (error instanceof ClaudePrivatePlanArtifactUnavailableError) throw error;
    throw new ClaudePrivatePlanArtifactUnavailableError();
  }

  const capturedLockIdentity = captureFileIdentity(lockIdentity);
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      assertSamePhysicalIdentity(selectedConfig, await inspectPhysicalDirectory(selectedConfigPath));
      const currentLockIdentity = await lstat(lockPath);
      if (currentLockIdentity.isSymbolicLink() || !currentLockIdentity.isFile()) {
        throw new ClaudePrivatePlanArtifactUnavailableError();
      }
      if (!sameFileIdentity(capturedLockIdentity, currentLockIdentity)) {
        throw new ClaudePrivatePlanArtifactUnavailableError();
      }
      assertSamePhysicalIdentity(selectedConfig, await inspectPhysicalDirectory(selectedConfigPath));
      const currentOwner = await readPrivatePlanLockDocument(lockPath, capturedLockIdentity);
      if (
        currentOwner.schema !== owner.schema
        || currentOwner.pid !== owner.pid
        || currentOwner.token !== owner.token
      ) {
        throw new ClaudePrivatePlanArtifactUnavailableError();
      }
      assertSamePhysicalIdentity(selectedConfig, await inspectPhysicalDirectory(selectedConfigPath));
      await unlink(lockPath);
    } catch (error) {
      if (error instanceof ClaudePrivatePlanArtifactUnavailableError) throw error;
      throw new ClaudePrivatePlanArtifactUnavailableError();
    }
  };
}

async function readPrivatePlanLockDocument(
  path: string,
  expectedIdentity: PhysicalFileIdentity,
): Promise<PrivatePlanLockDocument> {
  let parsed: unknown;
  try {
    const contents = await readFile(path, "utf8");
    const afterReadIdentity = await lstat(path);
    if (afterReadIdentity.isSymbolicLink() || !afterReadIdentity.isFile() || !sameFileIdentity(expectedIdentity, afterReadIdentity)) {
      throw new ClaudePrivatePlanArtifactUnavailableError();
    }
    parsed = JSON.parse(contents) as unknown;
  } catch {
    throw new ClaudePrivatePlanArtifactUnavailableError();
  }
  if (!isPrivatePlanLockDocument(parsed)) {
    throw new ClaudePrivatePlanArtifactUnavailableError();
  }
  return parsed;
}

function isPrivatePlanLockDocument(value: unknown): value is PrivatePlanLockDocument {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return keys.length === 3
    && keys[0] === "pid"
    && keys[1] === "schema"
    && keys[2] === "token"
    && record.schema === PRIVATE_PLAN_LOCK_SCHEMA
    && typeof record.pid === "number"
    && Number.isSafeInteger(record.pid)
    && record.pid > 0
    && typeof record.token === "string"
    && record.token.length > 0
    && record.token.length <= 128;
}

interface PhysicalFileIdentity {
  readonly device: number;
  readonly inode: number;
  readonly birthtimeMs: number;
  readonly ctimeMs: number;
}

function captureFileIdentity(stat: Awaited<ReturnType<typeof lstat>>): PhysicalFileIdentity {
  return {
    device: Number(stat.dev),
    inode: Number(stat.ino),
    birthtimeMs: Number(stat.birthtimeMs),
    ctimeMs: Number(stat.ctimeMs),
  };
}

function sameFileIdentity(
  expected: PhysicalFileIdentity,
  actual: Awaited<ReturnType<typeof lstat>>,
): boolean {
  const current = captureFileIdentity(actual);
  return expected.device === current.device
    && expected.inode === current.inode
    && expected.birthtimeMs === current.birthtimeMs
    && expected.ctimeMs === current.ctimeMs;
}

class FilesystemClaudePrivatePlanArtifactTracker implements ClaudePrivatePlanArtifactTracker {
  private snapshotState: PrivatePlanSnapshot | undefined;
  private snapshotPromise: Promise<void> | undefined;
  private finalizePromise: Promise<ExecutionSessionEphemeralHarnessStateEvidence> | undefined;
  private leaseRelease: (() => Promise<void>) | undefined;
  private rootPath: string | undefined;

  constructor(
    private readonly selectedConfigDir: string,
    private readonly capability: ClaudePrivatePlanArtifactCapability,
  ) {}

  async snapshot(): Promise<void> {
    if (this.snapshotState !== undefined) return;

    if (this.snapshotPromise !== undefined) {
      await this.snapshotPromise;
      return;
    }

    const snapshotPromise = this.snapshotInternal();
    this.snapshotPromise = snapshotPromise;
    try {
      await snapshotPromise;
    } finally {
      if (this.snapshotPromise === snapshotPromise) this.snapshotPromise = undefined;
    }
  }

  private async snapshotInternal(): Promise<void> {
    if (this.snapshotState !== undefined) return;

    const selectedConfig = await inspectPhysicalDirectory(this.selectedConfigDir);
    const processLeaseRelease = await acquirePrivatePlanLease(canonicalLeaseKey(selectedConfig.canonicalPath));
    let processLeaseReleased = false;
    const releaseProcessLease = (): void => {
      if (processLeaseReleased) return;
      processLeaseReleased = true;
      processLeaseRelease();
    };
    try {
      const verifiedSelectedConfig = await inspectPhysicalDirectory(this.selectedConfigDir);
      assertSamePhysicalIdentity(selectedConfig, verifiedSelectedConfig);
      const durableLeaseRelease = await acquirePrivatePlanArtifactLock(this.selectedConfigDir, verifiedSelectedConfig);
      this.leaseRelease = async () => {
        try {
          await durableLeaseRelease();
        } finally {
          releaseProcessLease();
        }
      };
      const rootPath = join(verifiedSelectedConfig.canonicalPath, this.capability.relativeDirectory);
      const root = await inspectPhysicalDirectory(rootPath);
      const tree = await scanPlanTree(root.canonicalPath);
      this.rootPath = root.canonicalPath;
      this.snapshotState = {
        selectedConfig: verifiedSelectedConfig,
        root,
        files: tree.files,
        directories: tree.directories,
      };
    } catch (error) {
      try {
        await this.releaseLease();
      } finally {
        releaseProcessLease();
      }
      throw error;
    }
  }

  async finalize(): Promise<ExecutionSessionEphemeralHarnessStateEvidence> {
    if (this.finalizePromise !== undefined) return this.finalizePromise;
    this.finalizePromise = this.finalizeInternal();
    return this.finalizePromise;
  }

  private async finalizeInternal(): Promise<ExecutionSessionEphemeralHarnessStateEvidence> {
    let changes: readonly PrivatePlanChange[] = [];
    let cleanupStatus: "completed" | "failed" = "completed";
    try {
      await this.snapshotPromise;
      const snapshot = this.snapshotState;
      if (snapshot === undefined || this.rootPath === undefined) throw new Error("Claude private plan artifact snapshot is missing");
      const selectedConfig = await inspectPhysicalDirectory(this.selectedConfigDir);
      assertSamePhysicalIdentity(snapshot.selectedConfig, selectedConfig);
      const root = await inspectPhysicalDirectory(this.rootPath);
      assertSamePhysicalIdentity(snapshot.root, root);
      const current = await scanPlanTree(root.canonicalPath);
      assertCompatibleTreeShape(snapshot, current);
      changes = classifyChanges(snapshot.files, current.files);
      await restoreSnapshot(root.canonicalPath, snapshot, current);
    } catch {
      cleanupStatus = "failed";
    }
    finally {
      try {
        await this.releaseLease();
      } catch {
        cleanupStatus = "failed";
      }
    }

    return {
      capabilityId: this.capability.capabilityId,
      harness: this.capability.harness,
      artifactCount: changes.length,
      createdCount: changes.filter((change) => change.kind === "created").length,
      modifiedCount: changes.filter((change) => change.kind === "modified").length,
      deletedCount: changes.filter((change) => change.kind === "deleted").length,
      artifactDigest: digestChanges(changes),
      cleanupStatus,
      // The tracker is deliberately scoped to the admitted directory. Any
      // broader private delta must arrive as explicit runtime evidence rather
      // than being inferred from or exposed through the credential home.
      unexpectedDelta: false,
    };
  }

  private async releaseLease(): Promise<void> {
    const release = this.leaseRelease;
    this.leaseRelease = undefined;
    if (release) await release();
  }
}

interface PrivatePlanChange {
  readonly kind: "created" | "modified" | "deleted";
  readonly relativePath: string;
  readonly contents?: Uint8Array;
}

function classifyChanges(
  before: ReadonlyMap<string, PrivatePlanFile>,
  after: ReadonlyMap<string, PrivatePlanFile>,
): readonly PrivatePlanChange[] {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const changes: PrivatePlanChange[] = [];
  for (const relativePath of paths) {
    const previous = before.get(relativePath);
    const current = after.get(relativePath);
    if (!previous && current) {
      changes.push({ kind: "created", relativePath, contents: current.contents });
    } else if (previous && !current) {
      changes.push({ kind: "deleted", relativePath });
    } else if (previous && current && !bytesEqual(previous.contents, current.contents)) {
      changes.push({ kind: "modified", relativePath, contents: current.contents });
    }
  }
  return changes;
}

async function restoreSnapshot(
  rootPath: string,
  snapshot: PrivatePlanSnapshot,
  current: PrivatePlanTree,
): Promise<void> {
  assertSamePhysicalIdentity(snapshot.root, await inspectPhysicalDirectory(rootPath));

  for (const relativePath of [...current.files.keys()].sort()) {
    if (snapshot.files.has(relativePath)) continue;
    await assertRootUnchanged(rootPath, snapshot.root);
    const absolutePath = safeChildPath(rootPath, relativePath);
    await assertPhysicalDescendantDirectory(rootPath, snapshot.root, dirname(absolutePath));
    const stat = await lstat(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error("Claude private plan artifact tree changed during cleanup");
    }
    await unlink(absolutePath);
  }

  const unknownDirectories = [...current.directories]
    .filter((relativePath) => !snapshot.directories.has(relativePath))
    .sort((left, right) => directoryDepth(right) - directoryDepth(left));
  for (const relativePath of unknownDirectories) {
    await assertRootUnchanged(rootPath, snapshot.root);
    const absolutePath = safeChildPath(rootPath, relativePath);
    await assertPhysicalDescendantDirectory(rootPath, snapshot.root, dirname(absolutePath));
    let stat;
    try {
      stat = await lstat(absolutePath);
    } catch (error) {
      if (isMissingPathError(error)) continue;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("Claude private plan artifact tree changed during cleanup");
    }
    try {
      await rm(absolutePath, { recursive: false, force: false });
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }

  for (const relativePath of [...snapshot.directories].sort((left, right) => directoryDepth(left) - directoryDepth(right))) {
    await assertRootUnchanged(rootPath, snapshot.root);
    await ensurePhysicalDirectory(rootPath, snapshot.root, safeChildPath(rootPath, relativePath));
  }

  for (const [relativePath, file] of [...snapshot.files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await assertRootUnchanged(rootPath, snapshot.root);
    const absolutePath = safeChildPath(rootPath, relativePath);
    await ensurePhysicalDirectory(rootPath, snapshot.root, dirname(absolutePath));
    await writeFileAtomically(rootPath, snapshot.root, absolutePath, file.contents);
  }
  await assertRootUnchanged(rootPath, snapshot.root);
}

async function scanPlanTree(rootPath: string): Promise<PrivatePlanTree> {
  const files = new Map<string, PrivatePlanFile>();
  const directories = new Set<string>();
  const visit = async (currentPath: string): Promise<void> => {
    const currentRelativePath = relative(rootPath, currentPath).split(sep).join("/");
    if (currentRelativePath.length > 0) directories.add(currentRelativePath);
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(currentPath, entry.name);
      const entryStat = await lstat(absolutePath);
      if (entryStat.isSymbolicLink()) {
        throw new Error("Claude private plan artifact tree contains a symlink");
      }
      if (entryStat.isDirectory()) {
        await visit(absolutePath);
      } else if (entryStat.isFile()) {
        const relativePath = relative(rootPath, absolutePath).split(sep).join("/");
        const contents = await readFile(absolutePath);
        const afterReadStat = await lstat(absolutePath);
        if (!sameNodeIdentity(entryStat, afterReadStat) || afterReadStat.isSymbolicLink() || !afterReadStat.isFile()) {
          throw new Error("Claude private plan artifact tree changed during inspection");
        }
        files.set(relativePath, { relativePath, contents });
      } else {
        // Never follow a link or special file from the credential-owned home.
        throw new Error("Claude private plan artifact tree contains an unsupported entry");
      }
    }
  };
  await visit(rootPath);
  return { files, directories };
}

function assertCompatibleTreeShape(snapshot: PrivatePlanSnapshot, current: PrivatePlanTree): void {
  for (const relativePath of snapshot.files.keys()) {
    if (current.directories.has(relativePath)) {
      throw new Error("Claude private plan artifact file changed into a directory");
    }
  }
  for (const relativePath of snapshot.directories) {
    if (current.files.has(relativePath)) {
      throw new Error("Claude private plan artifact directory changed into a file");
    }
  }
}

async function inspectPhysicalDirectory(path: string): Promise<PhysicalDirectoryIdentity> {
  let stat;
  try {
    stat = await lstat(path);
  } catch {
    throw new Error("Claude private plan artifact location is unavailable");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Claude private plan artifact location must be a physical directory");
  }
  let canonicalPath: string;
  let canonicalStat;
  try {
    canonicalPath = await realpath(path);
    canonicalStat = await lstat(canonicalPath);
  } catch {
    throw new Error("Claude private plan artifact location could not be canonicalized");
  }
  if (canonicalStat.isSymbolicLink() || !canonicalStat.isDirectory() || !sameNodeIdentity(stat, canonicalStat)) {
    throw new Error("Claude private plan artifact location identity is unsafe");
  }
  return {
    canonicalPath,
    device: canonicalStat.dev,
    inode: canonicalStat.ino,
    birthtimeMs: canonicalStat.birthtimeMs,
  };
}

function assertSamePhysicalIdentity(expected: PhysicalDirectoryIdentity, actual: PhysicalDirectoryIdentity): void {
  if (
    canonicalLeaseKey(expected.canonicalPath) !== canonicalLeaseKey(actual.canonicalPath)
    || expected.device !== actual.device
    || expected.inode !== actual.inode
    || expected.birthtimeMs !== actual.birthtimeMs
  ) {
    throw new Error("Claude private plan artifact location identity changed");
  }
}

async function assertRootUnchanged(rootPath: string, expected: PhysicalDirectoryIdentity): Promise<void> {
  assertSamePhysicalIdentity(expected, await inspectPhysicalDirectory(rootPath));
}

function canonicalLeaseKey(path: string): string {
  const canonicalPath = resolve(path);
  return process.platform === "win32" ? canonicalPath.toLowerCase() : canonicalPath;
}

function safeChildPath(rootPath: string, relativePath: string): string {
  const childPath = resolve(rootPath, ...relativePath.split("/"));
  const canonicalRoot = resolve(rootPath);
  if (childPath !== canonicalRoot && !childPath.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error("Claude private plan artifact path escapes its admitted root");
  }
  return childPath;
}

async function ensurePhysicalDirectory(
  rootPath: string,
  expectedRoot: PhysicalDirectoryIdentity,
  path: string,
): Promise<void> {
  const relativePath = relative(rootPath, path);
  if (relativePath.startsWith(`..${sep}`) || relativePath === "..") {
    throw new Error("Claude private plan artifact parent escapes its admitted root");
  }
  let currentPath = rootPath;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    await assertRootUnchanged(rootPath, expectedRoot);
    currentPath = join(currentPath, segment);
    try {
      await mkdir(currentPath, { recursive: false });
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
    await assertPhysicalDescendantDirectory(rootPath, expectedRoot, currentPath);
  }
  await assertPhysicalDescendantDirectory(rootPath, expectedRoot, currentPath);
}

async function writeFileAtomically(
  rootPath: string,
  expectedRoot: PhysicalDirectoryIdentity,
  path: string,
  contents: Uint8Array,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let operationError: unknown;
  try {
    await assertPhysicalDescendantDirectory(rootPath, expectedRoot, dirname(path));
    await writeFile(temporaryPath, contents, { flag: "wx" });
    const targetStat = await optionalLstat(path);
    if (targetStat !== undefined && (targetStat.isSymbolicLink() || !targetStat.isFile())) {
      throw new Error("Claude private plan artifact target is not a regular file");
    }
    await assertPhysicalDescendantDirectory(rootPath, expectedRoot, dirname(path));
    await rename(temporaryPath, path);
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      await assertPhysicalDescendantDirectory(rootPath, expectedRoot, dirname(path));
      await rm(temporaryPath, { force: true });
    } catch (cleanupError) {
      if (operationError === undefined) throw cleanupError;
    }
  }
}

async function assertPhysicalDescendantDirectory(
  rootPath: string,
  expectedRoot: PhysicalDirectoryIdentity,
  path: string,
): Promise<void> {
  await assertRootUnchanged(rootPath, expectedRoot);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Claude private plan artifact parent is not a physical directory");
  }
  const canonicalPath = await realpath(path);
  const canonicalRoot = canonicalLeaseKey(expectedRoot.canonicalPath);
  const canonicalChild = canonicalLeaseKey(canonicalPath);
  if (canonicalChild !== canonicalRoot && !canonicalChild.startsWith(`${canonicalRoot}${sep}`)) {
    throw new Error("Claude private plan artifact parent escapes its admitted root");
  }
}

async function optionalLstat(path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) return undefined;
    throw error;
  }
}

function directoryDepth(path: string): number {
  return path.split("/").filter(Boolean).length;
}

function sameNodeIdentity(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.birthtimeMs === right.birthtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

/*
 * Keep the error boundary below intentionally path-free. The caller exposes
 * only typed evidence, never these filesystem identities.
 */
function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error
    && ((error as NodeJS.ErrnoException).code === "ENOENT"
      || (error as NodeJS.ErrnoException).code === "ENOTDIR");
}

function digestChanges(changes: readonly PrivatePlanChange[]): string {
  const digest = createHash("sha256");
  for (const change of changes) {
    digest.update(change.kind);
    digest.update("\0");
    digest.update(change.relativePath);
    digest.update("\0");
    if (change.contents) digest.update(createHash("sha256").update(change.contents).digest("hex"));
    digest.update("\n");
  }
  return digest.digest("hex");
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
