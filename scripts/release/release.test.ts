import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertCompleteBundle,
  assertPackedLegalFiles,
  assertTrustedPublishingEnvironment,
  buildReleasePlan,
  buildWorkspaceOrder,
  calculateIntegrity,
  inferReleaseIdentity,
  isCleanSmokeTermination,
  type PackageRecord,
  parseReleaseRef,
  prepareStaging,
  selectInstallTarballs,
  validateRegistryState,
} from "./release.js";

describe("trusted publishing environment", () => {
  const oidc = {
    GITHUB_ACTIONS: "true",
    ACTIONS_ID_TOKEN_REQUEST_URL: "https://actions.example.test/oidc",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "request-token",
  };

  it("accepts only GitHub Actions with OIDC and without registry tokens", () => {
    expect(() => assertTrustedPublishingEnvironment(oidc)).not.toThrow();
    expect(() => assertTrustedPublishingEnvironment({})).toThrow(/GitHub Actions/);
    expect(() => assertTrustedPublishingEnvironment({ GITHUB_ACTIONS: "true" })).toThrow(/OIDC/);
  });

  it.each(["NODE_AUTH_TOKEN", "NPM_TOKEN"])("rejects token-based publication through %s", (name) => {
    expect(() => assertTrustedPublishingEnvironment({ ...oidc, [name]: "forbidden" })).toThrow(/Token-based/);
  });
});

const packageRecord = (
  name: string,
  dependencies: Record<string, string> = {},
  extra: Partial<PackageRecord["manifest"]> = {},
): PackageRecord => ({
  directory: name.replace("@kilnai/", ""),
  manifestPath: `/repo/packages/${name.replace("@kilnai/", "")}/package.json`,
  manifest: {
    name,
    version: "2.2.0-beta.1",
    files: ["dist"],
    publishConfig: { access: "public" },
    dependencies,
    ...extra,
  },
});

describe("parseReleaseRef", () => {
  it.each([
    ["v2.2.0", { version: "2.2.0", distTag: "latest" }],
    ["v2.2.0-beta.1", { version: "2.2.0-beta.1", distTag: "beta" }],
  ])("maps %s to its safe npm channel", (ref, expected) => {
    expect(parseReleaseRef(ref)).toEqual(expected);
  });

  it.each(["2.2.0", "v2.2", "v2.2.0-rc.1", "v2.2.0-beta", "v02.2.0", "v2.2.0+build"])(
    "rejects unsupported or ambiguous ref %s",
    (ref) => expect(() => parseReleaseRef(ref)).toThrow(),
  );
});

describe("inferReleaseIdentity", () => {
  it("derives a candidate identity from the complete public cohort", () => {
    expect(
      inferReleaseIdentity([
        packageRecord("@kilnai/core"),
        packageRecord("@kilnai/cli"),
        packageRecord("@kilnai/private", {}, { private: true, version: "0.0.0" }),
      ]),
    ).toEqual({ version: "2.2.0-beta.1", distTag: "beta" });
  });

  it("fails closed for an empty or split public cohort", () => {
    expect(() => inferReleaseIdentity([packageRecord("@kilnai/private", {}, { private: true })])).toThrow(/empty/);

    expect(() =>
      inferReleaseIdentity([packageRecord("@kilnai/core"), packageRecord("@kilnai/cli", {}, { version: "2.1.0" })]),
    ).toThrow(/split cohort/);
  });
});

