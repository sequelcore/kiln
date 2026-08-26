import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import type { Dirent } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, win32 } from "node:path";

import {
  createBenchmarkWriteWorkspaceLease,
  type BenchmarkWriteWorkspaceLease,
} from "../../benchmark-write-workspace.js";
import { countBenchmarkHiddenTests } from "../../benchmark-hidden-test-source.js";

export const PRIVATE_FORMAL_SCREENING_MANIFEST_VERSION = "private-formal-screening-v1" as const;
export const PRIVATE_FORMAL_SCREENING_MANIFEST_FILE = "manifest.json" as const;
export const PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH = "src/solution.ts" as const;
export const PRIVATE_FORMAL_SCREENING_ALLOWED_CHANGED_PATHS = [
  PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH,
] as const;
export const PRIVATE_FORMAL_SCREENING_PAIR_COUNT = 8;
export const PRIVATE_FORMAL_SCREENING_CASE_COUNT = PRIVATE_FORMAL_SCREENING_PAIR_COUNT * 2;

export type PrivateFormalScreeningArm = "C0" | "T";

export interface PrivateFormalScreeningCaseManifest {
  readonly id: string;
  readonly pairId: string;
  readonly arm: PrivateFormalScreeningArm;
  readonly prompt: string;
  readonly category?: string;
  readonly visibleFixture: string;
  readonly candidatePath: typeof PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH;
  readonly allowedChangedPaths: readonly [typeof PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH];
  readonly hiddenTestSource: string;
  readonly hiddenTestDigest: string;
  readonly hiddenTestCount: number;
  /** Operator-adopted statement that the sealed tests enumerate the declared finite domain. */
  readonly hiddenOracleExhaustive: true;
  readonly requiredFunctionNames: readonly string[];
  readonly hiddenRoot?: string;
  readonly oracleRoot?: string;
  readonly oracleDigest?: string;
  readonly mutantRoot?: string;
  readonly mutantDigest?: string;
}

export interface PrivateFormalScreeningManifest {
  readonly version: typeof PRIVATE_FORMAL_SCREENING_MANIFEST_VERSION;
  readonly visibleRoot?: string;
  readonly hiddenRoot?: string;
  readonly oracleRoot?: string;
  readonly oracleDigest?: string;
  readonly mutantRoot?: string;
  readonly mutantDigest?: string;
  readonly cases: readonly PrivateFormalScreeningCaseManifest[];
}

export interface LoadPrivateFormalScreeningPackageOptions {
  readonly packagePath: string;
  readonly repositoryRoot: string;
  /** Exact repository-local private root; defaults to `<repository>/.kiln-private`. */
  readonly repositoryPrivateRoot?: string;
  readonly publishSurfaceRoots?: readonly string[];
}

export interface PrivateFormalScreeningCaseFacts {
  readonly id: string;
  readonly pairId: string;
  readonly arm: PrivateFormalScreeningArm;
  readonly prompt: string;
  readonly category?: string;
  readonly visibleFixture: string;
  readonly visibleFixturePath: string;
  readonly packageRootPath: string;
  readonly candidatePath: typeof PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH;
  readonly allowedChangedPaths: typeof PRIVATE_FORMAL_SCREENING_ALLOWED_CHANGED_PATHS;
  readonly hiddenTestSource: string;
  readonly hiddenTestDigest: string;
  readonly hiddenTestCount: number;
  readonly hiddenOracleExhaustive: true;
  readonly requiredFunctionNames: readonly string[];
  readonly hiddenRoot?: string;
  readonly hiddenRootPath?: string;
  readonly oracleRoot?: string;
  readonly oracleRootPath?: string;
  readonly oracleDigest?: string;
  readonly mutantRoot?: string;
  readonly mutantRootPath?: string;
  readonly mutantDigest?: string;
}

export interface PrivateFormalScreeningPackageFacts {
  readonly version: typeof PRIVATE_FORMAL_SCREENING_MANIFEST_VERSION;
  readonly rootPath: string;
  readonly visibleRoot?: string;
  readonly visibleRootPath?: string;
  readonly hiddenRoot?: string;
  readonly hiddenRootPath?: string;
  readonly oracleRoot?: string;
  readonly oracleRootPath?: string;
  readonly oracleDigest?: string;
  readonly mutantRoot?: string;
  readonly mutantRootPath?: string;
  readonly mutantDigest?: string;
  readonly cases: readonly PrivateFormalScreeningCaseFacts[];
}

