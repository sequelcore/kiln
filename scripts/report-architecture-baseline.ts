import { execFileSync, spawnSync } from "node:child_process";
import { posix, resolve } from "node:path";

type ImportLoad = "dynamic" | "eager-runtime" | "type-only";
type SourceSurface = "production" | "test";

interface ModuleReference {
  readonly specifier: string;
  readonly load: ImportLoad;
}

export interface RootImportSummary {
  readonly target: "@kilnai/core" | "@kilnai/runtime";
  readonly consumer: string;
  readonly surface: SourceSurface;
  readonly load: ImportLoad;
  readonly fileCount: number;
  readonly occurrenceCount: number;
}

export interface CliEagerGraphSummary {
  readonly entrypoint: string;
  readonly workspaceModuleCount: number;
  readonly modulesByPackage: Readonly<Record<string, number>>;
  readonly rootWorkspaceImports: readonly string[];
  readonly deferredDynamicImports: readonly string[];
  readonly externalSpecifiers: readonly string[];
  readonly unresolvedWorkspaceEdges: readonly string[];
}

export interface ArchitectureBaselineReport {
  readonly schemaVersion: 1;
  readonly commit: string;
  readonly rootImports: readonly RootImportSummary[];
  readonly cliEagerGraph: CliEagerGraphSummary;
}

interface PackageIdentity {
  readonly name: string;
  readonly root: string;
}

interface ImportAccumulator {
  readonly files: Set<string>;
  occurrences: number;
}

const ROOT_PACKAGES = ["@kilnai/core", "@kilnai/runtime"] as const;
const TYPESCRIPT_SOURCE_PATTERN = /\.tsx?$/u;
const TEST_SOURCE_PATTERN = /(?:^|\/)(?:tests|__tests__)(?:\/|$)|\.test\.tsx?$/u;

export function analyzeArchitectureSnapshot(
  files: ReadonlyMap<string, string>,
  commit: string,
): ArchitectureBaselineReport {
  const packages = readPackageIdentities(files);
  return {
    schemaVersion: 1,
    commit,
    rootImports: summarizeRootImports(files, packages),
    cliEagerGraph: analyzeCliEagerGraph(files, packages),
  };
}

