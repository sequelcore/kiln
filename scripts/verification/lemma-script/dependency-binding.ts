import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/**
 * Facts-only observation of the files and lock-resolved runtime dependencies
 * used by a LemmaScript package. This module never invokes a process manager,
 * installs packages, or decides qualification/acceptance.
 */

export const LEMMA_SCRIPT_DEPENDENCY_BINDING_SCHEMA = "kiln.lemma-script-dependency-binding/v1" as const;

export const LEMMA_SCRIPT_ALLOWED_COMMANDS = ["version", "info --typed", "gen --backend=dafny"] as const;

export type LemmaScriptAllowedCommand = (typeof LEMMA_SCRIPT_ALLOWED_COMMANDS)[number];

export interface LemmaScriptCommandProfile {
  readonly allowedCommands: readonly LemmaScriptAllowedCommand[];
}

export interface LemmaScriptDependencyBindingInput {
  readonly packageRoot: string;
  readonly entrypointPath: string;
  readonly spawnCwd: string;
  readonly runtimeExecutablePath: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly commandProfile: LemmaScriptCommandProfile;
}

export interface LemmaScriptDependencyManifestEntry {
  readonly path: string;
  readonly size: number;
  readonly digest: string;
}

export interface LemmaScriptDependencyPackageFact {
  readonly path: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string | null;
}

export interface LemmaScriptRuntimeFact {
  readonly role: "bun";
  readonly digest: string;
  readonly byteLength: number;
}

export interface LemmaScriptDependencyBindingFacts {
  readonly schema: typeof LEMMA_SCRIPT_DEPENDENCY_BINDING_SCHEMA;
  readonly digest: string;
  readonly manifest: readonly LemmaScriptDependencyManifestEntry[];
  readonly packages: readonly LemmaScriptDependencyPackageFact[];
  readonly runtime: LemmaScriptRuntimeFact;
  readonly allowedCommands: readonly LemmaScriptAllowedCommand[];
}

export type LemmaScriptDependencyBindingRejectionCode =
  | "invalid-input"
  | "absolute-path"
  | "caller-supplied-identity"
  | "unsupported-command"
  | "node-options"
  | "node-path"
  | "bun-environment"
  | "ancestor-node-modules"
  | "ancestor-bunfig"
  | "package-root-invalid"
  | "entrypoint-invalid"
  | "entrypoint-outside-root"
  | "entrypoint-bin-mismatch"
  | "spawn-cwd-invalid"
  | "spawn-cwd-outside-root"
  | "symlink"
  | "junction"
  | "reparse"
  | "realpath-escape"
  | "package-json-missing"
  | "package-json-invalid"
  | "lockfile-missing"
  | "lockfile-invalid"
  | "lockfile-version"
  | "missing-directory"
  | "missing-package"
  | "unresolved-package"
  | "ambiguous-package"
  | "installed-package-absent-from-lock"
  | "installed-package-outside-closure"
  | "canonical-path-collision"
  | "package-name-mismatch"
  | "package-version-mismatch"
  | "non-regular-file"
  | "runtime-executable-missing"
  | "runtime-executable-invalid"
  | "io-error";

export interface LemmaScriptDependencyBindingValidResult {
  readonly status: "valid";
  readonly facts: LemmaScriptDependencyBindingFacts;
}

export interface LemmaScriptDependencyBindingInvalidResult {
  readonly status: "invalid";
  readonly rejectionCodes: readonly LemmaScriptDependencyBindingRejectionCode[];
}

export type LemmaScriptDependencyBindingResult =
  | LemmaScriptDependencyBindingValidResult
  | LemmaScriptDependencyBindingInvalidResult;

interface LockPackage {
  readonly path: string;
  readonly absolutePath: string;
  readonly name: string;
  readonly version: string;
  readonly integrity: string | null;
  readonly dev: boolean;
  readonly optional: boolean;
  readonly dependencies: ReadonlyMap<string, string>;
  readonly source: "root" | "tools";
}

interface LockModel {
  readonly source: "root" | "tools";
  readonly baseDirectory: string;
  readonly root: LockPackage;
  readonly packages: ReadonlyMap<string, LockPackage>;
}

interface PackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly bin?: unknown;
  readonly dependencies?: unknown;
  readonly optionalDependencies?: unknown;
  readonly peerDependencies?: unknown;
}

