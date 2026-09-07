import { readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { FileSystem, FileSystemEntries } from "typescript/unstable/fs";
import {
  captureWorkspaceIdentity,
  digest,
  isCurrent,
  localPath,
  type CapturedSource,
  type SourceSnapshot,
} from "./snapshot.js";

interface PathObservation {
  readonly resolved: string | null;
  readonly kind: "file" | "directory" | "absent" | "denied";
}

/** A read-once filesystem view; the compiler owns config and module resolution. */
export class ProjectCapture implements SourceSnapshot {
  readonly root: string;
  readonly workspaceId: string;
  readonly revision: string;
  readonly dirtyStateDigest: string;
  readonly configPath: string;
  readonly fileSystem: FileSystem;
  private readonly paths = new Map<string, PathObservation>();
  private readonly files = new Map<string, CapturedSource>();
  private readonly directories = new Map<string, FileSystemEntries>();
  private readonly refusalSet = new Set<string>();
  private bytes = 0;

  constructor(root: string, configPath: string) {
    const identity = captureWorkspaceIdentity(root);
    this.root = identity.root;
    this.workspaceId = identity.workspaceId;
    this.revision = identity.revision;
    this.dirtyStateDigest = identity.dirtyStateDigest;
    this.configPath = localPath(this.root, configPath).replaceAll("\\", "/");
    if (!this.configPath.endsWith(".json")) throw new Error("invalid-project-config");
    this.fileSystem = {
      readFile: (path) => this.read(path),
      fileExists: (path) => this.observe(path).kind === "file",
      directoryExists: (path) => this.observe(path).kind === "directory",
      getAccessibleEntries: (path) => this.entries(path),
      realpath: (path) => this.observe(path).resolved ?? resolve(path).replaceAll("\\", "/"),
    };
    if (this.read(this.configPath) === null) throw new Error("unreadable-project-config");
  }

  get sources(): readonly CapturedSource[] {
    return [...this.files.values()]
      .filter((file) => /\.(?:ts|tsx|mts|cts)$/.test(file.path) && !file.path.split("/").includes("node_modules"))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  get sourceDigest(): string {
    return digest(JSON.stringify(this.sources.map(({ path, hash }) => ({ path, hash }))));
  }

  get inputDigest(): string {
    return digest(
      JSON.stringify({
        inputs: this.inputs,
        observations: [...this.paths].sort(),
        directories: [...this.directories].sort(),
      }),
    );
  }

  get inputs(): readonly { readonly path: string; readonly hash: string }[] {
    return [...this.files.values()]
      .map(({ path, hash }) => ({ path, hash }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  get reasons(): readonly string[] {
    return [...this.refusalSet].sort();
  }

  source(path: string): CapturedSource | undefined {
    if (isAbsolute(path) || path.split(/[\\/]/).includes("node_modules") || !/\.(?:ts|tsx|mts|cts)$/.test(path))
      return undefined;
    const absolute = resolve(this.root, path);
    this.read(absolute);
    const observation = this.observe(absolute);
    return observation.resolved ? this.files.get(observation.resolved) : undefined;
  }

  current(): boolean {
    if (!isCurrent(this)) return false;
    try {
      for (const [path, observation] of this.paths) {
        if (JSON.stringify(this.inspect(path)) !== JSON.stringify(observation)) return false;
      }
      for (const [path, file] of this.files) {
        if (digest(readFileSync(path)) !== file.hash) return false;
      }
      for (const [path, entries] of this.directories) {
        if (JSON.stringify(this.list(path)) !== JSON.stringify(entries)) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private inside(path: string): boolean {
    const rel = relative(this.root, path);
    return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }

  private inspect(path: string): PathObservation {
    if (!this.inside(path)) return { resolved: null, kind: "denied" };
    try {
      const canonical = realpathSync(path).replaceAll("\\", "/");
      if (!this.inside(canonical)) return { resolved: null, kind: "denied" };
      const stat = statSync(canonical);
      return { resolved: canonical, kind: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "denied" };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      )
        return { resolved: null, kind: "absent" };
      throw error;
    }
  }

  private observe(path: string): PathObservation {
    path = resolve(path).replaceAll("\\", "/");
    const existing = this.paths.get(path);
    if (existing) return existing;
    if (this.paths.size >= 32768) {
      this.refusalSet.add("filesystem-observation-budget");
      return { resolved: null, kind: "denied" };
    }
    try {
      const observation = this.inspect(path);
      this.paths.set(path, observation);
      return observation;
    } catch {
      this.refusalSet.add("filesystem-observation-failed");
      return { resolved: null, kind: "denied" };
    }
  }

  private read(path: string): string | null {
    const observed = this.observe(path);
    if (observed.kind !== "file" || !observed.resolved) {
      if (observed.kind === "denied") this.refusalSet.add("workspace-read-refused");
      return null;
    }
    const existing = this.files.get(observed.resolved);
    if (existing) return existing.text;
    if (!/\.(?:ts|tsx|mts|cts|json)$/.test(observed.resolved)) {
      this.refusalSet.add("unsupported-project-input");
      return null;
    }
    try {
      const stat = statSync(observed.resolved);
      if (this.files.size >= 4096 || this.bytes + stat.size > 33_554_432) {
        this.refusalSet.add("project-input-budget");
        return null;
      }
      const raw = readFileSync(observed.resolved);
      const text = raw.toString("utf8");
      if (raw.length !== stat.size || !raw.equals(Buffer.from(text))) {
        this.refusalSet.add("project-input-changed-or-invalid-utf8");
        return null;
      }
      this.bytes += raw.length;
      this.files.set(
        observed.resolved,
        Object.freeze({
          path: relative(this.root, observed.resolved).split(sep).join("/"),
          text,
          hash: digest(text),
        }),
      );
      // Conservative refusal: referenced-project completeness is not admitted yet.
      // The compiler still owns parsing; a possible references key cannot create success.
      if (/\.json$/.test(observed.resolved) && /"references"\s*:/.test(text)) {
        this.refusalSet.add("project-reference-coverage-unproven");
      }
      return text;
    } catch {
      this.refusalSet.add("project-input-read-failed");
      return null;
    }
  }

  private list(path: string): FileSystemEntries {
    const entries = readdirSync(path, { withFileTypes: true });
    if (entries.length > 4096) throw new Error("directory-entry-budget");
    const files: string[] = [];
    const directories: string[] = [];
    for (const entry of entries) {
      if (entry.isFile()) files.push(entry.name);
      else if (entry.isDirectory()) directories.push(entry.name);
      else if (entry.isSymbolicLink()) {
        const observed = this.inspect(resolve(path, entry.name));
        if (observed.kind === "file") files.push(entry.name);
        else if (observed.kind === "directory") directories.push(entry.name);
      }
    }
    return { files: files.sort(), directories: directories.sort() };
  }

  private entries(path: string): FileSystemEntries {
    const observed = this.observe(path);
    if (observed.kind !== "directory" || !observed.resolved) return { files: [], directories: [] };
    const existing = this.directories.get(observed.resolved);
    if (existing) return existing;
    try {
      const entries = this.list(observed.resolved);
      this.directories.set(observed.resolved, entries);
      return entries;
    } catch {
      this.refusalSet.add("directory-enumeration-failed-or-over-budget");
      return { files: [], directories: [] };
    }
  }
}
