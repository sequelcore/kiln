import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  PRIVATE_FORMAL_SCREENING_ALLOWED_CHANGED_PATHS,
  PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH,
  createPrivateFormalScreeningWorkspaceLease,
  hashPrivateFormalScreeningTree,
  loadPrivateFormalScreeningPackage,
  type PrivateFormalScreeningManifest,
} from "../../src/application/private-formal-screening-package.js";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("private formal screening package", () => {
  it("loads exactly eight paired cases and projects typed C0/T facts without a public dataset", () => {
    const { repositoryRoot, packagePath } = createManifest();

    const loaded = loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot });

    expect(loaded.cases).toHaveLength(16);
    expect(new Set(loaded.cases.map((entry) => entry.pairId))).toHaveLength(8);
    for (const pairId of new Set(loaded.cases.map((entry) => entry.pairId))) {
      const pair = loaded.cases.filter((entry) => entry.pairId === pairId);
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((entry) => entry.arm))).toEqual(new Set(["C0", "T"]));
      expect(new Set(pair.map((entry) => entry.prompt))).toHaveLength(1);
      expect(new Set(pair.map((entry) => entry.visibleFixture))).toHaveLength(1);
    }
    expect(loaded.cases[0]).toMatchObject({
      prompt: expect.any(String),
      candidatePath: PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH,
      allowedChangedPaths: [...PRIVATE_FORMAL_SCREENING_ALLOWED_CHANGED_PATHS],
      hiddenTestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      hiddenTestCount: 2,
      hiddenOracleExhaustive: true,
      requiredFunctionNames: ["solve"],
    });
    expect(loaded.hiddenRootPath).toBe(join(packagePath, "hidden"));
  });

  it("rejects invalid arm/count shape instead of silently filling a pair", () => {
    const { repositoryRoot, packagePath, manifest } = createManifest();
    const invalid = {
      ...manifest,
      cases: manifest.cases.slice(0, -1),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, invalid);

    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/exactly 16 case rows/u);

    const wrongArm = {
      ...manifest,
      cases: manifest.cases.map((entry, index) => index === 1 ? { ...entry, arm: "C0" as const } : entry),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, wrongArm);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/one C0 and one T/u);
  });

  it("rejects roots inside the repository or publish surface", () => {
    const repositoryRoot = createTemporaryRoot("repo");
    const privateRoot = join(repositoryRoot, "private");
    mkdirSync(privateRoot, { recursive: true });
    const { packagePath } = createManifest(privateRoot, repositoryRoot);

    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/outside the repository and publish surfaces/u);

    const externalRoot = createTemporaryRoot("external");
    const nestedPublishRoot = join(externalRoot, "publish");
    const packageRoot = join(nestedPublishRoot, "screening");
    mkdirSync(packageRoot, { recursive: true });
    const externalPackage = createManifest(packageRoot, repositoryRoot);
    expect(() => loadPrivateFormalScreeningPackage({
      packagePath: externalPackage.packagePath,
      repositoryRoot,
      publishSurfaceRoots: [nestedPublishRoot],
    })).toThrow(/outside the repository and publish surfaces/u);
  });

  it("binds package identity to packagePath instead of a manifest-declared root", () => {
    const { repositoryRoot, packagePath, manifest } = createManifest();
    writeFileSync(join(packagePath, "manifest.json"), JSON.stringify({ ...manifest, rootPath: packagePath }), "utf8");

    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/cannot declare package root or identity/u);
  });

  it("rejects symlinked and non-portable descendants when the platform supports links", () => {
    const { repositoryRoot, packagePath } = createManifest();
    const target = join(packagePath, "outside.txt");
    writeFileSync(target, "not private fixture", "utf8");
    try {
      symlinkSync(target, join(packagePath, "visible", "case-1", "leak.txt"));
    } catch {
      return;
    }

    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/symbolic link/u);
  });

  it("rejects hidden/visible overlap and hidden digest/count mismatches", () => {
    const { repositoryRoot, packagePath, manifest } = createManifest();
    const overlapping = {
      ...manifest,
      hiddenRoot: manifest.visibleRoot,
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, overlapping);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/overlap/u);

    const badDigest = {
      ...manifest,
      cases: manifest.cases.map((entry, index) => index === 0 ? { ...entry, hiddenTestDigest: "sha256:" + "0".repeat(64) } : entry),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, badDigest);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/hidden test digest/u);

    const badCount = {
      ...manifest,
      cases: manifest.cases.map((entry, index) => index === 0 ? { ...entry, hiddenTestCount: 1 } : entry),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, badCount);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/hidden test count/u);

    const nonExhaustive = {
      ...manifest,
      cases: manifest.cases.map((entry, index) => index === 0
        ? { ...entry, hiddenOracleExhaustive: false as unknown as true }
        : entry),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, nonExhaustive);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/hiddenOracleExhaustive/u);
  });

  it("rejects legacy arms and non-canonical required function names", () => {
    const { repositoryRoot, packagePath, manifest } = createManifest();
    const legacyArm = {
      ...manifest,
      cases: manifest.cases.map((entry, index) => index === 0
        ? { ...entry, arm: "control" as unknown as "C0" }
        : entry),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, legacyArm);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/exact C0 or T/u);

    const duplicateNames = {
      ...manifest,
      cases: manifest.cases.map((entry, index) => index === 0
        ? { ...entry, requiredFunctionNames: ["solve", "solve"] }
        : entry),
    } satisfies PrivateFormalScreeningManifest;
    writeManifest(packagePath, duplicateNames);
    expect(() => loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot }))
      .toThrow(/unique/u);
  });

  it("bridges only the visible fixture and removes the bridge with the write lease", () => {
    const { repositoryRoot, packagePath } = createManifest();
    const loaded = loadPrivateFormalScreeningPackage({ packagePath, repositoryRoot });
    const lease = createPrivateFormalScreeningWorkspaceLease(loaded.cases[0]!);

    expect(readFileSync(join(lease.rootPath, "src", "solution.ts"), "utf8"))
      .toContain("visible implementation");
    expect(existsSync(join(lease.rootPath, "hidden"))).toBe(false);
    expect(existsSync(join(lease.rootPath, "oracle"))).toBe(false);
    expect(existsSync(join(lease.rootPath, "mutants"))).toBe(false);
    expect(readWorkspaceFiles(lease.rootPath).join("\n"))
      .not.toContain("private-secret");

    const bridgeRoot = lease.bridgeRootPath;
    lease.cleanup();
    expect(existsSync(lease.rootPath)).toBe(false);
    expect(existsSync(bridgeRoot)).toBe(false);
    lease.cleanup();
  });
});