interface RawRecord {
  readonly [key: string]: unknown;
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface FileObservation {
  readonly path: string;
  readonly bytes: Buffer;
}

interface InternalPackageFact {
  readonly package: LockPackage;
  readonly files: readonly FileObservation[];
}

class BindingFailure extends Error {
  readonly codes: readonly LemmaScriptDependencyBindingRejectionCode[];

  constructor(...codes: LemmaScriptDependencyBindingRejectionCode[]) {
    super("LemmaScript dependency binding rejected");
    this.name = "BindingFailure";
    this.codes = codes;
  }
}

/** Observe one portable package binding snapshot. Callers may invoke this before and after execution. */
export async function observeLemmaScriptDependencyBinding(input: unknown): Promise<LemmaScriptDependencyBindingResult> {
  try {
    const validated = validateInput(input);
    const root = await secureRoot(validated.packageRoot);
    const runtimeExecutable = await secureRuntimeExecutable(validated.runtimeExecutablePath);
    const runtimeBytes = await readRegularFile(runtimeExecutable.realPath, "runtime-executable-missing");
    const runtime: LemmaScriptRuntimeFact = {
      role: "bun",
      digest: digestBytes(runtimeBytes),
      byteLength: runtimeBytes.byteLength,
    };
    await rejectAncestorInfluence(root);
    const [entrypoint, cwd] = await Promise.all([
      securePath(validated.entrypointPath, "entrypoint"),
      securePath(validated.spawnCwd, "cwd"),
    ]);
    if (!isContained(root.realPath, entrypoint.realPath)) throw new BindingFailure("entrypoint-outside-root");
    if (!isContained(root.realPath, cwd.realPath)) throw new BindingFailure("spawn-cwd-outside-root");
    if (relative(root.realPath, entrypoint.realPath).split(sep).join("/") !== "tools/dist/lsc.js") {
      throw new BindingFailure("entrypoint-bin-mismatch");
    }

    const packageJsonPath = join(root.realPath, "package.json");
    const packageLockPath = join(root.realPath, "package-lock.json");
    const toolsLockPath = join(root.realPath, "tools", "package-lock.json");
    const packageJsonBytes = await readRegularFile(packageJsonPath, "package-json-missing");
    const packageLockBytes = await readRegularFile(packageLockPath, "lockfile-missing");
    const toolsLockBytes = await readRegularFile(toolsLockPath, "lockfile-missing");
    const packageJson = parsePackageJson(packageJsonBytes);
    validateEntrypointBin(packageJson, root.realPath, entrypoint.realPath);
    const rootModel = parseLockfile(packageLockBytes, root.realPath, "root");
    const toolsModel = parseLockfile(toolsLockBytes, join(root.realPath, "tools"), "tools");
    validateRootPackage(packageJson, rootModel.root);

    const closure = await resolveRuntimeClosure(rootModel, toolsModel, packageJson);
    const allLockedPackages = mergeLockPackages(rootModel, toolsModel);
    await rejectUnlockedInstalledPackages(root.realPath, closure, allLockedPackages);

    const files: FileObservation[] = [
      { path: "package.json", bytes: packageJsonBytes },
      { path: "package-lock.json", bytes: packageLockBytes },
      { path: "tools/package-lock.json", bytes: toolsLockBytes },
    ];
    files.push(...(await walkFiles(join(root.realPath, "tools", "dist"), root.realPath)));
    const packageFacts: InternalPackageFact[] = [];
    for (const packageEntry of closure.values()) {
      const packageJsonFile = await readRegularFile(join(packageEntry.absolutePath, "package.json"));
      const installedPackage = parsePackageJson(packageJsonFile);
      if (installedPackage.name !== packageEntry.name) throw new BindingFailure("package-name-mismatch");
      if (installedPackage.version !== packageEntry.version) throw new BindingFailure("package-version-mismatch");
      const packageFiles = await walkFiles(packageEntry.absolutePath, root.realPath, true);
      packageFacts.push({ package: packageEntry, files: packageFiles });
      files.push(...packageFiles);
    }

    const manifest = canonicalManifest(files);
    const packages = canonicalPackages(packageFacts);
    const allowedCommands = validated.allowedCommands
      .map((command) => canonicalText(command) as LemmaScriptAllowedCommand)
      .sort(compareStrings);
    const digest = digestCanonicalManifest(manifest, packages, runtime, allowedCommands);
    return {
      status: "valid",
      facts: {
        schema: LEMMA_SCRIPT_DEPENDENCY_BINDING_SCHEMA,
        digest,
        manifest,
        packages,
        runtime,
        allowedCommands,
      },
    };
  } catch (error) {
    if (error instanceof BindingFailure) return invalid(error.codes);
    return invalid(["io-error"]);
  }
}

interface ValidatedInput {
  readonly packageRoot: string;
  readonly entrypointPath: string;
  readonly spawnCwd: string;
  readonly runtimeExecutablePath: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly allowedCommands: readonly LemmaScriptAllowedCommand[];
}

function validateInput(input: unknown): ValidatedInput {
  if (!isRecord(input)) throw new BindingFailure("invalid-input");
  if (
    [
      "digest",
      "manifest",
      "expectedDigest",
      "identity",
      "pre",
      "post",
      "runtime",
      "runtimeDigest",
      "runtimeIdentity",
    ].some((key) => Object.hasOwn(input, key))
  ) {
    throw new BindingFailure("caller-supplied-identity");
  }
  const packageRoot = input.packageRoot;
  const entrypointPath = input.entrypointPath;
  const spawnCwd = input.spawnCwd;
  const runtimeExecutablePath = input.runtimeExecutablePath;
  if (
    typeof packageRoot !== "string" ||
    typeof entrypointPath !== "string" ||
    typeof spawnCwd !== "string" ||
    typeof runtimeExecutablePath !== "string"
  ) {
    throw new BindingFailure("invalid-input");
  }
  if (![packageRoot, entrypointPath, spawnCwd, runtimeExecutablePath].every((path) => isAbsolute(path))) {
    throw new BindingFailure("absolute-path");
  }

  const environment = input.environment;
  if (!isRecord(environment)) throw new BindingFailure("invalid-input");
  const environmentCodes = new Set<LemmaScriptDependencyBindingRejectionCode>();
  for (const key of Object.keys(environment)) {
    const value = environment[key];
    if (value !== undefined && typeof value !== "string") throw new BindingFailure("invalid-input");
    const normalized = key.toUpperCase();
    if (normalized === "NODE_OPTIONS") environmentCodes.add("node-options");
    if (normalized === "NODE_PATH") environmentCodes.add("node-path");
    if (normalized.startsWith("BUN_")) environmentCodes.add("bun-environment");
  }
  if (environmentCodes.size > 0) throw new BindingFailure(...environmentCodes);

  const commandProfile = input.commandProfile;
  if (!isRecord(commandProfile) || !Array.isArray(commandProfile.allowedCommands)) {
    throw new BindingFailure("unsupported-command");
  }
  const commands: LemmaScriptAllowedCommand[] = [];
  for (const command of commandProfile.allowedCommands) {
    if (typeof command !== "string" || !isAllowedCommand(command)) throw new BindingFailure("unsupported-command");
    if (!commands.includes(command)) commands.push(command);
  }
  if (commands.length === 0) throw new BindingFailure("unsupported-command");
  return {
    packageRoot,
    entrypointPath,
    spawnCwd,
    runtimeExecutablePath,
    environment: environment as Readonly<Record<string, string | undefined>>,
    allowedCommands: commands,
  };
}

function isAllowedCommand(value: string): value is LemmaScriptAllowedCommand {
  return (LEMMA_SCRIPT_ALLOWED_COMMANDS as readonly string[]).includes(value);
}

function invalid(
  codes: readonly LemmaScriptDependencyBindingRejectionCode[],
): LemmaScriptDependencyBindingInvalidResult {
  const uniqueCodes = [...new Set(codes)];
  return { status: "invalid", rejectionCodes: uniqueCodes.length > 0 ? uniqueCodes : ["invalid-input"] };
}

interface SecurePath {
  readonly requestedPath: string;
  readonly realPath: string;
}

async function secureRoot(path: string): Promise<SecurePath> {
  try {
    await assertPathComponents(path);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) await rejectLink(path);
    if (!metadata.isDirectory()) throw new BindingFailure("package-root-invalid");
    const realPath = await realpath(path);
    return { requestedPath: resolve(path), realPath };
  } catch (error) {
    if (error instanceof BindingFailure) throw error;
    throw new BindingFailure("package-root-invalid");
  }
}