export interface PrivateFormalScreeningWorkspaceLease extends BenchmarkWriteWorkspaceLease {
  /** Temporary staging root that contains the visible fixture only. */
  readonly bridgeRootPath: string;
}

/**
 * Load private screening facts from an operator-supplied package root.
 *
 * The package is deliberately not a dataset source. It is accepted only as a
 * validated repository-private root and returns facts that a caller may later
 * project into its own benchmark item shape.
 */
export function loadPrivateFormalScreeningPackage(
  options: LoadPrivateFormalScreeningPackageOptions,
): PrivateFormalScreeningPackageFacts {
  const packagePath = options.packagePath;
  if (!isAbsolute(packagePath) || win32.isAbsolute(packagePath) === false && packagePath.startsWith("\\")) {
    throw new Error("Private formal screening package root must be an absolute path.");
  }
  const manifestPath = join(packagePath, PRIVATE_FORMAL_SCREENING_MANIFEST_FILE);
  let parsedManifest: unknown;
  try {
    parsedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Error(`Private formal screening package must contain ${PRIVATE_FORMAL_SCREENING_MANIFEST_FILE}.`);
  }
  const rawManifest = asRecord(parsedManifest, "Private formal screening manifest must be an object.");
  if (
    Object.hasOwn(rawManifest, "root")
    || Object.hasOwn(rawManifest, "rootPath")
    || Object.hasOwn(rawManifest, "packageRoot")
    || Object.hasOwn(rawManifest, "packagePath")
    || Object.hasOwn(rawManifest, "identity")
  ) {
    throw new Error("Private formal screening manifest cannot declare package root or identity.");
  }
  assertManifestVersion(rawManifest.version);
  const repositoryRoot = resolveTrustedDirectory(options.repositoryRoot, "repository root");
  const publishRoots = (options.publishSurfaceRoots ?? [])
    .map((path) => resolveTrustedDirectory(path, "publish surface"));
  const repositoryPrivateRoot = resolveTrustedDirectory(
    options.repositoryPrivateRoot ?? join(repositoryRoot, ".kiln-private"),
    "repository-private root",
  );
  if (samePath(repositoryRoot, repositoryPrivateRoot)
    || !isWithin(repositoryRoot, repositoryPrivateRoot)) {
    throw new Error("Private formal screening repository-private root must remain inside the repository.");
  }

  const rootPath = resolveTrustedDirectory(packagePath, "private formal screening package root");
  if (!isWithin(repositoryPrivateRoot, rootPath)) {
    throw new Error(
      "Private formal screening package root must remain inside the admitted repository-private root.",
    );
  }
  if (publishRoots.some((surface) => pathsOverlap(surface, rootPath))) {
    throw new Error("Private formal screening package root must remain outside publish surfaces.");
  }
  assertPortableTree(rootPath, "private formal screening package");

  const visibleRoot = resolveOptionalDirectory(rawManifest.visibleRoot, rootPath, "visible root");
  const hiddenRoot = resolveOptionalDirectory(rawManifest.hiddenRoot, rootPath, "hidden root");
  const oracle = resolveOptionalOpaqueRoot(rawManifest.oracleRoot, rawManifest.oracleDigest, rootPath, "oracle");
  const mutant = resolveOptionalOpaqueRoot(
    rawManifest.mutantRoot,
    rawManifest.mutantDigest,
    rootPath,
    "mutant",
  );
  assertPrivateRootsDoNotOverlap(hiddenRoot?.absolutePath, oracle?.absolutePath, mutant?.absolutePath);
  if (visibleRoot && [hiddenRoot?.absolutePath, oracle?.absolutePath, mutant?.absolutePath]
    .some((privateRoot) => privateRoot !== undefined && pathsOverlap(visibleRoot.absolutePath, privateRoot))) {
    throw new Error("Private formal screening visible and hidden/private roots must not overlap.");
  }

  const rawCases = readCases(rawManifest.cases);
  if (rawCases.length !== PRIVATE_FORMAL_SCREENING_CASE_COUNT) {
    throw new Error(`Private formal screening manifest requires exactly ${PRIVATE_FORMAL_SCREENING_CASE_COUNT} case rows.`);
  }

  const ids = new Set<string>();
  const pairRows = new Map<string, PrivateFormalScreeningCaseFacts[]>();
  const cases = rawCases.map((rawCase) => {
    const facts = loadCaseFacts({
      rawCase,
      rootPath,
      visibleRoot,
      hiddenRoot,
      oracle,
      mutant,
    });
    if (ids.has(facts.id)) throw new Error(`Private formal screening case id '${facts.id}' is duplicated.`);
    ids.add(facts.id);
    pairRows.set(facts.pairId, [...(pairRows.get(facts.pairId) ?? []), facts]);
    return facts;
  });

  if (pairRows.size !== PRIVATE_FORMAL_SCREENING_PAIR_COUNT) {
    throw new Error(`Private formal screening manifest requires exactly ${PRIVATE_FORMAL_SCREENING_PAIR_COUNT} pair ids.`);
  }
  for (const [pairId, rows] of pairRows) {
    if (rows.length !== 2 || new Set(rows.map((entry) => entry.arm)).size !== 2) {
      throw new Error(`Pair '${pairId}' must contain exactly one C0 and one T row.`);
    }
    if (new Set(rows.map((entry) => entry.prompt)).size !== 1
      || new Set(rows.map((entry) => entry.visibleFixture)).size !== 1) {
      throw new Error(`Pair '${pairId}' must share one prompt and visible fixture across arms.`);
    }
    if (new Set(rows.map((entry) => entry.hiddenTestDigest)).size !== 1
      || new Set(rows.map((entry) => entry.hiddenTestCount)).size !== 1
      || new Set(rows.map((entry) => entry.hiddenTestSource)).size !== 1
      || new Set(rows.map((entry) => entry.hiddenOracleExhaustive)).size !== 1
      || new Set(rows.map((entry) => JSON.stringify(entry.requiredFunctionNames))).size !== 1) {
      throw new Error(`Pair '${pairId}' must share one hidden test contract across arms.`);
    }
  }

  return {
    version: PRIVATE_FORMAL_SCREENING_MANIFEST_VERSION,
    rootPath,
    ...(visibleRoot ? { visibleRoot: visibleRoot.relativePath, visibleRootPath: visibleRoot.absolutePath } : {}),
    ...(hiddenRoot ? { hiddenRoot: hiddenRoot.relativePath, hiddenRootPath: hiddenRoot.absolutePath } : {}),
    ...(oracle ? {
      oracleRoot: oracle.relativePath,
      oracleRootPath: oracle.absolutePath,
      oracleDigest: oracle.digest,
    } : {}),
    ...(mutant ? {
      mutantRoot: mutant.relativePath,
      mutantRootPath: mutant.absolutePath,
      mutantDigest: mutant.digest,
    } : {}),
    cases,
  };
}

