import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const INTERNAL_SCOPE = "@kilnai/";
const DEPENDENCY_SECTIONS = [
  "dependencies",
  "peerDependencies",
  "optionalDependencies",
  "devDependencies",
] as const;
const PUBLISH_ORDER_SECTIONS = ["dependencies", "peerDependencies", "optionalDependencies"] as const;
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const BETA_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-beta\.(0|[1-9]\d*)$/;

export interface PackageManifest {
  readonly name: string;
  readonly version: string;
  readonly private?: boolean;
  readonly files?: readonly string[];
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly publishConfig?: {
    readonly access?: string;
  };
  readonly scripts?: Readonly<Record<string, string>>;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly [key: string]: unknown;
}

export interface PackageRecord {
  readonly directory: string;
  readonly manifestPath: string;
  readonly manifest: PackageManifest;
}

export interface ReleaseIdentity {
  readonly version: string;
  readonly distTag: "latest" | "beta";
}

export interface ReleasePackage {
  readonly name: string;
  readonly directory: string;
  readonly version: string;
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
}

export interface ReleasePlan extends ReleaseIdentity {
  readonly packages: readonly ReleasePackage[];
}

export interface WorkspaceBuild {
  readonly name: string;
  readonly directory: string;
}

export interface LocalTarball {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface ReleaseTarball extends LocalTarball {
  readonly filename: string;
}

export interface RegistryPackageState {
  readonly versionIntegrity: string | null;
  readonly channelVersion: string | null;
}

export function assertTrustedPublishingEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): void {
  if (env.NODE_AUTH_TOKEN || env.NPM_TOKEN) {
    throw new Error(
      "Token-based npm publishing is forbidden; use npm trusted publishing with GitHub OIDC",
    );
  }
  if (env.GITHUB_ACTIONS !== "true") {
    throw new Error("npm publishing is restricted to the canonical GitHub Actions workflow");
  }
  if (!env.ACTIONS_ID_TOKEN_REQUEST_URL || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("GitHub OIDC is unavailable; trusted publishing cannot proceed");
  }
}

export function parseReleaseRef(ref: string): ReleaseIdentity {
  if (!ref.startsWith("v")) {
    throw new Error(`Release ref '${ref}' must start with v`);
  }
  const version = ref.slice(1);
  if (STABLE_SEMVER.test(version)) {
    return { version, distTag: "latest" };
  }
  if (BETA_SEMVER.test(version)) {
    return { version, distTag: "beta" };
  }
  throw new Error(
    `Release ref '${ref}' must be strict SemVer vMAJOR.MINOR.PATCH or vMAJOR.MINOR.PATCH-beta.NUMBER`,
  );
}

export function inferReleaseIdentity(
  records: readonly PackageRecord[],
): ReleaseIdentity {
  const publishedVersions = new Set(
    records
      .filter(
        ({ manifest }) =>
          manifest.private !== true &&
          manifest.name?.startsWith(INTERNAL_SCOPE),
      )
      .map(({ manifest }) => manifest.version),
  );

  if (publishedVersions.size === 0) {
    throw new Error("Cannot infer release identity from an empty cohort");
  }
  if (publishedVersions.size !== 1) {
    throw new Error(
      `Cannot infer release identity from split cohort versions: ${[...publishedVersions].sort().join(", ")}`,
    );
  }

  return parseReleaseRef(`v${[...publishedVersions][0]}`);
}

export async function discoverPackages(packagesRoot: string): Promise<PackageRecord[]> {
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const records: PackageRecord[] = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = join(packagesRoot, entry.name, "package.json");
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackageManifest;
      records.push({ directory: entry.name, manifestPath, manifest });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return records;
}