async function securePath(path: string, kind: "entrypoint" | "cwd"): Promise<SecurePath> {
  try {
    await assertPathComponents(path);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) await rejectLink(path);
    const expectedType = kind === "cwd" ? metadata.isDirectory() : metadata.isFile();
    if (!expectedType) throw new BindingFailure(kind === "cwd" ? "spawn-cwd-invalid" : "entrypoint-invalid");
    const realPath = await realpath(path);
    if (!isContained(resolve(path), realPath)) throw new BindingFailure("realpath-escape");
    return { requestedPath: resolve(path), realPath };
  } catch (error) {
    if (error instanceof BindingFailure) throw error;
    throw new BindingFailure(kind === "cwd" ? "spawn-cwd-invalid" : "entrypoint-invalid");
  }
}

async function secureRuntimeExecutable(path: string): Promise<SecurePath> {
  try {
    await assertPathComponents(path);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(path);
    } catch {
      throw new BindingFailure("runtime-executable-missing");
    }
    if (metadata.isSymbolicLink()) await rejectLink(path);
    if (!metadata.isFile()) throw new BindingFailure("runtime-executable-invalid");
    return { requestedPath: resolve(path), realPath: await realpath(path) };
  } catch (error) {
    if (error instanceof BindingFailure) throw error;
    throw new BindingFailure("runtime-executable-invalid");
  }
}