/**
 * Materialize a model-facing workspace from only one validated visible
 * subtree, then delegate workspace snapshotting and cleanup to the existing
 * benchmark write-workspace lease.
 */
export function createPrivateFormalScreeningWorkspaceLease(
  screeningCase: PrivateFormalScreeningCaseFacts,
): PrivateFormalScreeningWorkspaceLease {
  const bridgeRootPath = mkdtempSync(join(tmpdir(), "kiln-private-formal-screening-"));
  const visibleStagePath = join(bridgeRootPath, "visible");
  try {
    assertPortableTree(screeningCase.visibleFixturePath, "private formal screening visible fixture");
    copyPortableTree(screeningCase.visibleFixturePath, visibleStagePath);
    const lease = createBenchmarkWriteWorkspaceLease(bridgeRootPath, "visible");
    let cleaned = false;
    return {
      ...lease,
      bridgeRootPath,
      cleanup: () => {
        if (cleaned) return;
        try {
          lease.cleanup();
        } finally {
          removeOwnedTemporaryRoot(bridgeRootPath);
          cleaned = true;
        }
      },
    };
  } catch (error) {
    removeOwnedTemporaryRoot(bridgeRootPath);
    throw error;
  }
}

/** Hash a portable directory tree using stable path and byte framing. */
export function hashPrivateFormalScreeningTree(rootPath: string): string {
  const canonicalRoot = resolveTrustedDirectory(rootPath, "private formal screening tree");
  assertPortableTree(canonicalRoot, "private formal screening tree");
  const hash = createHash("sha256");
  hashPrivateTree(canonicalRoot, canonicalRoot, hash);
  return `sha256:${hash.digest("hex")}`;
}