export function collectArchitectureBaseline(
  reference = "HEAD",
  repositoryRoot = resolve(import.meta.dirname, ".."),
): ArchitectureBaselineReport {
  const commit = execFileSync("git", ["rev-parse", "--verify", `${reference}^{commit}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  return analyzeArchitectureSnapshot(readGitPackageFiles(repositoryRoot, commit), commit);
}

function summarizeRootImports(
  files: ReadonlyMap<string, string>,
  packages: readonly PackageIdentity[],
): readonly RootImportSummary[] {
  const accumulators = new Map<string, ImportAccumulator>();
  for (const [path, source] of files) {
    if (!TYPESCRIPT_SOURCE_PATTERN.test(path)) continue;
    const consumer = packageNameForPath(path, packages);
    if (!consumer) continue;
    const surface: SourceSurface = TEST_SOURCE_PATTERN.test(path) ? "test" : "production";
    for (const reference of readModuleReferences(path, source)) {
      if (!isRootPackage(reference.specifier)) continue;
      const key = [reference.specifier, consumer, surface, reference.load].join("\0");
      const accumulator = accumulators.get(key) ?? { files: new Set<string>(), occurrences: 0 };
      accumulator.files.add(path);
      accumulator.occurrences += 1;
      accumulators.set(key, accumulator);
    }
  }
  return [...accumulators.entries()]
    .map(([key, value]) => {
      const [target, consumer, surface, load] = key.split("\0") as [
        RootImportSummary["target"],
        string,
        SourceSurface,
        ImportLoad,
      ];
      return {
        target,
        consumer,
        surface,
        load,
        fileCount: value.files.size,
        occurrenceCount: value.occurrences,
      };
    })
    .sort(compareRootImportSummaries);
}

function analyzeCliEagerGraph(
  files: ReadonlyMap<string, string>,
  packages: readonly PackageIdentity[],
): CliEagerGraphSummary {
  const entrypoint = "packages/cli/src/executable.ts";
  if (!files.has(entrypoint)) throw new Error(`CLI entrypoint not found: ${entrypoint}`);

  const pending = [entrypoint];
  const visited = new Set<string>();
  const externalSpecifiers = new Set<string>();
  const rootWorkspaceImports = new Set<string>();
  const deferredDynamicImports = new Set<string>();
  const unresolvedWorkspaceEdges = new Set<string>();

  while (pending.length > 0) {
    const path = pending.pop();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    const source = files.get(path);
    if (source === undefined || !TYPESCRIPT_SOURCE_PATTERN.test(path)) continue;

    for (const reference of readModuleReferences(path, source)) {
      if (reference.load === "type-only") continue;
      if (reference.load === "dynamic") {
        deferredDynamicImports.add(`${path} -> ${reference.specifier}`);
        continue;
      }
      if (isRootPackage(reference.specifier)) {
        rootWorkspaceImports.add(`${path} -> ${reference.specifier}`);
      }
      const resolution = resolveSnapshotModule(path, reference.specifier, files, packages);
      if (resolution.kind === "workspace") {
        pending.push(resolution.path);
      } else if (resolution.kind === "unresolved-workspace") {
        unresolvedWorkspaceEdges.add(`${path} -> ${reference.specifier}`);
      } else if (resolution.kind === "external") {
        externalSpecifiers.add(reference.specifier);
      }
    }
  }

  const modulesByPackage = new Map<string, number>();
  for (const path of visited) {
    const owner = packageNameForPath(path, packages) ?? "<repository>";
    modulesByPackage.set(owner, (modulesByPackage.get(owner) ?? 0) + 1);
  }
  return {
    entrypoint,
    workspaceModuleCount: visited.size,
    modulesByPackage: Object.fromEntries([...modulesByPackage.entries()].sort(compareTextEntries)),
    rootWorkspaceImports: [...rootWorkspaceImports].sort(compareCodeUnits),
    deferredDynamicImports: [...deferredDynamicImports].sort(compareCodeUnits),
    externalSpecifiers: [...externalSpecifiers].sort(compareCodeUnits),
    unresolvedWorkspaceEdges: [...unresolvedWorkspaceEdges].sort(compareCodeUnits),
  };
}

type SnapshotModuleResolution =
  | { readonly kind: "workspace"; readonly path: string }
  | { readonly kind: "unresolved-workspace" }
  | { readonly kind: "external" };

function resolveSnapshotModule(
  importer: string,
  specifier: string,
  files: ReadonlyMap<string, string>,
  packages: readonly PackageIdentity[],
): SnapshotModuleResolution {
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    const base = posix.normalize(posix.join(posix.dirname(importer), specifier));
    const resolved = firstExistingSource(base, files);
    return resolved ? { kind: "workspace", path: resolved } : { kind: "external" };
  }
  const workspacePackage = packages.find((candidate) => (
    specifier === candidate.name || specifier.startsWith(`${candidate.name}/`)
  ));
  if (!workspacePackage) return { kind: "external" };
  const subpath = specifier === workspacePackage.name
    ? ""
    : specifier.slice(workspacePackage.name.length + 1);
  const base = subpath
    ? posix.join(workspacePackage.root, "src", subpath)
    : posix.join(workspacePackage.root, "src", "index");
  const resolved = firstExistingSource(base, files);
  return resolved
    ? { kind: "workspace", path: resolved }
    : { kind: "unresolved-workspace" };
}

function firstExistingSource(base: string, files: ReadonlyMap<string, string>): string | undefined {
  const withoutRuntimeExtension = base.replace(/\.(?:c|m)?js$/u, "");
  const candidates = [
    base,
    `${withoutRuntimeExtension}.ts`,
    `${withoutRuntimeExtension}.tsx`,
    posix.join(withoutRuntimeExtension, "index.ts"),
    posix.join(withoutRuntimeExtension, "index.tsx"),
  ];
  return candidates.find((candidate) => files.has(candidate));
}

function readModuleReferences(path: string, source: string): readonly ModuleReference[] {
  void path;
  const searchable = maskComments(source);
  const references: ModuleReference[] = [];
  const importFrom = /(?:^|\n)\s*import\s+(type\s+)?([^;"']*?)\s+from\s+(["'])([^"']+)\3/gu;
  for (const match of searchable.matchAll(importFrom)) {
    const explicitType = match[1] !== undefined;
    const clause = match[2]?.trim() ?? "";
    const specifier = match[4];
    if (!specifier) continue;
    references.push({
      specifier,
      load: explicitType || namedClauseIsTypeOnly(clause) ? "type-only" : "eager-runtime",
    });
  }
  const sideEffectImport = /(?:^|\n)\s*import\s+(["'])([^"']+)\1/gu;
  for (const match of searchable.matchAll(sideEffectImport)) {
    const specifier = match[2];
    if (specifier) references.push({ specifier, load: "eager-runtime" });
  }
  const exportFrom = /(?:^|\n)\s*export\s+(type\s+)?(\*|\{[^}]*\})[^;"']*?\s+from\s+(["'])([^"']+)\3/gu;
  for (const match of searchable.matchAll(exportFrom)) {
    const explicitType = match[1] !== undefined;
    const clause = match[2]?.trim() ?? "";
    const specifier = match[4];
    if (!specifier) continue;
    references.push({
      specifier,
      load: explicitType || namedClauseIsTypeOnly(clause) ? "type-only" : "eager-runtime",
    });
  }
  // `import()` is always deferred from the initial static graph. Type-position
  // import expressions are intentionally included in the same non-eager class.
  const importExpression = /\bimport\s*\(\s*(["'])([^"']+)\1\s*\)/gu;
  for (const match of searchable.matchAll(importExpression)) {
    const specifier = match[2];
    if (specifier) references.push({ specifier, load: "dynamic" });
  }
  return references;
}

function namedClauseIsTypeOnly(clause: string): boolean {
  if (!clause.startsWith("{") || !clause.endsWith("}")) return false;
  const members = clause.slice(1, -1).split(",").map((member) => member.trim()).filter(Boolean);
  return members.length > 0 && members.every((member) => member.startsWith("type "));
}

function maskComments(source: string): string {
  let result = "";
  let state: "block-comment" | "code" | "double-quote" | "line-comment" | "single-quote" | "template" = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (state === "line-comment") {
      if (character === "\n") {
        state = "code";
        result += character;
      } else {
        result += " ";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        result += "  ";
        index += 1;
        state = "code";
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (state !== "code") {
      result += state === "template" ? (character === "\n" ? "\n" : " ") : character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && character === "'")
        || (state === "double-quote" && character === '"')
        || (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }
    if (character === "/" && next === "/") {
      result += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      result += "  ";
      index += 1;
      state = "block-comment";
    } else {
      result += character;
      if (character === "'") state = "single-quote";
      else if (character === '"') state = "double-quote";
      else if (character === "`") state = "template";
    }
  }
  return result;
}