async function assertPathComponents(path: string): Promise<void> {
  const resolved = resolve(path);
  const parsed = parse(resolved);
  let current = parsed.root;
  const remainder = resolved
    .slice(parsed.root.length)
    .split(sep)
    .filter((part) => part.length > 0);
  for (const component of remainder) {
    current = join(current, component);
    let metadata: Awaited<ReturnType<typeof lstat>>;
    try {
      metadata = await lstat(current);
    } catch {
      continue;
    }
    if (!metadata.isSymbolicLink()) continue;
    await rejectLink(current);
  }
}

async function rejectAncestorInfluence(root: SecurePath): Promise<void> {
  // Qualification never invokes a package manager and hashes the installed
  // closure directly, so ancestor .npmrc files cannot affect this execution.
  let current = dirname(root.realPath);
  while (true) {
    if (basename(current) === "node_modules" || (await exists(join(current, "node_modules")))) {
      throw new BindingFailure("ancestor-node-modules");
    }
    if (await exists(join(current, "bunfig.toml"))) throw new BindingFailure("ancestor-bunfig");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

async function rejectLink(path: string): Promise<never> {
  if (process.platform === "win32") {
    try {
      const followed = await stat(path);
      if (followed.isDirectory()) throw new BindingFailure("junction", "reparse", "realpath-escape");
    } catch (error) {
      if (error instanceof BindingFailure) throw error;
    }
  }
  throw new BindingFailure("symlink");
}

function isContained(root: string, target: string): boolean {
  const candidate = relative(root, target);
  return candidate === "" || (!candidate.startsWith(`..${sep}`) && candidate !== ".." && !isAbsolute(candidate));
}

function validateEntrypointBin(packageJson: PackageJson, root: string, entrypoint: string): void {
  const relativeEntrypoint = relative(root, entrypoint).split(sep).join("/");
  if (relativeEntrypoint !== "tools/dist/lsc.js") throw new BindingFailure("entrypoint-bin-mismatch");
  const binValues: string[] = [];
  if (typeof packageJson.bin === "string") binValues.push(packageJson.bin);
  else if (isRecord(packageJson.bin)) {
    for (const value of Object.values(packageJson.bin)) if (typeof value === "string") binValues.push(value);
  }
  if (!binValues.some((value) => normalizeRelativePackagePath(value) === relativeEntrypoint)) {
    throw new BindingFailure("entrypoint-bin-mismatch");
  }
}

function normalizeRelativePackagePath(value: string): string {
  const canonical = canonicalText(value);
  if (canonical.includes("\\") || isAbsolute(canonical)) return "";
  const normalized = canonical.replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) return "";
  return segments.join("/");
}

function validateRootPackage(packageJson: PackageJson, rootPackage: LockPackage): void {
  if (typeof packageJson.name !== "string" || typeof packageJson.version !== "string") {
    throw new BindingFailure("package-json-invalid");
  }
  if (rootPackage.name !== packageJson.name || rootPackage.version !== packageJson.version) {
    throw new BindingFailure("package-version-mismatch");
  }
}

function parsePackageJson(bytes: Buffer): PackageJson {
  try {
    const parsed: unknown = JSON.parse(bytes.toString("utf8"));
    if (!isRecord(parsed)) throw new Error("not object");
    return parsed;
  } catch {
    throw new BindingFailure("package-json-invalid");
  }
}

function parseLockfile(bytes: Buffer, baseDirectory: string, source: "root" | "tools"): LockModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new BindingFailure("lockfile-invalid");
  }
  if (!isRecord(parsed) || parsed.lockfileVersion !== 3 || !isRecord(parsed.packages)) {
    if (isRecord(parsed) && parsed.lockfileVersion !== 3) throw new BindingFailure("lockfile-version");
    throw new BindingFailure("lockfile-invalid");
  }
  const packages = new Map<string, LockPackage>();
  for (const [rawPath, rawPackage] of Object.entries(parsed.packages)) {
    if (!isRecord(rawPackage)) throw new BindingFailure("lockfile-invalid");
    const path = normalizeLockPackagePath(rawPath);
    const absolutePath = path === "" ? resolve(baseDirectory) : resolve(baseDirectory, ...path.split("/"));
    if (!isContained(resolve(baseDirectory), absolutePath)) throw new BindingFailure("realpath-escape");
    const name = typeof rawPackage.name === "string" ? rawPackage.name : packageNameFromPath(path);
    const version = rawPackage.version;
    if (name === undefined || typeof version !== "string") throw new BindingFailure("lockfile-invalid");
    const lockPackage: LockPackage = {
      path: source === "root" ? path : path === "" ? "" : `tools/${path}`,
      absolutePath,
      name,
      version,
      integrity: typeof rawPackage.integrity === "string" ? rawPackage.integrity : null,
      dev: rawPackage.dev === true,
      optional: rawPackage.optional === true,
      dependencies: dependencyMap(rawPackage),
      source,
    };
    if (packages.has(path)) throw new BindingFailure("ambiguous-package");
    packages.set(path, lockPackage);
  }
  const root = packages.get("");
  if (root === undefined) throw new BindingFailure("lockfile-invalid");
  return { source, baseDirectory: resolve(baseDirectory), root, packages };
}