describe("buildReleasePlan", () => {
  it("requires one complete version cohort and returns dependency-first order", () => {
    const records = [
      packageRecord("@kilnai/cli", { "@kilnai/core": "2.2.0-beta.1", "@kilnai/tools": "2.2.0-beta.1" }),
      packageRecord("@kilnai/core", { "@kilnai/gateway-contracts": "2.2.0-beta.1" }),
      packageRecord("@kilnai/gateway-contracts"),
      packageRecord("@kilnai/tools", {
        "@kilnai/tools-linux-x64": "2.2.0-beta.1",
        "@kilnai/tools-win32-x64": "2.2.0-beta.1",
      }),
      packageRecord("@kilnai/tools-linux-x64", {}, { os: ["linux"], cpu: ["x64"] }),
      packageRecord("@kilnai/tools-win32-x64", {}, { os: ["win32"], cpu: ["x64"] }),
      packageRecord("@kilnai/private", {}, { private: true }),
    ];

    const plan = buildReleasePlan(records, parseReleaseRef("v2.2.0-beta.1"));

    expect(plan.packages.map((pkg) => pkg.name)).toEqual([
      "@kilnai/gateway-contracts",
      "@kilnai/core",
      "@kilnai/tools-linux-x64",
      "@kilnai/tools-win32-x64",
      "@kilnai/tools",
      "@kilnai/cli",
    ]);
    expect(plan.packages.find((pkg) => pkg.name === "@kilnai/tools-linux-x64")).toMatchObject({
      os: ["linux"],
      cpu: ["x64"],
    });
  });

  it("fails closed for a split cohort, missing internal dependency, or cycle", () => {
    expect(() =>
      buildReleasePlan(
        [packageRecord("@kilnai/a"), packageRecord("@kilnai/b", {}, { version: "2.1.0" })],
        parseReleaseRef("v2.2.0-beta.1"),
      ),
    ).toThrow(/cohort/);

    expect(() =>
      buildReleasePlan(
        [packageRecord("@kilnai/a", { "@kilnai/missing": "2.2.0-beta.1" })],
        parseReleaseRef("v2.2.0-beta.1"),
      ),
    ).toThrow(/missing/);

    expect(() =>
      buildReleasePlan(
        [
          packageRecord("@kilnai/a", { "@kilnai/b": "2.2.0-beta.1" }),
          packageRecord("@kilnai/b", { "@kilnai/a": "2.2.0-beta.1" }),
        ],
        parseReleaseRef("v2.2.0-beta.1"),
      ),
    ).toThrow(/cycle/);
  });

  it("requires public npm metadata and exact source dependency versions in every section", () => {
    expect(() =>
      buildReleasePlan(
        [packageRecord("@kilnai/a", {}, { publishConfig: undefined })],
        parseReleaseRef("v2.2.0-beta.1"),
      ),
    ).toThrow(/publishConfig/);

    for (const section of ["dependencies", "peerDependencies", "optionalDependencies", "devDependencies"] as const) {
      expect(() =>
        buildReleasePlan(
          [packageRecord("@kilnai/a", {}, { [section]: { "@kilnai/b": "^2.2.0" } }), packageRecord("@kilnai/b")],
          parseReleaseRef("v2.2.0-beta.1"),
        ),
      ).toThrow(new RegExp(section));
    }
  });

  it("keeps the static GUI tarball free of runtime dependencies", () => {
    expect(() =>
      buildReleasePlan([packageRecord("@kilnai/gui", { react: "^19.0.0" })], parseReleaseRef("v2.2.0-beta.1")),
    ).toThrow(/static.*dependencies/i);
  });

  it("rejects a bare tsc build that can retain stale published output", () => {
    expect(() =>
      buildReleasePlan(
        [packageRecord("@kilnai/a", {}, { scripts: { build: "tsc" } })],
        parseReleaseRef("v2.2.0-beta.1"),
      ),
    ).toThrow(/cleaned before tsc/);
  });
});

describe("buildWorkspaceOrder", () => {
  it("orders public and private builds through runtime and dev dependency edges", () => {
    const records = [
      packageRecord(
        "@kilnai/private-surface",
        { "@kilnai/react": "2.2.0-beta.1" },
        {
          private: true,
          scripts: { build: "vite build" },
        },
      ),
      packageRecord(
        "@kilnai/react",
        {},
        {
          scripts: { build: "tsc" },
          devDependencies: { "@kilnai/gateway-contracts": "2.2.0-beta.1" },
        },
      ),
      packageRecord(
        "@kilnai/gateway-contracts",
        {},
        {
          scripts: { build: "tsc" },
        },
      ),
    ];

    expect(buildWorkspaceOrder(records).map(({ name }) => name)).toEqual([
      "@kilnai/gateway-contracts",
      "@kilnai/react",
      "@kilnai/private-surface",
    ]);
  });
});