interface LoadedRoot {
  readonly relativePath: string;
  readonly absolutePath: string;
}

interface LoadedOpaqueRoot extends LoadedRoot {
  readonly digest: string;
}

interface RawCase {
  readonly id: unknown;
  readonly pairId: unknown;
  readonly arm: unknown;
  readonly prompt: unknown;
  readonly category: unknown;
  readonly visibleFixture: unknown;
  readonly candidatePath: unknown;
  readonly allowedChangedPaths: unknown;
  readonly hiddenTestSource: unknown;
  readonly hiddenTestDigest: unknown;
  readonly hiddenTestCount: unknown;
  readonly hiddenOracleExhaustive: unknown;
  readonly requiredFunctionNames: unknown;
  readonly hiddenRoot: unknown;
  readonly oracleRoot: unknown;
  readonly oracleDigest: unknown;
  readonly mutantRoot: unknown;
  readonly mutantDigest: unknown;
}

interface LoadCaseContext {
  readonly rawCase: RawCase;
  readonly rootPath: string;
  readonly visibleRoot?: LoadedRoot;
  readonly hiddenRoot?: LoadedRoot;
  readonly oracle?: LoadedOpaqueRoot;
  readonly mutant?: LoadedOpaqueRoot;
}

function loadCaseFacts(context: LoadCaseContext): PrivateFormalScreeningCaseFacts {
  const rawCase = context.rawCase;
  const id = readIdentifier(rawCase.id, "case id");
  const pairId = readIdentifier(rawCase.pairId, "pair id");
  const arm = normalizeArm(rawCase.arm);
  const prompt = readNonEmptyString(rawCase.prompt, "prompt");
  const category = readOptionalNonEmptyString(rawCase.category, "category");
  const visibleFixture = readPortableRelativePath(rawCase.visibleFixture, "visible fixture");
  const visibleFixturePath = resolvePackagePath(context.rootPath, visibleFixture, "visible fixture");
  if (context.visibleRoot && !isWithin(context.visibleRoot.absolutePath, visibleFixturePath)) {
    throw new Error(`Visible fixture '${visibleFixture}' must remain inside the declared visible root.`);
  }
  assertDirectory(visibleFixturePath, "visible fixture");
  assertPortableTree(visibleFixturePath, "visible fixture");
  const candidatePath = readString(rawCase.candidatePath, "candidate path");
  if (candidatePath !== PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH) {
    throw new Error(`Private formal screening candidate path must be '${PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH}'.`);
  }
  const allowedChangedPaths = readAllowedChangedPaths(rawCase.allowedChangedPaths);
  if (allowedChangedPaths.length !== 1 || allowedChangedPaths[0] !== PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH) {
    throw new Error("Private formal screening allowed changed paths must contain only src/solution.ts.");
  }
  assertRegularFile(join(visibleFixturePath, ...candidatePath.split("/")), "candidate source");

  const hiddenRoot = resolveCaseRoot(rawCase.hiddenRoot, context.hiddenRoot, context.rootPath, "hidden");
  const oracle = resolveCaseOpaqueRoot(
    rawCase.oracleRoot,
    rawCase.oracleDigest,
    context.oracle,
    context.rootPath,
    "oracle",
  );
  const mutant = resolveCaseOpaqueRoot(
    rawCase.mutantRoot,
    rawCase.mutantDigest,
    context.mutant,
    context.rootPath,
    "mutant",
  );
  assertPrivateRootsDoNotOverlap(
    hiddenRoot?.absolutePath,
    oracle?.absolutePath,
    mutant?.absolutePath,
  );
  if ([hiddenRoot?.absolutePath, oracle?.absolutePath, mutant?.absolutePath]
    .some((privateRoot) => privateRoot !== undefined && pathsOverlap(visibleFixturePath, privateRoot))) {
    throw new Error("Private formal screening visible fixture must not overlap hidden, oracle, or mutant roots.");
  }

  const hiddenTestSource = readNonEmptyString(rawCase.hiddenTestSource, "hidden test source");
  const hiddenTestDigest = readDigest(rawCase.hiddenTestDigest, "hidden test digest");
  const actualDigest = digestBytes(Buffer.from(hiddenTestSource, "utf8"));
  if (hiddenTestDigest !== actualDigest) {
    throw new Error(`Private formal screening hidden test digest does not match source for case '${id}'.`);
  }
  const hiddenTestCount = readPositiveInteger(rawCase.hiddenTestCount, "hidden test count");
  const actualCount = countBenchmarkHiddenTests(hiddenTestSource);
  if (actualCount !== hiddenTestCount) {
    throw new Error(`Private formal screening hidden test count does not match source for case '${id}'.`);
  }
  if (rawCase.hiddenOracleExhaustive !== true) {
    throw new Error("Private formal screening hiddenOracleExhaustive must be the literal true.");
  }
  const requiredFunctionNames = readRequiredFunctionNames(rawCase.requiredFunctionNames);

  return {
    id,
    pairId,
    arm,
    prompt,
    ...(category ? { category } : {}),
    visibleFixture,
    visibleFixturePath,
    packageRootPath: context.rootPath,
    candidatePath: PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH,
    allowedChangedPaths: PRIVATE_FORMAL_SCREENING_ALLOWED_CHANGED_PATHS,
    hiddenTestSource,
    hiddenTestDigest,
    hiddenTestCount,
    hiddenOracleExhaustive: true,
    requiredFunctionNames,
    ...(hiddenRoot ? { hiddenRoot: hiddenRoot.relativePath, hiddenRootPath: hiddenRoot.absolutePath } : {}),
    ...(oracle ? {
      oracleRoot: oracle.relativePath,
      oracleRootPath: oracle.absolutePath,
      oracleDigest: oracle.digest,
    } : {}),
    ...(mutant ? {
      mutantRoot: mutant.relativePath,
      mutantRootPath: mutant.absolutePath,
      mutantDigest: mutant.digest,
    } : {}),
  };
}