function readPackageIdentities(files: ReadonlyMap<string, string>): readonly PackageIdentity[] {
  const packages: PackageIdentity[] = [];
  for (const [path, contents] of files) {
    const match = /^packages\/([^/]+)\/package\.json$/u.exec(path);
    if (!match) continue;
    const parsed = JSON.parse(contents) as { readonly name?: unknown };
    if (typeof parsed.name !== "string") continue;
    packages.push({ name: parsed.name, root: `packages/${match[1]}` });
  }
  return packages.sort((left, right) => right.name.length - left.name.length || compareCodeUnits(left.name, right.name));
}

function packageNameForPath(path: string, packages: readonly PackageIdentity[]): string | undefined {
  return packages.find((candidate) => path.startsWith(`${candidate.root}/`))?.name;
}

function isRootPackage(specifier: string): specifier is RootImportSummary["target"] {
  return ROOT_PACKAGES.some((candidate) => candidate === specifier);
}

function readGitPackageFiles(repositoryRoot: string, commit: string): ReadonlyMap<string, string> {
  const tree = execFileSync("git", ["ls-tree", "-r", "-z", commit, "--", "packages"], {
    cwd: repositoryRoot,
    maxBuffer: 32 * 1024 * 1024,
  }).toString("utf8");
  const entries = tree.split("\0").filter(Boolean).flatMap((entry) => {
    const match = /^\d+ blob ([a-f0-9]+)\t(.+)$/u.exec(entry);
    if (!match) return [];
    const [, objectId, path] = match;
    if (!objectId || !path || (!TYPESCRIPT_SOURCE_PATTERN.test(path) && !path.endsWith(".json"))) return [];
    return [{ objectId, path }];
  });
  const child = spawnSync("git", ["cat-file", "--batch"], {
    cwd: repositoryRoot,
    input: `${entries.map((entry) => entry.objectId).join("\n")}\n`,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(`git cat-file failed: ${child.stderr.toString("utf8").trim()}`);
  }
  const files = new Map<string, string>();
  let offset = 0;
  for (const entry of entries) {
    const headerEnd = child.stdout.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error(`Missing git object header for ${entry.path}`);
    const header = child.stdout.subarray(offset, headerEnd).toString("utf8");
    const size = Number(header.split(" ").at(-1));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid git object size for ${entry.path}`);
    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + size;
    files.set(entry.path, child.stdout.subarray(contentStart, contentEnd).toString("utf8"));
    offset = contentEnd + 1;
  }
  return files;
}

function compareRootImportSummaries(left: RootImportSummary, right: RootImportSummary): number {
  return compareCodeUnits(
    [left.target, left.consumer, left.surface, left.load].join("\0"),
    [right.target, right.consumer, right.surface, right.load].join("\0"),
  );
}

function compareTextEntries(left: readonly [string, number], right: readonly [string, number]): number {
  return compareCodeUnits(left[0], right[0]);
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function readReference(args: readonly string[]): string {
  const index = args.indexOf("--ref");
  if (index < 0) return "HEAD";
  const value = args[index + 1]?.trim();
  if (!value) throw new Error("--ref requires a Git reference");
  return value;
}

if (import.meta.main) {
  console.log(JSON.stringify(collectArchitectureBaseline(readReference(process.argv.slice(2))), null, 2));
}