export function buildReleasePlan(
  records: readonly PackageRecord[],
  identity: ReleaseIdentity,
): ReleasePlan {
  const published = records.filter(
    ({ manifest }) => manifest.private !== true && manifest.name?.startsWith(INTERNAL_SCOPE),
  );
  if (published.length === 0) {
    throw new Error("Release cohort is empty");
  }

  const byName = new Map(published.map((record) => [record.manifest.name, record]));
  if (byName.size !== published.length) {
    throw new Error("Release cohort contains duplicate package names");
  }

  const failures: string[] = [];
  for (const record of published) {
    const { manifest } = record;
    if (manifest.version !== identity.version) {
      failures.push(
        `${manifest.name}: release cohort version must be ${identity.version}, found ${manifest.version}`,
      );
    }
    if (!manifest.files || manifest.files.length === 0) {
      failures.push(`${manifest.name}: publishable packages must declare a non-empty files allowlist`);
    }
    if (manifest.publishConfig?.access !== "public") {
      failures.push(`${manifest.name}: publishConfig.access must be public`);
    }
    if (manifest.files?.includes("dist") && manifest.scripts?.build === "tsc") {
      failures.push(
        `${manifest.name}: published TypeScript output must be cleaned before tsc`,
      );
    }
    if (
      manifest.name === "@kilnai/gui" &&
      Object.keys(manifest.dependencies ?? {}).length > 0
    ) {
      failures.push("@kilnai/gui: static distribution must not declare runtime dependencies");
    }
    for (const section of DEPENDENCY_SECTIONS) {
      for (const [dependency, range] of Object.entries(manifest[section] ?? {})) {
        if (dependency.startsWith(INTERNAL_SCOPE) && !byName.has(dependency)) {
          failures.push(`${manifest.name}: ${section} references missing release package ${dependency}`);
        } else if (dependency.startsWith(INTERNAL_SCOPE) && range !== identity.version) {
          failures.push(
            `${manifest.name}: ${section}.${dependency} must equal ${identity.version}, found ${range}`,
          );
        }
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  const ordered = orderPackageRecords(
    published,
    PUBLISH_ORDER_SECTIONS,
    "Release package",
  );

  return {
    ...identity,
    packages: ordered.map((record) => {
      return {
        name: record.manifest.name,
        directory: record.directory,
        version: identity.version,
        ...(record.manifest.os ? { os: record.manifest.os } : {}),
        ...(record.manifest.cpu ? { cpu: record.manifest.cpu } : {}),
      };
    }),
  };
}

export function buildWorkspaceOrder(
  records: readonly PackageRecord[],
): readonly WorkspaceBuild[] {
  return orderPackageRecords(records, DEPENDENCY_SECTIONS, "Workspace build")
    .filter((record) => typeof record.manifest.scripts?.build === "string")
    .map((record) => ({
      name: record.manifest.name,
      directory: record.directory,
    }));
}

export async function prepareStaging(
  plan: ReleasePlan,
  packagesRoot: string,
  stageRoot: string,
): Promise<void> {
  assertSafeStagingPath(packagesRoot, stageRoot);
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  const legalRoot = dirname(resolve(packagesRoot));

  for (const pkg of plan.packages) {
    const source = join(packagesRoot, pkg.directory);
    const target = join(stageRoot, pkg.directory);
    await cp(source, target, {
      recursive: true,
      filter: (candidate) => {
        const name = basename(candidate);
        return name !== "node_modules" && name !== ".turbo" && name !== ".vitest";
      },
    });
    await cp(join(legalRoot, "LICENSE"), join(target, "LICENSE"));
    await cp(join(legalRoot, "NOTICE"), join(target, "NOTICE"));
    const manifestPath = join(target, "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
    const files = Array.isArray(manifest.files)
      ? manifest.files.filter((entry): entry is string => typeof entry === "string")
      : [];
    manifest.files = [...new Set([...files, "LICENSE", "NOTICE"])];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

export function validateRegistryState(
  local: LocalTarball,
  registry: RegistryPackageState,
  distTag: ReleaseIdentity["distTag"],
): "publish" | "skip" {
  if (registry.versionIntegrity !== null && registry.versionIntegrity !== local.integrity) {
    throw new Error(
      `${local.name}@${local.version} exists with integrity ${registry.versionIntegrity}, expected ${local.integrity}`,
    );
  }
  if (
    registry.channelVersion !== null &&
    compareVersions(registry.channelVersion, local.version) > 0
  ) {
    throw new Error(
      `${local.name}: refusing ${distTag} channel rollback from ${registry.channelVersion} to ${local.version}`,
    );
  }
  return registry.versionIntegrity === local.integrity ? "skip" : "publish";
}

export async function calculateIntegrity(tarballPath: string): Promise<string> {
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(tarballPath)) {
    hash.update(chunk);
  }
  return `sha512-${hash.digest("base64")}`;
}

export function assertCompleteBundle(
  plan: ReleasePlan,
  tarballs: readonly ReleaseTarball[],
): void {
  const expected = new Map(plan.packages.map((pkg) => [pkg.name, pkg.version]));
  const found = new Map<string, string>();
  const failures: string[] = [];
  for (const tarball of tarballs) {
    if (found.has(tarball.name)) {
      failures.push(`duplicate tarball for ${tarball.name}`);
    }
    found.set(tarball.name, tarball.version);
    if (expected.get(tarball.name) !== tarball.version) {
      failures.push(`${tarball.name}: unexpected tarball version ${tarball.version}`);
    }
    if (!tarball.filename.endsWith(".tgz") || !tarball.integrity.startsWith("sha512-")) {
      failures.push(`${tarball.name}: invalid tarball metadata`);
    }
  }
  for (const [name, version] of expected) {
    if (found.get(name) !== version) {
      failures.push(`${name}@${version}: complete release bundle is missing its tarball`);
    }
  }
  if (found.size !== expected.size) {
    failures.push(`complete release bundle requires ${expected.size} tarballs, found ${found.size}`);
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

export function assertPackedLegalFiles(
  pkg: ReleasePackage,
  packedPaths: readonly string[],
): void {
  const paths = new Set(packedPaths.map((path) => path.replaceAll("\\", "/")));
  const required = [
    "LICENSE",
    "NOTICE",
    ...(pkg.os || pkg.cpu ? ["THIRD_PARTY_NOTICES.md"] : []),
  ];
  const missing = required.filter((path) => !paths.has(path));
  if (missing.length > 0) {
    throw new Error(`${pkg.name}: packed tarball is missing ${missing.join(", ")}`);
  }
}

export function selectInstallTarballs(
  plan: ReleasePlan,
  tarballs: readonly ReleaseTarball[],
  platform: string,
  arch: string,
): ReleaseTarball[] {
  const byName = new Map(tarballs.map((tarball) => [tarball.name, tarball]));
  const selected = plan.packages
    .filter(
      (pkg) =>
        (!pkg.os || pkg.os.includes(platform)) &&
        (!pkg.cpu || pkg.cpu.includes(arch)),
    )
    .map((pkg) => byName.get(pkg.name))
    .filter((tarball): tarball is ReleaseTarball => tarball !== undefined);
  if (selected.length === 0) {
    throw new Error(`Release bundle has no installable packages for ${platform}-${arch}`);
  }
  return selected;
}

export function isCleanSmokeTermination(result: {
  readonly code: number | null;
  readonly signal: string | null;
}): boolean {
  return result.code === 0 || (result.code === null && result.signal === "SIGTERM");
}

export function compareVersions(left: string, right: string): number {
  const a = semverTuple(left);
  const b = semverTuple(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index]! - b[index]!;
    }
  }
  if (a[3] === b[3]) return 0;
  if (a[3] === null) return 1;
  if (b[3] === null) return -1;
  return a[3] - b[3];
}

function semverTuple(version: string): [number, number, number, number | null] {
  const stable = STABLE_SEMVER.exec(version);
  if (stable) {
    return [Number(stable[1]), Number(stable[2]), Number(stable[3]), null];
  }
  const beta = BETA_SEMVER.exec(version);
  if (beta) {
    return [Number(beta[1]), Number(beta[2]), Number(beta[3]), Number(beta[4])];
  }
  throw new Error(`Unsupported registry SemVer '${version}'`);
}

function insertSorted(values: string[], value: string): void {
  if (values.includes(value)) return;
  const index = values.findIndex((candidate) => candidate.localeCompare(value) > 0);
  if (index === -1) values.push(value);
  else values.splice(index, 0, value);
}

function orderPackageRecords(
  records: readonly PackageRecord[],
  sections: readonly (typeof DEPENDENCY_SECTIONS)[number][],
  label: string,
): PackageRecord[] {
  const byName = new Map(records.map((record) => [record.manifest.name, record]));
  if (byName.size !== records.length) {
    throw new Error(`${label} contains duplicate package names`);
  }
  const dependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, Set<string>>();

  for (const record of records) {
    const packageDependencies = new Set<string>();
    for (const section of sections) {
      for (const dependency of Object.keys(record.manifest[section] ?? {})) {
        if (!byName.has(dependency)) continue;
        packageDependencies.add(dependency);
        const consumers = dependents.get(dependency) ?? new Set<string>();
        consumers.add(record.manifest.name);
        dependents.set(dependency, consumers);
      }
    }
    dependencies.set(record.manifest.name, packageDependencies);
  }

  const ready = [...dependencies]
    .filter(([, packageDependencies]) => packageDependencies.size === 0)
    .map(([name]) => name)
    .sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const name = ready.shift()!;
    ordered.push(name);
    for (const dependent of [...(dependents.get(name) ?? [])].sort()) {
      const remaining = dependencies.get(dependent)!;
      remaining.delete(name);
      if (remaining.size === 0) insertSorted(ready, dependent);
    }
  }

  if (ordered.length !== records.length) {
    const cycle = [...dependencies]
      .filter(([, remaining]) => remaining.size > 0)
      .map(([name]) => name)
      .sort();
    throw new Error(`${label} dependency cycle: ${cycle.join(", ")}`);
  }

  return ordered.map((name) => byName.get(name)!);
}

function assertSafeStagingPath(packagesRoot: string, stageRoot: string): void {
  const packages = resolve(packagesRoot);
  const stage = resolve(stageRoot);
  const relation = relative(packages, stage);
  if (stage === packages || relation === "" || (!relation.startsWith("..") && !relation.startsWith(`..${sep}`))) {
    throw new Error(`Staging root must be outside packages source tree: ${stage}`);
  }
  if (stage === resolve(stage, sep) || stage.length < 4) {
    throw new Error(`Unsafe staging root: ${stage}`);
  }
}