function readCases(value: unknown): RawCase[] {
  if (!Array.isArray(value)) throw new Error("Private formal screening manifest cases must be an array.");
  return value.map((entry) => {
    const record = asRecord(entry, "Private formal screening case must be an object.");
    return {
      id: record.id,
      pairId: record.pairId,
      arm: record.arm,
      prompt: record.prompt,
      category: record.category,
      visibleFixture: record.visibleFixture,
      candidatePath: record.candidatePath,
      allowedChangedPaths: record.allowedChangedPaths,
      hiddenTestSource: record.hiddenTestSource,
      hiddenTestDigest: record.hiddenTestDigest,
      hiddenTestCount: record.hiddenTestCount,
      hiddenOracleExhaustive: record.hiddenOracleExhaustive,
      requiredFunctionNames: record.requiredFunctionNames,
      hiddenRoot: record.hiddenRoot,
      oracleRoot: record.oracleRoot,
      oracleDigest: record.oracleDigest,
      mutantRoot: record.mutantRoot,
      mutantDigest: record.mutantDigest,
    };
  });
}

function resolveCaseRoot(
  value: unknown,
  fallback: LoadedRoot | undefined,
  packageRoot: string,
  label: string,
): LoadedRoot | undefined {
  if (value === undefined) return fallback;
  return resolveOptionalDirectory(value, packageRoot, `${label} root`);
}

function resolveCaseOpaqueRoot(
  rootValue: unknown,
  digestValue: unknown,
  fallback: LoadedOpaqueRoot | undefined,
  packageRoot: string,
  label: string,
): LoadedOpaqueRoot | undefined {
  if (rootValue === undefined && digestValue === undefined) return fallback;
  if (rootValue === undefined || digestValue === undefined) {
    throw new Error(`${label} root and digest must be supplied together.`);
  }
  const root = resolveOptionalDirectory(rootValue, packageRoot, `${label} root`);
  if (!root) throw new Error(`${label} root is required when a digest is supplied.`);
  const digest = readDigest(digestValue, `${label} digest`);
  const actual = hashPrivateFormalScreeningTree(root.absolutePath);
  if (digest !== actual) throw new Error(`${label} root digest does not match its contents.`);
  return { ...root, digest };
}