function createManifest(
  privateRoot = createTemporaryRoot("private"),
  repositoryRoot = createTemporaryRoot("repository"),
): {
  readonly repositoryRoot: string;
  readonly packagePath: string;
  readonly manifest: PrivateFormalScreeningManifest;
} {
  mkdirSync(join(privateRoot, "visible"), { recursive: true });
  mkdirSync(join(privateRoot, "hidden"), { recursive: true });
  mkdirSync(join(privateRoot, "oracle"), { recursive: true });
  mkdirSync(join(privateRoot, "mutants"), { recursive: true });
  writeFileSync(join(privateRoot, "hidden", "private-secret.txt"), "private-secret", "utf8");
  writeFileSync(join(privateRoot, "oracle", "oracle.json"), "{\"oracle\":true}\n", "utf8");
  writeFileSync(join(privateRoot, "mutants", "mutant.json"), "{\"mutant\":true}\n", "utf8");

  const hiddenTestSource = `import test from "node:test";\nimport assert from "node:assert/strict";\ntest("one", () => assert.equal(1, 1));\ntest("two", () => assert.equal(2, 2));\n`;
  const hiddenTestDigest = digest(hiddenTestSource);
  const cases = Array.from({ length: 8 }, (_, index) => {
    const pairId = `pair-${index + 1}`;
    const visibleFixture = `visible/case-${index + 1}`;
    const fixtureRoot = join(privateRoot, ...visibleFixture.split("/"));
    mkdirSync(join(fixtureRoot, "src"), { recursive: true });
    writeFileSync(join(fixtureRoot, "README.md"), `Visible task ${index + 1}\n`, "utf8");
    writeFileSync(join(fixtureRoot, "src", "solution.ts"), "// visible implementation\n", "utf8");
    const common = {
      pairId,
      prompt: `Implement private task ${index + 1}.`,
      visibleFixture,
      candidatePath: PRIVATE_FORMAL_SCREENING_CANDIDATE_PATH,
      allowedChangedPaths: [...PRIVATE_FORMAL_SCREENING_ALLOWED_CHANGED_PATHS] as ["src/solution.ts"],
      hiddenTestSource,
      hiddenTestDigest,
      hiddenTestCount: 2,
      hiddenOracleExhaustive: true as const,
      requiredFunctionNames: ["solve"],
      category: index % 2 === 0 ? "idempotency" : "authorization",
    };
    return [
      { ...common, id: `${pairId}-C0`, arm: "C0" as const },
      { ...common, id: `${pairId}-T`, arm: "T" as const },
    ];
  }).flat();

  const manifest: PrivateFormalScreeningManifest = {
    version: "private-formal-screening-v1",
    visibleRoot: "visible",
    hiddenRoot: "hidden",
    oracleRoot: "oracle",
    oracleDigest: hashPrivateFormalScreeningTree(join(privateRoot, "oracle")),
    mutantRoot: "mutants",
    mutantDigest: hashPrivateFormalScreeningTree(join(privateRoot, "mutants")),
    cases,
  };
  writeManifest(privateRoot, manifest);
  return { repositoryRoot, packagePath: privateRoot, manifest };
}

function writeManifest(packagePath: string, manifest: PrivateFormalScreeningManifest): void {
  writeFileSync(join(packagePath, "manifest.json"), `${JSON.stringify(manifest)}\n`, "utf8");
}

function createTemporaryRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `kiln-private-screening-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function digest(source: string): string {
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function readWorkspaceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) visit(path);
      else files.push(readFileSync(path, "utf8"));
    }
  };
  visit(root);
  return files;
}