function normalizeLockPackagePath(value: string): string {
  if (value === "") return "";
  if (value.includes("\\") || isAbsolute(value)) throw new BindingFailure("lockfile-invalid");
  const normalized = value.replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new BindingFailure("lockfile-invalid");
  }
  if (!normalized.startsWith("node_modules/")) throw new BindingFailure("lockfile-invalid");
  return normalized;
}

function packageNameFromPath(path: string): string | undefined {
  if (path === "") return undefined;
  const marker = path.lastIndexOf("node_modules/");
  if (marker < 0) return undefined;
  const packagePath = path.slice(marker + "node_modules/".length);
  const [first, second] = packagePath.split("/");
  if (first === undefined || first.length === 0) return undefined;
  return first.startsWith("@") ? (second === undefined ? undefined : `${first}/${second}`) : first;
}

function dependencyMap(rawPackage: RawRecord): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const optionalPeers = new Set<string>();
  if (isRecord(rawPackage.peerDependenciesMeta)) {
    for (const [name, metadata] of Object.entries(rawPackage.peerDependenciesMeta)) {
      if (isRecord(metadata) && metadata.optional === true) optionalPeers.add(name);
    }
  }
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"] as const) {
    const raw = rawPackage[field];
    if (raw === undefined) continue;
    if (!isRecord(raw)) throw new BindingFailure("lockfile-invalid");
    for (const [name, version] of Object.entries(raw)) {
      if (field === "peerDependencies" && optionalPeers.has(name)) continue;
      if (typeof version !== "string" || name.length === 0) throw new BindingFailure("lockfile-invalid");
      const existing = result.get(name);
      if (existing !== undefined && existing !== version) throw new BindingFailure("ambiguous-package");
      result.set(name, version);
    }
  }
  return result;
}

