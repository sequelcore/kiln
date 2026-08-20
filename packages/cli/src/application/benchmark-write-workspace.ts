import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  hashBenchmarkWorkspace,
  resolveBenchmarkWorkspace,
  verifyBenchmarkWorkspaceUnchanged,
} from "./benchmark-workspace.js";

export interface BenchmarkWriteWorkspaceFile {
  readonly path: string;
  readonly hash: string;
}

export interface BenchmarkWriteWorkspaceChangedFile {
  readonly path: string;
  readonly beforeHash: string;
  readonly afterHash: string;
}

export interface BenchmarkWriteWorkspaceChanges {
  readonly changed: readonly BenchmarkWriteWorkspaceChangedFile[];
  readonly added: readonly BenchmarkWriteWorkspaceFile[];
  readonly deleted: readonly BenchmarkWriteWorkspaceFile[];
}

export interface BenchmarkWriteWorkspaceSnapshot {
  readonly files: readonly BenchmarkWriteWorkspaceFile[];
}

export interface BenchmarkWriteWorkspaceLease {
  readonly rootPath: string;
  readonly canonicalHash: string;
  readonly initialSnapshot: BenchmarkWriteWorkspaceSnapshot;
  collectChanges(): BenchmarkWriteWorkspaceChanges;
  verifyCanonicalUnchanged(): void;
  cleanup(): void;
}

interface WorkspaceSnapshot {
  readonly files: ReadonlyMap<string, string>;
}

export function createBenchmarkWriteWorkspaceLease(
  repositoryRoot: string,
  workspaceFixture: unknown,
): BenchmarkWriteWorkspaceLease {
  const workspace = resolveBenchmarkWorkspace(repositoryRoot, workspaceFixture);
  if (workspace.kind !== "synthetic-fixture") {
    throw new Error("Benchmark write workspaces require a synthetic fixture.");
  }

  const canonicalHash = hashBenchmarkWorkspace(workspace);
  const leaseRoot = createLeaseRoot();
  try {
    copyPortableFixture(workspace.rootPath, leaseRoot, workspace.rootPath);
    verifyBenchmarkWorkspaceUnchanged(repositoryRoot, workspace, canonicalHash);
    const before = snapshotPortableFiles(leaseRoot);
    initializeCandidateRepository(leaseRoot);
    let cleaned = false;

    return {
      rootPath: leaseRoot,
      canonicalHash,
      initialSnapshot: toPublicSnapshot(before),
      collectChanges: () => diffSnapshots(before, snapshotPortableFiles(leaseRoot)),
      verifyCanonicalUnchanged: () => verifyBenchmarkWorkspaceUnchanged(repositoryRoot, workspace, canonicalHash),
      cleanup: () => {
        if (cleaned) return;
        removeLeaseRoot(leaseRoot);
        cleaned = true;
      },
    };
  } catch (error) {
    removeLeaseRoot(leaseRoot);
    throw error;
  }
}

function createLeaseRoot(): string {
  // `mkdtempSync` provides an OS-managed unique directory; no caller path is accepted.
  return mkdtempSync(join(tmpdir(), "kiln-benchmark-write-"));
}

function copyPortableFixture(sourceRoot: string, destinationRoot: string, currentSource: string): void {
  for (const entry of sortedEntries(currentSource)) {
    const sourcePath = join(currentSource, entry.name);
    const destinationPath = join(destinationRoot, relative(sourceRoot, sourcePath));
    if (entry.isSymbolicLink()) {
      throw new Error(`Benchmark write fixture contains a symbolic link at '${portablePath(sourceRoot, sourcePath)}'.`);
    }
    if (entry.isDirectory()) {
      mkdirSync(destinationPath, { recursive: true });
      copyPortableFixture(sourceRoot, destinationRoot, sourcePath);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Benchmark write fixture contains a non-portable entry at '${portablePath(sourceRoot, sourcePath)}'.`);
    }
    writeFileSync(destinationPath, readFileSync(sourcePath));
  }
}

function snapshotPortableFiles(rootPath: string): WorkspaceSnapshot {
  if (!existsSync(rootPath) || !lstatSync(rootPath).isDirectory() || lstatSync(rootPath).isSymbolicLink()) {
    throw new Error("Benchmark write workspace lease is unavailable.");
  }
  const files = new Map<string, string>();
  collectPortableFiles(rootPath, rootPath, files);
  return { files };
}

function collectPortableFiles(rootPath: string, currentPath: string, files: Map<string, string>): void {
  for (const entry of sortedEntries(currentPath)) {
    if (currentPath === rootPath && entry.name === ".git") continue;
    const path = join(currentPath, entry.name);
    const portable = portablePath(rootPath, path);
    if (entry.isSymbolicLink()) {
      throw new Error(`Benchmark write workspace contains a symbolic link at '${portable}'.`);
    }
    if (entry.isDirectory()) {
      collectPortableFiles(rootPath, path, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Benchmark write workspace contains a non-portable entry at '${portable}'.`);
    }
    files.set(portable, hashFile(path));
  }
}

function initializeCandidateRepository(rootPath: string): void {
  runGit(rootPath, ["init", "--quiet"]);
  runGit(rootPath, ["add", "--all", "--", "."]);
  runGit(rootPath, [
    "-c", "user.name=Kiln Benchmark",
    "-c", "user.email=benchmark@kiln.invalid",
    "commit", "--quiet", "--message", "materialize canonical benchmark fixture",
  ]);
}

function runGit(cwd: string, args: readonly string[]): void {
  execFileSync("git", [...args], {
    cwd,
    stdio: "pipe",
    windowsHide: true,
  });
}

function diffSnapshots(before: WorkspaceSnapshot, after: WorkspaceSnapshot): BenchmarkWriteWorkspaceChanges {
  const changed: BenchmarkWriteWorkspaceChangedFile[] = [];
  const added: BenchmarkWriteWorkspaceFile[] = [];
  const deleted: BenchmarkWriteWorkspaceFile[] = [];
  for (const [path, beforeHash] of before.files) {
    const afterHash = after.files.get(path);
    if (afterHash === undefined) deleted.push({ path, hash: beforeHash });
    else if (afterHash !== beforeHash) changed.push({ path, beforeHash, afterHash });
  }
  for (const [path, hash] of after.files) {
    if (!before.files.has(path)) added.push({ path, hash });
  }
  return { changed, added, deleted };
}

function toPublicSnapshot(snapshot: WorkspaceSnapshot): BenchmarkWriteWorkspaceSnapshot {
  return {
    files: [...snapshot.files]
      .map(([path, hash]) => ({ path, hash }))
      .sort((left, right) => left.path.localeCompare(right.path, "en")),
  };
}

function sortedEntries(path: string) {
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function hashFile(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function portablePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/gu, "/");
}

function removeLeaseRoot(leaseRoot: string): void {
  if (!existsSync(leaseRoot)) return;
  const metadata = lstatSync(leaseRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("Refusing to clean an invalid benchmark write workspace lease.");
  }
  rmSync(leaseRoot, { recursive: true, force: true });
}