describe("prepareStaging", () => {
  it("copies exact source manifests, injects legal files, and does not mutate sources", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-release-"));
    const packagesRoot = join(root, "packages");
    const stageRoot = join(root, "stage");
    await mkdir(join(packagesRoot, "a", "dist"), { recursive: true });
    await mkdir(join(packagesRoot, "b", "dist"), { recursive: true });
    await writeFile(join(root, "LICENSE"), "license-text");
    await writeFile(join(root, "NOTICE"), "notice-text");
    await writeFile(join(packagesRoot, "a", "THIRD_PARTY_NOTICES.md"), "third-party-text");
    const sourceA = {
      name: "@kilnai/a",
      version: "2.2.0-beta.1",
      files: ["dist"],
      publishConfig: { access: "public" },
      dependencies: { "@kilnai/b": "2.2.0-beta.1" },
      peerDependencies: { "@kilnai/b": "2.2.0-beta.1" },
      devDependencies: { "@kilnai/b": "2.2.0-beta.1" },
    };
    await writeFile(join(packagesRoot, "a", "package.json"), JSON.stringify(sourceA));
    await writeFile(
      join(packagesRoot, "b", "package.json"),
      JSON.stringify({
        name: "@kilnai/b",
        version: "2.2.0-beta.1",
        files: ["dist"],
        publishConfig: { access: "public" },
      }),
    );
    const records = [
      { directory: "a", manifestPath: join(packagesRoot, "a", "package.json"), manifest: sourceA },
      {
        directory: "b",
        manifestPath: join(packagesRoot, "b", "package.json"),
        manifest: {
          name: "@kilnai/b",
          version: "2.2.0-beta.1",
          files: ["dist"],
          publishConfig: { access: "public" },
        },
      },
    ] satisfies PackageRecord[];

    const plan = buildReleasePlan(records, parseReleaseRef("v2.2.0-beta.1"));
    await prepareStaging(plan, packagesRoot, stageRoot);

    const staged = JSON.parse(await readFile(join(stageRoot, "a", "package.json"), "utf8"));
    expect(staged.dependencies["@kilnai/b"]).toBe("2.2.0-beta.1");
    expect(staged.peerDependencies["@kilnai/b"]).toBe("2.2.0-beta.1");
    expect(staged.devDependencies["@kilnai/b"]).toBe("2.2.0-beta.1");
    expect(staged.files).toEqual(["dist", "LICENSE", "NOTICE"]);
    expect(await readFile(join(stageRoot, "a", "LICENSE"), "utf8")).toBe("license-text");
    expect(await readFile(join(stageRoot, "a", "NOTICE"), "utf8")).toBe("notice-text");
    expect(await readFile(join(stageRoot, "a", "THIRD_PARTY_NOTICES.md"), "utf8")).toBe("third-party-text");
    expect(JSON.parse(await readFile(join(packagesRoot, "a", "package.json"), "utf8"))).toEqual(sourceA);
  });
});

describe("validateRegistryState", () => {
  const local = { name: "@kilnai/core", version: "2.2.0-beta.1", integrity: "sha512-local" };

  it("allows absence and integrity-matching retries", () => {
    expect(validateRegistryState(local, { versionIntegrity: null, channelVersion: "2.1.0" }, "beta")).toBe("publish");
    expect(
      validateRegistryState(local, { versionIntegrity: "sha512-local", channelVersion: "2.2.0-beta.1" }, "beta"),
    ).toBe("skip");
  });

  it("fails for mismatched existing content or channel rollback", () => {
    expect(() =>
      validateRegistryState(local, { versionIntegrity: "sha512-other", channelVersion: null }, "beta"),
    ).toThrow(/integrity/);
    expect(() =>
      validateRegistryState(local, { versionIntegrity: null, channelVersion: "2.3.0-beta.1" }, "beta"),
    ).toThrow(/rollback/);
  });
});