function resolveOptionalOpaqueRoot(
  rootValue: unknown,
  digestValue: unknown,
  packageRoot: string,
  label: string,
): LoadedOpaqueRoot | undefined {
  if (rootValue === undefined && digestValue === undefined) return undefined;
  if (rootValue === undefined || digestValue === undefined) {
    throw new Error(`${label} root and digest must be supplied together.`);
  }
  const root = resolveOptionalDirectory(rootValue, packageRoot, `${label} root`);
  if (!root) throw new Error(`${label} root is required when a digest is supplied.`);
  const digest = readDigest(digestValue, `${label} digest`);
  const actual = hashPrivateFormalScreeningTree(root.absolutePath);
  if (digest !== actual) throw new Error(`${label} root digest does not match its contents.`);
  return { ...root, digest };
}

function resolveOptionalDirectory(value: unknown, packageRoot: string, label: string): LoadedRoot | undefined {
  if (value === undefined) return undefined;
  const relativePath = readPortableRelativePath(value, label);
  const absolutePath = resolvePackagePath(packageRoot, relativePath, label);
  assertDirectory(absolutePath, label);
  assertPortableTree(absolutePath, label);
  return { relativePath, absolutePath };
}

function resolvePackagePath(packageRoot: string, relativePath: string, label: string): string {
  const absolutePath = join(packageRoot, ...relativePath.split("/"));
  if (!isWithin(packageRoot, absolutePath)) {
    throw new Error(`${label} must remain inside the private formal screening package root.`);
  }
  const canonicalPath = resolveTrustedPath(absolutePath, label);
  if (!isWithin(packageRoot, canonicalPath)) {
    throw new Error(`${label} must remain inside the private formal screening package root.`);
  }
  return canonicalPath;
}

function resolveTrustedDirectory(path: string, label: string): string {
  const canonicalPath = resolveTrustedPath(path, label);
  assertDirectory(canonicalPath, label);
  return canonicalPath;
}