async function resolveRuntimeClosure(
  rootModel: LockModel,
  toolsModel: LockModel,
  packageJson: PackageJson,
): Promise<Map<string, LockPackage>> {
  const closure = new Map<string, LockPackage>();
  const rootDependencies = dependencyMap({
    dependencies: packageJson.dependencies,
    optionalDependencies: packageJson.optionalDependencies,
    peerDependencies: packageJson.peerDependencies,
  });
  await resolveDependencies(rootModel, rootModel.root, rootDependencies, closure);
  await resolveDependencies(toolsModel, toolsModel.root, toolsModel.root.dependencies, closure, rootModel);
  return closure;
}

function mergeLockPackages(...models: readonly LockModel[]): Map<string, LockPackage> {
  const packages = new Map<string, LockPackage>();
  for (const model of models) {
    for (const packageEntry of model.packages.values()) {
      const existing = packages.get(packageEntry.absolutePath);
      if (
        existing !== undefined &&
        (existing.name !== packageEntry.name || existing.version !== packageEntry.version)
      ) {
        throw new BindingFailure("ambiguous-package");
      }
      packages.set(packageEntry.absolutePath, packageEntry);
    }
  }
  return packages;
}

async function resolveDependencies(
  model: LockModel,
  parent: LockPackage,
  dependencies: ReadonlyMap<string, string>,
  closure: Map<string, LockPackage>,
  fallbackModel?: LockModel,
): Promise<void> {
  for (const [name] of dependencies) {
    const packageEntry = await resolvePackage(model, parent, name, fallbackModel);
    if (closure.has(packageEntry.absolutePath)) continue;
    closure.set(packageEntry.absolutePath, packageEntry);
    const nextModel = packageEntry.source === "root" && fallbackModel !== undefined ? fallbackModel : model;
    const nextFallback = nextModel === fallbackModel ? undefined : fallbackModel;
    await resolveDependencies(nextModel, packageEntry, packageEntry.dependencies, closure, nextFallback);
  }
}

async function resolvePackage(
  model: LockModel,
  parent: LockPackage,
  name: string,
  fallbackModel?: LockModel,
): Promise<LockPackage> {
  const candidates = candidatePackagePaths(model, parent, name);
  const present = candidates
    .map((path) => model.packages.get(path))
    .filter((entry): entry is LockPackage => entry !== undefined);
  if (present.length > 0) {
    for (const candidate of present) {
      if (candidate.name !== name) throw new BindingFailure("package-name-mismatch");
      if (await exists(join(candidate.absolutePath, "package.json"))) return candidate;
    }
    const fallback = fallbackModel === undefined ? undefined : await resolveHoistedPackage(fallbackModel, parent, name);
    return fallback ?? present[0];
  }
  const fallback = fallbackModel === undefined ? undefined : await resolveHoistedPackage(fallbackModel, parent, name);
  if (fallback !== undefined) return fallback;
  throw new BindingFailure("unresolved-package");
}

function candidatePackagePaths(model: LockModel, parent: LockPackage, name: string): string[] {
  return candidateAbsolutePackagePaths(model.baseDirectory, parent.absolutePath, name).map((absolutePath) =>
    relative(model.baseDirectory, absolutePath).split(sep).join("/"),
  );
}

function candidateAbsolutePackagePaths(baseDirectory: string, parentPath: string, name: string): string[] {
  const candidates: string[] = [];
  let current = parentPath;
  while (isContained(baseDirectory, current)) {
    candidates.push(join(current, "node_modules", ...name.split("/")));
    if (current === baseDirectory) break;
    current = dirname(current);
  }
  return candidates;
}

async function resolveHoistedPackage(
  model: LockModel,
  parent: LockPackage,
  name: string,
): Promise<LockPackage | undefined> {
  const candidates = candidateAbsolutePackagePaths(model.baseDirectory, parent.absolutePath, name);
  let fallback: LockPackage | undefined;
  for (const absolutePath of candidates) {
    const packagePath = relative(model.baseDirectory, absolutePath).split(sep).join("/");
    const candidate = model.packages.get(packagePath);
    if (candidate === undefined) continue;
    if (candidate.name !== name) throw new BindingFailure("package-name-mismatch");
    fallback ??= candidate;
    if (await exists(join(candidate.absolutePath, "package.json"))) return candidate;
  }
  return fallback;
}