describe("release bundle", () => {
  it("computes npm-compatible integrity and requires one tarball per planned package", async () => {
    const root = await mkdtemp(join(tmpdir(), "kiln-release-bundle-"));
    const tarball = join(root, "kilnai-core-2.2.0-beta.1.tgz");
    await writeFile(tarball, "fixture");
    expect(await calculateIntegrity(tarball)).toBe(
      "sha512-lOlQ7aSocOZWXUThS5DxbAo4HNaTBFKcgfa9QIrxPFFVFrhBfgBfwxCT+qSxPekkNkVt0lKJqyhnw6V2+pSESQ==",
    );

    const plan = buildReleasePlan([packageRecord("@kilnai/core")], parseReleaseRef("v2.2.0-beta.1"));
    expect(() =>
      assertCompleteBundle(plan, [
        {
          name: "@kilnai/core",
          version: "2.2.0-beta.1",
          integrity: "sha512-local",
          filename: "kilnai-core-2.2.0-beta.1.tgz",
        },
      ]),
    ).not.toThrow();
    expect(() => assertCompleteBundle(plan, [])).toThrow(/complete/);
  });

  it("requires LICENSE and NOTICE in every tarball and keeps platform third-party notices", () => {
    expect(() =>
      assertPackedLegalFiles({ name: "@kilnai/core", directory: "core", version: "2.2.0-beta.1" }, [
        "dist/index.js",
        "package.json",
        "LICENSE",
        "NOTICE",
      ]),
    ).not.toThrow();
    expect(() =>
      assertPackedLegalFiles(
        {
          name: "@kilnai/tools-linux-x64",
          directory: "tools-linux-x64",
          version: "2.2.0-beta.1",
          os: ["linux"],
          cpu: ["x64"],
        },
        ["bin/rg", "package.json", "LICENSE", "NOTICE"],
      ),
    ).toThrow(/THIRD_PARTY_NOTICES/);
    expect(() =>
      assertPackedLegalFiles({ name: "@kilnai/core", directory: "core", version: "2.2.0-beta.1" }, [
        "dist/index.js",
        "package.json",
        "LICENSE",
      ]),
    ).toThrow(/NOTICE/);
    expect(() =>
      assertPackedLegalFiles({ name: "@kilnai/core", directory: "core", version: "2.2.0-beta.1" }, [
        "dist/index.js",
        "package.json",
        "LICENSE",
        "NOTICE",
        ".kiln-private/case.json",
      ]),
    ).toThrow(/private workflow material/);
    expect(() =>
      assertPackedLegalFiles({ name: "@kilnai/core", directory: "core", version: "2.2.0-beta.1" }, [
        "dist/index.js",
        "package.json",
        "LICENSE",
        "NOTICE",
        "HANDOFF-formal-verification.md",
      ]),
    ).toThrow(/private workflow material/);
  });

  it("installs the full portable cohort plus only the host-compatible platform tarball", () => {
    const plan = buildReleasePlan(
      [
        packageRecord("@kilnai/tools", {
          "@kilnai/tools-linux-x64": "2.2.0-beta.1",
          "@kilnai/tools-win32-x64": "2.2.0-beta.1",
        }),
        packageRecord("@kilnai/tools-linux-x64", {}, { os: ["linux"], cpu: ["x64"] }),
        packageRecord("@kilnai/tools-win32-x64", {}, { os: ["win32"], cpu: ["x64"] }),
      ],
      parseReleaseRef("v2.2.0-beta.1"),
    );
    const tarballs = plan.packages.map((pkg) => ({
      name: pkg.name,
      version: pkg.version,
      integrity: "sha512-local",
      filename: `${pkg.directory}.tgz`,
    }));

    expect(selectInstallTarballs(plan, tarballs, "linux", "x64").map((tarball) => tarball.name)).toEqual([
      "@kilnai/tools-linux-x64",
      "@kilnai/tools",
    ]);
  });

  it("accepts a successful exit or the signal deliberately used for smoke shutdown", () => {
    expect(isCleanSmokeTermination({ code: 0, signal: null })).toBe(true);
    expect(isCleanSmokeTermination({ code: null, signal: "SIGTERM" })).toBe(true);
    expect(isCleanSmokeTermination({ code: 1, signal: null })).toBe(false);
    expect(isCleanSmokeTermination({ code: null, signal: "SIGKILL" })).toBe(false);
  });
});
