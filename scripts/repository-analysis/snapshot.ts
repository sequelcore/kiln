import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export function digest(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export interface CapturedSource {
  readonly path: string;
  readonly text: string;
  readonly hash: string;
}

export interface WorkspaceIdentity {
  readonly root: string;
  readonly workspaceId: string;
  readonly revision: string;
  readonly dirtyStateDigest: string;
}

export interface SourceSnapshot extends WorkspaceIdentity {
  readonly sourceDigest: string;
  readonly sources: readonly CapturedSource[];
}

export function localPath(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("absolute-source-path");
  const absolute = realpathSync(resolve(root, path));
  const rel = relative(root, absolute);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error("source-outside-workspace");
  }
  return absolute;
}

function git(root: string, args: readonly string[]): string {
  return execFileSync(
    "git",
    ["-c", "core.fsmonitor=false", "-c", "status.submoduleSummary=false", "-C", root, ...args],
    {
      encoding: "utf8",
      timeout: 5_000,
      maxBuffer: 1_048_576,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    },
  );
}

export function captureWorkspaceIdentity(root: string): WorkspaceIdentity {
  root = realpathSync(root);
  if (realpathSync(git(root, ["rev-parse", "--show-toplevel"]).trim()) !== root) {
    throw new Error("workspace-must-be-git-root");
  }
  const revision = git(root, ["rev-parse", "HEAD"]).trim();
  const dirtyStateDigest = digest(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
  return { root, workspaceId: digest(root), revision, dirtyStateDigest };
}

export function captureSources(root: string, paths: readonly string[]): SourceSnapshot {
  const identity = captureWorkspaceIdentity(root);
  root = identity.root;
  if (paths.length === 0 || paths.length > 128) throw new Error("source-file-budget");
  let bytes = 0;
  const seen = new Set<string>();
  const sources = paths
    .map((path): CapturedSource => {
      const absolute = localPath(root, path);
      if (!/\.(?:ts|tsx|mts|cts)$/.test(absolute)) throw new Error("unsupported-source-extension");
      if (seen.has(absolute)) throw new Error("duplicate-source");
      seen.add(absolute);
      const stat = statSync(absolute);
      bytes += stat.size;
      if (!stat.isFile() || bytes > 2_097_152) throw new Error("source-byte-budget");
      const raw = readFileSync(absolute);
      const text = raw.toString("utf8");
      if (raw.length !== stat.size || !raw.equals(Buffer.from(text))) {
        throw new Error("source-changed-or-invalid-utf8");
      }
      return Object.freeze({ path: relative(root, absolute).split(sep).join("/"), text, hash: digest(text) });
    })
    .sort((a, b) => a.path.localeCompare(b.path));
  const sourceDigest = digest(JSON.stringify(sources.map(({ path, hash }) => ({ path, hash }))));
  const snapshot = Object.freeze({
    ...identity,
    sourceDigest,
    sources: Object.freeze(sources),
  });
  if (!isCurrent(snapshot)) throw new Error("workspace-changed-during-capture");
  return snapshot;
}

export function isCurrent(snapshot: SourceSnapshot): boolean {
  try {
    return (
      git(snapshot.root, ["rev-parse", "HEAD"]).trim() === snapshot.revision &&
      digest(git(snapshot.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])) ===
        snapshot.dirtyStateDigest &&
      snapshot.sources.every((source) => digest(readFileSync(localPath(snapshot.root, source.path))) === source.hash)
    );
  } catch {
    return false;
  }
}