async function rejectUnlockedInstalledPackages(
  root: string,
  closure: ReadonlyMap<string, LockPackage>,
  allLocked: ReadonlyMap<string, LockPackage>,
): Promise<void> {
  for (const nodeModulesPath of [join(root, "node_modules"), join(root, "tools", "node_modules")]) {
    if (!(await exists(nodeModulesPath))) continue;
    await inspectNodeModules(nodeModulesPath, root, closure, allLocked);
  }
}

async function inspectNodeModules(
  nodeModulesPath: string,
  root: string,
  closure: ReadonlyMap<string, LockPackage>,
  allLocked: ReadonlyMap<string, LockPackage>,
): Promise<void> {
  const metadata = await lstat(nodeModulesPath);
  if (metadata.isSymbolicLink()) await rejectLink(nodeModulesPath);
  if (!metadata.isDirectory()) throw new BindingFailure("non-regular-file");
  const entries = await readdir(nodeModulesPath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (entry.name === ".bin") continue;
    const candidate = join(nodeModulesPath, entry.name);
    const candidateMetadata = await lstat(candidate);
    if (candidateMetadata.isSymbolicLink()) await rejectLink(candidate);
    if (!candidateMetadata.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scopeMetadata = await lstat(candidate);
      if (scopeMetadata.isSymbolicLink()) await rejectLink(candidate);
      if (!scopeMetadata.isDirectory()) throw new BindingFailure("non-regular-file");
      const scopedEntries = await readdir(candidate, { withFileTypes: true });
      for (const scopedEntry of scopedEntries) {
        await inspectInstalledPackage(join(candidate, scopedEntry.name), root, closure, allLocked);
      }
      continue;
    }
    await inspectInstalledPackage(candidate, root, closure, allLocked);
  }
}

async function inspectInstalledPackage(
  packagePath: string,
  root: string,
  closure: ReadonlyMap<string, LockPackage>,
  allLocked: ReadonlyMap<string, LockPackage>,
): Promise<void> {
  const metadata = await lstat(packagePath);
  if (metadata.isSymbolicLink()) await rejectLink(packagePath);
  if (!metadata.isDirectory()) throw new BindingFailure("non-regular-file");
  const packageJsonPath = join(packagePath, "package.json");
  if (!(await exists(packageJsonPath))) return;
  const relativePath = relative(root, packagePath).split(sep).join("/");
  const absolutePackagePath = resolve(packagePath);
  const lockPackage = allLocked.get(absolutePackagePath);
  if (lockPackage === undefined || lockPackage.path !== relativePath) {
    throw new BindingFailure("installed-package-absent-from-lock");
  }
  if (!closure.has(absolutePackagePath) && !lockPackage.dev) {
    throw new BindingFailure("installed-package-outside-closure");
  }
  const nestedNodeModules = join(packagePath, "node_modules");
  if (await exists(nestedNodeModules)) await inspectNodeModules(nestedNodeModules, root, closure, allLocked);
}

async function walkFiles(directory: string, root: string, skipNestedNodeModules = false): Promise<FileObservation[]> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink()) await rejectLink(directory);
  if (!metadata.isDirectory()) throw new BindingFailure("missing-directory");
  const files: FileObservation[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareStrings(left.name, right.name))) {
    if (skipNestedNodeModules && entry.name === "node_modules") continue;
    const child = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(child, root, skipNestedNodeModules)));
    } else {
      const bytes = await readRegularFile(child);
      files.push({ path: relative(root, child).split(sep).join("/"), bytes });
    }
  }
  return files;
}

async function readRegularFile(
  path: string,
  missingCode: LemmaScriptDependencyBindingRejectionCode = "missing-package",
): Promise<Buffer> {
  let metadata: Awaited<ReturnType<typeof lstat>>;
  try {
    metadata = await lstat(path);
  } catch {
    throw new BindingFailure(missingCode);
  }
  if (metadata.isSymbolicLink()) await rejectLink(path);
  if (!metadata.isFile()) throw new BindingFailure("non-regular-file");
  try {
    return await readFile(path);
  } catch {
    throw new BindingFailure("io-error");
  }
}