function resolveTrustedPath(path: string, label: string): string {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${label} must be a path.`);
  let canonicalPath: string;
  try {
    assertNoSymlinkAncestors(path, label);
    canonicalPath = realpathSync(path);
  } catch (error) {
    if (error instanceof Error && /symbolic link|junction/u.test(error.message)) throw error;
    throw new Error(`${label} does not exist.`);
  }
  if (!samePath(canonicalPath, path)) {
    throw new Error(`${label} cannot be a symbolic link or junction.`);
  }
  return canonicalPath;
}

function assertNoSymlinkAncestors(path: string, label: string): void {
  let current = resolve(path);
  while (true) {
    const metadata = lstatSync(current);
    if (metadata.isSymbolicLink()) throw new Error(`${label} cannot contain a symbolic link or junction.`);
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertPortableTree(rootPath: string, label: string): void {
  const metadata = lstatSync(rootPath);
  if (metadata.isSymbolicLink()) throw new Error(`${label} contains a symbolic link or junction.`);
  if (!metadata.isDirectory()) throw new Error(`${label} must be a directory.`);
  for (const entry of sortedEntries(rootPath)) {
    const path = join(rootPath, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`${label} contains a symbolic link or junction at '${portablePath(rootPath, path)}'.`);
    if (entry.isDirectory()) {
      assertPortableTree(path, label);
    } else if (!entry.isFile()) {
      throw new Error(`${label} contains a non-portable entry at '${portablePath(rootPath, path)}'.`);
    }
  }
}

function copyPortableTree(sourceRoot: string, destinationRoot: string): void {
  mkdirSync(destinationRoot, { recursive: true });
  for (const entry of sortedEntries(sourceRoot)) {
    const sourcePath = join(sourceRoot, entry.name);
    const destinationPath = join(destinationRoot, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Private formal screening visible fixture contains a symbolic link.");
    if (entry.isDirectory()) {
      copyPortableTree(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      writeFileSync(destinationPath, readFileSync(sourcePath));
    } else {
      throw new Error("Private formal screening visible fixture contains a non-portable entry.");
    }
  }
}

function hashPrivateTree(rootPath: string, currentPath: string, hash: ReturnType<typeof createHash>): void {
  for (const entry of sortedEntries(currentPath)) {
    const path = join(currentPath, entry.name);
    const normalizedPath = portablePath(rootPath, path);
    if (entry.isDirectory()) {
      hash.update(`directory\0${normalizedPath}\0`, "utf8");
      hashPrivateTree(rootPath, path, hash);
    } else if (entry.isFile()) {
      hash.update(`file\0${normalizedPath}\0`, "utf8");
      hash.update(readFileSync(path));
      hash.update("\0", "utf8");
    } else {
      throw new Error(`Private formal screening tree contains a non-portable entry at '${normalizedPath}'.`);
    }
  }
}

function sortedEntries(path: string): Dirent[] {
  return readdirSync(path, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function assertPrivateRootsDoNotOverlap(...roots: Array<string | undefined>): void {
  const present = roots.filter((root): root is string => root !== undefined);
  for (let leftIndex = 0; leftIndex < present.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < present.length; rightIndex += 1) {
      if (pathsOverlap(present[leftIndex]!, present[rightIndex]!)) {
        throw new Error("Private formal screening hidden, oracle, and mutant roots must not overlap.");
      }
    }
  }
}

function readAllowedChangedPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value)) throw new Error("Private formal screening allowed changed paths must be an array.");
  return value.map((entry) => readPortableRelativePath(entry, "allowed changed path"));
}

function readIdentifier(value: unknown, label: string): string {
  const identifier = readNonEmptyString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(identifier)) {
    throw new Error(`${label} must be a portable synthetic identifier.`);
  }
  return identifier;
}

function normalizeArm(value: unknown): PrivateFormalScreeningArm {
  if (value === "C0") return "C0";
  if (value === "T") return "T";
  throw new Error("Private formal screening cases require an exact C0 or T arm.");
}

function readPortableRelativePath(value: unknown, label: string): string {
  const path = readString(value, label);
  if (path.includes("\0") || path.includes("\\") || isAbsolute(path) || win32.isAbsolute(path)) {
    throw new Error(`${label} must be a portable relative path.`);
  }
  const segments = path.split("/");
  if (segments.length === 0 || segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    throw new Error(`${label} must be a portable relative path.`);
  }
  return path;
}

function readDigest(value: unknown, label: string): string {
  const digest = readString(value, label);
  if (!/^sha256:[a-f0-9]{64}$/u.test(digest)) throw new Error(`${label} must be a sha256 digest.`);
  return digest;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function readRequiredFunctionNames(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Private formal screening required function names must be a non-empty array.");
  }
  const names = value.map((entry) => {
    const name = readNonEmptyString(entry, "required function name");
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)) {
      throw new Error("Private formal screening required function names must be canonical identifiers.");
    }
    return name;
  });
  if (new Set(names).size !== names.length) {
    throw new Error("Private formal screening required function names must be unique.");
  }
  return names;
}

function readString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string.`);
  return value;
}

function readNonEmptyString(value: unknown, label: string): string {
  const string = readString(value, label);
  if (string.trim().length === 0) throw new Error(`${label} must be non-empty.`);
  return string;
}

function readOptionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined;
  return readNonEmptyString(value, label);
}

function assertManifestVersion(value: unknown): void {
  if (value !== PRIVATE_FORMAL_SCREENING_MANIFEST_VERSION) {
    throw new Error(`Unsupported private formal screening manifest version '${String(value)}'.`);
  }
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function assertDirectory(path: string, label: string): void {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error(`${label} must be a regular directory.`);
}

function assertRegularFile(path: string, label: string): void {
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw new Error(`${label} must be a regular file.`);
}

function digestBytes(value: Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function pathsOverlap(left: string, right: string): boolean {
  return isWithin(left, right) || isWithin(right, left);
}

function isWithin(parent: string, child: string): boolean {
  const path = relative(resolve(parent), resolve(child));
  return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith("..\\") && !path.startsWith("../"));
}

function samePath(left: string, right: string): boolean {
  return relative(resolve(left), resolve(right)) === "";
}

function portablePath(root: string, path: string): string {
  return relative(root, path).replace(/\\/gu, "/");
}

function removeOwnedTemporaryRoot(path: string): void {
  if (!existsSync(path)) return;
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Refusing to clean an invalid private formal screening bridge root.");
  }
  rmSync(path, { recursive: true, force: true });
}
