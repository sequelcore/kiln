import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep, win32 } from "node:path";

export interface BenchmarkWorkspace {
  readonly kind: "repository" | "synthetic-fixture";
  readonly rootPath: string;
  readonly fixturePath?: string;
}

export function resolveBenchmarkWorkspace(
  repositoryRoot: string,
  workspaceFixture: unknown,
): BenchmarkWorkspace {
  const realRepositoryRoot = realpathSync(repositoryRoot);
  if (workspaceFixture === undefined) {
    return { kind: "repository", rootPath: realRepositoryRoot };
  }
  if (typeof workspaceFixture !== "string" || !isPortableRelativePath(workspaceFixture)) {
    throw new Error("Benchmark workspace fixture must be a portable repository-relative path.");
  }

  const candidate = join(realRepositoryRoot, ...workspaceFixture.split("/"));
  assertNoSymbolicLinks(candidate, workspaceFixture);
  const realFixture = realpathSync(candidate);
  const containment = relative(realRepositoryRoot, realFixture);
  if (containment === ".." || containment.startsWith(`..${sep}`) || isAbsolute(containment)) {
    throw new Error("Benchmark workspace fixture must remain inside the repository root.");
  }
  if (!lstatSync(realFixture).isDirectory()) {
    throw new Error("Benchmark workspace fixture must resolve to a directory.");
  }
  assertFixtureTreeIsPortable(realFixture, realFixture);
  return {
    kind: "synthetic-fixture",
    rootPath: realFixture,
    fixturePath: workspaceFixture,
  };
}

export function hashBenchmarkWorkspace(workspace: BenchmarkWorkspace): string {
  if (workspace.kind !== "synthetic-fixture") {
    throw new Error("Only synthetic benchmark fixtures have a workspace content hash.");
  }
  const hash = createHash("sha256");
  hashFixtureTree(workspace.rootPath, workspace.rootPath, hash);
  return `sha256:${hash.digest("hex")}`;
}

export function verifyBenchmarkWorkspaceUnchanged(
  repositoryRoot: string,
  workspace: BenchmarkWorkspace,
  expectedHash: string,
): void {
  if (workspace.kind !== "synthetic-fixture" || !workspace.fixturePath) return;
  const currentWorkspace = resolveBenchmarkWorkspace(repositoryRoot, workspace.fixturePath);
  const currentHash = hashBenchmarkWorkspace(currentWorkspace);
  if (currentHash !== expectedHash) {
    throw new Error(`Synthetic workspace fixture '${workspace.fixturePath}' changed during benchmark execution.`);
  }
}

function isPortableRelativePath(value: string): boolean {
  if (value.trim() === "" || value.includes("\0") || isAbsolute(value) || win32.isAbsolute(value)) {
    return false;
  }
  if (value.includes("\\")) return false;
  const segments = value.split("/");
  return !segments.some((segment) => segment === "" || segment === "." || segment === "..");
}

function assertNoSymbolicLinks(path: string, fixturePath: string): void {
  try {
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`Benchmark workspace fixture '${fixturePath}' cannot be a symbolic link.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("symbolic link")) throw error;
    throw new Error(`Benchmark workspace fixture '${fixturePath}' does not exist.`);
  }
}

function assertFixtureTreeIsPortable(root: string, current: string): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Benchmark workspace fixture contains a symbolic link at '${portablePath(root, path)}'.`);
    }
    if (entry.isDirectory()) {
      assertFixtureTreeIsPortable(root, path);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Benchmark workspace fixture contains a non-portable entry at '${portablePath(root, path)}'.`);
    }
  }
}

function hashFixtureTree(root: string, current: string, hash: ReturnType<typeof createHash>): void {
  const entries = readdirSync(current, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const normalizedPath = portablePath(root, path);
    if (entry.isDirectory()) {
      hash.update(`directory\0${normalizedPath}\0`, "utf-8");
      hashFixtureTree(root, path, hash);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Benchmark workspace fixture contains a non-portable entry at '${normalizedPath}'.`);
    }
    hash.update(`file\0${normalizedPath}\0`, "utf-8");
    hash.update(readFileSync(path));
    hash.update("\0", "utf-8");
  }
}

function portablePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/gu, "/");
}