function canonicalManifest(files: readonly FileObservation[]): readonly LemmaScriptDependencyManifestEntry[] {
  const byPath = new Map<string, { readonly rawPath: string; readonly entry: LemmaScriptDependencyManifestEntry }>();
  for (const file of files) {
    const path = canonicalText(file.path);
    if (!isPortableRelativePath(path)) throw new BindingFailure("absolute-path");
    const entry: LemmaScriptDependencyManifestEntry = {
      path,
      size: file.bytes.byteLength,
      digest: digestBytes(file.bytes),
    };
    const previous = byPath.get(entry.path);
    if (previous !== undefined) {
      if (previous.rawPath !== file.path) throw new BindingFailure("canonical-path-collision");
      if (previous.entry.size !== entry.size || previous.entry.digest !== entry.digest) {
        throw new BindingFailure("ambiguous-package");
      }
    }
    byPath.set(entry.path, { rawPath: file.path, entry });
  }
  return [...byPath.values()].map(({ entry }) => entry).sort((left, right) => compareStrings(left.path, right.path));
}

function canonicalPackages(packageFacts: readonly InternalPackageFact[]): readonly LemmaScriptDependencyPackageFact[] {
  const byPath = new Map<string, { readonly rawPath: string; readonly fact: LemmaScriptDependencyPackageFact }>();
  for (const { package: packageEntry } of packageFacts) {
    const fact: LemmaScriptDependencyPackageFact = {
      path: canonicalText(packageEntry.path),
      name: canonicalText(packageEntry.name),
      version: canonicalText(packageEntry.version),
      integrity: packageEntry.integrity === null ? null : canonicalText(packageEntry.integrity),
    };
    if (!isPortableRelativePath(fact.path)) throw new BindingFailure("absolute-path");
    const previous = byPath.get(fact.path);
    if (previous !== undefined) {
      if (previous.rawPath !== packageEntry.path) throw new BindingFailure("canonical-path-collision");
      if (
        previous.fact.name !== fact.name ||
        previous.fact.version !== fact.version ||
        previous.fact.integrity !== fact.integrity
      ) {
        throw new BindingFailure("ambiguous-package");
      }
    }
    byPath.set(fact.path, { rawPath: packageEntry.path, fact });
  }
  return [...byPath.values()].map(({ fact }) => fact).sort(comparePackages);
}

function isPortableRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !isAbsolute(path) &&
    !path.split("/").includes("..")
  );
}

function digestCanonicalManifest(
  manifest: readonly LemmaScriptDependencyManifestEntry[],
  packages: readonly LemmaScriptDependencyPackageFact[],
  runtime: LemmaScriptRuntimeFact,
  commands: readonly LemmaScriptAllowedCommand[],
): string {
  const chunks: Buffer[] = [Buffer.from("kiln.lemma-script-dependency-binding/v1\0", "utf8")];
  appendFrame(chunks, ["manifest"]);
  for (const entry of manifest) appendFrame(chunks, [entry.path, String(entry.size), entry.digest]);
  appendFrame(chunks, ["packages"]);
  for (const packageEntry of packages) {
    appendFrame(chunks, [packageEntry.path, packageEntry.name, packageEntry.version, packageEntry.integrity ?? ""]);
  }
  appendFrame(chunks, ["runtime"]);
  appendFrame(chunks, [runtime.role, runtime.digest, String(runtime.byteLength)]);
  appendFrame(chunks, ["commands"]);
  for (const command of commands) appendFrame(chunks, [command]);
  return `sha256:${createHash("sha256").update(Buffer.concat(chunks)).digest("hex")}`;
}

function appendFrame(target: Buffer[], values: readonly string[]): void {
  const fields = values.map((value) => Buffer.from(canonicalText(value), "utf8"));
  const fieldChunks: Buffer[] = [];
  for (const field of fields) {
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(field.byteLength, 0);
    fieldChunks.push(length, field);
  }
  const frame = Buffer.concat(fieldChunks);
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(frame.byteLength, 0);
  target.push(length, frame);
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function compareStrings(left: string, right: string): number {
  return Buffer.compare(Buffer.from(canonicalText(left), "utf8"), Buffer.from(canonicalText(right), "utf8"));
}

function canonicalText(value: string): string {
  return value.normalize("NFC");
}

function comparePackages(left: LemmaScriptDependencyPackageFact, right: LemmaScriptDependencyPackageFact): number {
  return (
    compareStrings(left.path, right.path) ||
    compareStrings(left.name, right.name) ||
    compareStrings(left.version, right.version)
  );
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}
