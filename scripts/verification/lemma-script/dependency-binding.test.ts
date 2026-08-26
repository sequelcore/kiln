import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LEMMA_SCRIPT_ALLOWED_COMMANDS,
  type LemmaScriptDependencyBindingInput,
  observeLemmaScriptDependencyBinding,
} from "./dependency-binding.js";

const temporaryRoots: string[] = [];
const TEST_PARENT = resolve(import.meta.dirname, "../../../..");

interface FixtureOptions {
  readonly rootParent?: string;
  readonly rootDependencyVersion?: string;
  readonly rootPackageVersion?: string;
  readonly includeShadow?: boolean;
  readonly includeIntegrity?: boolean;
  readonly includeDevPackage?: boolean;
  readonly includeNonDevUnbound?: boolean;
}

interface Fixture {
  readonly root: string;
  readonly input: LemmaScriptDependencyBindingInput;
  readonly paths: {
    readonly lsc: string;
    readonly runtime: string;
    readonly runtimeExecutable: string;
    readonly shadow: string;
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFixture(options: FixtureOptions = {}): Fixture {
  const parent = options.rootParent ?? mkdtempSync(join(TEST_PARENT, ".lemma-binding-parent-"));
  if (options.rootParent === undefined) temporaryRoots.push(parent);
  const root = mkdtempSync(join(parent, "lemma-binding-"));
  temporaryRoots.push(root);
  const lsc = join(root, "tools", "dist", "lsc.js");
  const runtime = join(root, "node_modules", "runtime-dependency", "index.js");
  const runtimeExecutable = join(root, "runtime-executable.bin");
  const shadow = join(root, "tools", "node_modules", "lemmascript", "index.js");
  mkdirSync(join(root, "tools", "dist"), { recursive: true });
  mkdirSync(join(root, "node_modules", "lemmascript"), { recursive: true });
  mkdirSync(join(root, "node_modules", "runtime-dependency"), { recursive: true });
  writeFileSync(lsc, "export default 'lsc-0.6.0';\n", "utf8");
  writeFileSync(runtimeExecutable, "bun runtime fixture bytes\n", "utf8");
  writeFileSync(
    join(root, "node_modules", "lemmascript", "package.json"),
    '{"name":"lemmascript","version":"0.6.0"}\n',
    "utf8",
  );
  writeFileSync(join(root, "node_modules", "lemmascript", "index.js"), "export const version = '0.6.0';\n", "utf8");
  writeFileSync(runtime, "export const runtime = true;\n", "utf8");
  writeFileSync(
    join(root, "node_modules", "runtime-dependency", "package.json"),
    '{"name":"runtime-dependency","version":"1.0.0"}\n',
    "utf8",
  );

  if (options.includeShadow !== false) {
    mkdirSync(join(root, "tools", "node_modules", "lemmascript"), { recursive: true });
    writeFileSync(shadow, "export const version = '0.5.9';\n", "utf8");
    writeFileSync(
      join(root, "tools", "node_modules", "lemmascript", "package.json"),
      '{"name":"lemmascript","version":"0.5.9"}\n',
      "utf8",
    );
  }

  if (options.includeDevPackage === true) {
    mkdirSync(join(root, "node_modules", "dev-only"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "dev-only", "package.json"),
      '{"name":"dev-only","version":"9.9.9"}\n',
      "utf8",
    );
  }

  if (options.includeNonDevUnbound === true) {
    mkdirSync(join(root, "node_modules", "unbound-runtime"), { recursive: true });
    writeFileSync(
      join(root, "node_modules", "unbound-runtime", "package.json"),
      '{"name":"unbound-runtime","version":"2.0.0"}\n',
      "utf8",
    );
  }

  const integrity = options.includeIntegrity === false ? undefined : "sha512-declared-but-not-an-identity";
  const rootPackage = {
    name: "lemma-host",
    version: options.rootPackageVersion ?? "1.0.0",
    bin: { lsc: "tools/dist/lsc.js" },
    dependencies: { lemmascript: options.rootDependencyVersion ?? "0.6.0", "runtime-dependency": "1.0.0" },
  };
  const rootLock = {
    name: "lemma-host",
    version: rootPackage.version,
    lockfileVersion: 3,
    packages: {
      "": { name: "lemma-host", version: rootPackage.version, dependencies: rootPackage.dependencies },
      "node_modules/lemmascript": {
        version: "0.6.0",
        ...(integrity === undefined ? {} : { integrity }),
        dependencies: {},
      },
      "node_modules/runtime-dependency": { version: "1.0.0", dependencies: {} },
      ...(options.includeDevPackage === true ? { "node_modules/dev-only": { version: "9.9.9", dev: true } } : {}),
      ...(options.includeNonDevUnbound === true ? { "node_modules/unbound-runtime": { version: "2.0.0" } } : {}),
    },
  };
  writeFileSync(join(root, "package.json"), `${JSON.stringify(rootPackage)}\n`, "utf8");
  writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(rootLock)}\n`, "utf8");

  const toolsLock = {
    name: "lemma-tools",
    version: "1.0.0",
    lockfileVersion: 3,
    packages: {
      "":
        options.includeShadow === false
          ? { name: "lemma-tools", version: "1.0.0" }
          : { name: "lemma-tools", version: "1.0.0", dependencies: { lemmascript: "0.5.9" } },
      ...(options.includeShadow === false
        ? {}
        : { "node_modules/lemmascript": { version: "0.5.9", dependencies: {} } }),
    },
  };
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(join(root, "tools", "package-lock.json"), `${JSON.stringify(toolsLock)}\n`, "utf8");

  return {
    root,
    paths: { lsc, runtime, runtimeExecutable, shadow },
    input: {
      packageRoot: root,
      entrypointPath: lsc,
      spawnCwd: root,
      runtimeExecutablePath: runtimeExecutable,
      environment: { PATH: "portable", HOME: "portable" },
      commandProfile: { allowedCommands: [...LEMMA_SCRIPT_ALLOWED_COMMANDS] },
    },
  };
}

function invalidCodes(result: Awaited<ReturnType<typeof observeLemmaScriptDependencyBinding>>): readonly string[] {
  return result.status === "invalid" ? result.rejectionCodes : [];
}

describe("observeLemmaScriptDependencyBinding", () => {
  it("observes a deterministic portable manifest for the union lock closure", async () => {
    const fixture = createFixture();
    const first = await observeLemmaScriptDependencyBinding(fixture.input);
    const second = await observeLemmaScriptDependencyBinding(fixture.input);

    expect(first.status).toBe("valid");
    expect(second).toEqual(first);
    if (first.status !== "valid") return;
    expect(first.facts.schema).toBe("kiln.lemma-script-dependency-binding/v1");
    expect(first.facts.digest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(first.facts.runtime).toEqual({
      role: "bun",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
      byteLength: "bun runtime fixture bytes\n".length,
    });
    expect(first.facts.manifest.length).toBeGreaterThan(4);
    expect(first.facts.manifest.every((entry) => !entry.path.includes("\\") && !entry.path.startsWith("/"))).toBe(true);
    expect(first.facts.manifest.map((entry) => entry.path)).toContain("package.json");
    expect(first.facts.manifest.map((entry) => entry.path)).toContain("package-lock.json");
    expect(first.facts.manifest.map((entry) => entry.path)).toContain("tools/package-lock.json");
    expect(first.facts.manifest.map((entry) => entry.path)).toContain("tools/dist/lsc.js");
    expect(first.facts.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "node_modules/lemmascript", name: "lemmascript", version: "0.6.0" }),
        expect.objectContaining({ path: "tools/node_modules/lemmascript", name: "lemmascript", version: "0.5.9" }),
      ]),
    );
    expect(JSON.stringify(first)).not.toContain(fixture.root);
  });

  it("changes identity when tools/dist or a transitive package file changes", async () => {
    const fixture = createFixture();
    const before = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(before.status).toBe("valid");
    writeFileSync(fixture.paths.lsc, "export default 'lsc-mutated';\n", "utf8");
    const afterToolMutation = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(afterToolMutation.status).toBe("valid");
    if (before.status !== "valid" || afterToolMutation.status !== "valid") return;
    expect(afterToolMutation.facts.digest).not.toBe(before.facts.digest);
    writeFileSync(fixture.paths.runtime, "export const runtime = false;\n", "utf8");
    const afterDependencyMutation = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(afterDependencyMutation.status).toBe("valid");
    if (afterDependencyMutation.status === "valid")
      expect(afterDependencyMutation.facts.digest).not.toBe(afterToolMutation.facts.digest);
  });

  it("uses observed bytes even when a lock integrity field remains unchanged", async () => {
    const fixture = createFixture();
    const before = await observeLemmaScriptDependencyBinding(fixture.input);
    writeFileSync(
      join(fixture.root, "node_modules", "lemmascript", "index.js"),
      "mutated despite declared integrity\n",
      "utf8",
    );
    const after = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(before.status).toBe("valid");
    expect(after.status).toBe("valid");
    if (before.status === "valid" && after.status === "valid") expect(after.facts.digest).not.toBe(before.facts.digest);
  });

  it("rehashes the runtime executable at each endpoint observation", async () => {
    const fixture = createFixture();
    const before = await observeLemmaScriptDependencyBinding(fixture.input);
    writeFileSync(fixture.paths.runtimeExecutable, "bun runtime fixture bytes changed\n", "utf8");
    const after = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(before.status).toBe("valid");
    expect(after.status).toBe("valid");
    if (before.status === "valid" && after.status === "valid") {
      expect(after.facts.runtime.digest).not.toBe(before.facts.runtime.digest);
      expect(after.facts.digest).not.toBe(before.facts.digest);
    }
  });

  it("resolves the nearest lock location without interpreting compound npm ranges", async () => {
    const fixture = createFixture({ rootDependencyVersion: ">=0.5 <1" });
    const result = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.facts.packages).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: "node_modules/lemmascript", version: "0.6.0" })]),
      );
    }
  });

  it("fails closed for missing, unlocked, or version-mismatched packages", async () => {
    const missing = createFixture();
    rmSync(join(missing.root, "node_modules", "runtime-dependency"), { recursive: true, force: true });
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(missing.input))).toContain("missing-package");

    const unlocked = createFixture();
    mkdirSync(join(unlocked.root, "node_modules", "unlocked"), { recursive: true });
    writeFileSync(
      join(unlocked.root, "node_modules", "unlocked", "package.json"),
      '{"name":"unlocked","version":"1.0.0"}\n',
      "utf8",
    );
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(unlocked.input))).toContain(
      "installed-package-absent-from-lock",
    );

    const mismatch = createFixture();
    writeFileSync(
      join(mismatch.root, "node_modules", "lemmascript", "package.json"),
      '{"name":"lemmascript","version":"0.5.9"}\n',
      "utf8",
    );
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(mismatch.input))).toContain(
      "package-version-mismatch",
    );
  });

  it("rejects commands outside the narrow LemmaScript profile", async () => {
    const fixture = createFixture();
    const result = await observeLemmaScriptDependencyBinding({
      ...fixture.input,
      commandProfile: { allowedCommands: ["version", "shell"] },
    });
    expect(invalidCodes(result)).toContain("unsupported-command");
  });

  it.each([
    ["NODE_OPTIONS", "node-options"],
    ["NODE_PATH", "node-path"],
    ["BUN_INSTALL", "bun-environment"],
    ["BUN_RUNTIME_TRANSPILER_CACHE_PATH", "bun-environment"],
  ] as const)("rejects environment influence from %s", async (key, expectedCode) => {
    const fixture = createFixture();
    const result = await observeLemmaScriptDependencyBinding({
      ...fixture.input,
      environment: { ...fixture.input.environment, [key]: "influence" },
    });
    expect(invalidCodes(result)).toContain(expectedCode);
  });

  it("rejects runtime ancestors and cwd that can inject resolution state", async () => {
    const fixture = createFixture();
    const cwdOutside = createFixture();
    const outside = mkdtempSync(join(TEST_PARENT, ".lemma-binding-cwd-"));
    temporaryRoots.push(outside);
    expect(
      invalidCodes(await observeLemmaScriptDependencyBinding({ ...cwdOutside.input, spawnCwd: outside })),
    ).toContain("spawn-cwd-outside-root");

    const nestedInNodeModulesParent = mkdtempSync(join(TEST_PARENT, ".lemma-binding-node-modules-parent-"));
    temporaryRoots.push(nestedInNodeModulesParent);
    const nodeModules = join(nestedInNodeModulesParent, "node_modules");
    mkdirSync(nodeModules, { recursive: true });
    const nested = createFixture({ rootParent: nodeModules });
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(nested.input))).toContain("ancestor-node-modules");
  });

  it("rejects an ancestor node_modules marker even when the root is not inside it", async () => {
    const fixture = createFixture();
    mkdirSync(join(fixture.root, "..", "node_modules"), { recursive: true });
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(fixture.input))).toContain("ancestor-node-modules");
  });

  it("ignores installed lock-known dev packages outside the runtime closure", async () => {
    const fixture = createFixture({ includeDevPackage: true });
    const result = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.facts.manifest.map((entry) => entry.path)).not.toContain("node_modules/dev-only/package.json");
    }
  });

  it("rejects installed lock-known non-dev packages outside the runtime closure", async () => {
    const fixture = createFixture({ includeNonDevUnbound: true });
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(fixture.input))).toContain(
      "installed-package-outside-closure",
    );
  });

  it("rejects symlinked entrypoints and supports a Windows junction regression when available", async () => {
    const fixture = createFixture();
    const outside = mkdtempSync(join(TEST_PARENT, ".lemma-binding-outside-"));
    temporaryRoots.push(outside);
    const target = join(outside, "lsc.js");
    writeFileSync(target, "outside\n", "utf8");
    rmSync(fixture.paths.lsc);
    symlinkSync(target, fixture.paths.lsc, "file");
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(fixture.input))).toContain("symlink");

    if (process.platform === "win32") {
      const junctionFixture = createFixture();
      const junctionTarget = join(outside, "junction-target");
      mkdirSync(junctionTarget, { recursive: true });
      rmSync(join(junctionFixture.root, "tools", "dist"), { recursive: true, force: true });
      symlinkSync(junctionTarget, join(junctionFixture.root, "tools", "dist"), "junction");
      expect(invalidCodes(await observeLemmaScriptDependencyBinding(junctionFixture.input))).toEqual(
        expect.arrayContaining(["junction", "realpath-escape"]),
      );
    }
  });

  it("rejects missing or symlinked runtime executables", async () => {
    const missing = createFixture();
    expect(
      invalidCodes(
        await observeLemmaScriptDependencyBinding({
          ...missing.input,
          runtimeExecutablePath: join(missing.root, "missing-runtime.bin"),
        }),
      ),
    ).toContain("runtime-executable-missing");

    const symlinked = createFixture();
    const target = join(symlinked.root, "runtime-target.bin");
    writeFileSync(target, "runtime target\n", "utf8");
    rmSync(symlinked.paths.runtimeExecutable);
    symlinkSync(target, symlinked.paths.runtimeExecutable, "file");
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(symlinked.input))).toContain("symlink");
  });

  it("rejects absolute/relative path contract violations and caller-provided identity", async () => {
    const fixture = createFixture();
    expect(
      invalidCodes(await observeLemmaScriptDependencyBinding({ ...fixture.input, packageRoot: "relative-root" })),
    ).toContain("absolute-path");
    expect(
      invalidCodes(await observeLemmaScriptDependencyBinding({ ...fixture.input, spawnCwd: "relative-cwd" })),
    ).toContain("absolute-path");
    const callerIdentity = await observeLemmaScriptDependencyBinding({
      ...fixture.input,
      digest: "sha256:caller",
    } as unknown);
    expect(invalidCodes(callerIdentity)).toContain("caller-supplied-identity");
    const callerRuntimeIdentity = await observeLemmaScriptDependencyBinding({
      ...fixture.input,
      runtimeDigest: "sha256:caller",
    } as unknown);
    expect(invalidCodes(callerRuntimeIdentity)).toContain("caller-supplied-identity");
  });

  it("distinguishes structurally different trees despite identical file bytes", async () => {
    const first = createFixture();
    const second = createFixture();
    writeFileSync(join(second.root, "tools", "dist", "extra.js"), readFileSync(first.paths.lsc));
    const firstResult = await observeLemmaScriptDependencyBinding(first.input);
    const secondResult = await observeLemmaScriptDependencyBinding(second.input);
    expect(firstResult.status).toBe("valid");
    expect(secondResult.status).toBe("valid");
    if (firstResult.status === "valid" && secondResult.status === "valid") {
      expect(secondResult.facts.digest).not.toBe(firstResult.facts.digest);
    }
  });

  it("normalizes portable manifest paths and package strings to NFC", async () => {
    const fixture = createFixture();
    const decomposedFile = join(fixture.root, "tools", "dist", "e\u0301.js");
    writeFileSync(decomposedFile, "nfc-path\n", "utf8");
    const lockPath = join(fixture.root, "package-lock.json");
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as {
      packages: Record<string, Record<string, unknown>>;
    };
    lock.packages["node_modules/lemmascript"].integrity = "sha512-e\u0301";
    writeFileSync(lockPath, `${JSON.stringify(lock)}\n`, "utf8");

    const result = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.facts.manifest.map((entry) => entry.path)).toContain("tools/dist/é.js");
    expect(result.facts.manifest.map((entry) => entry.path)).not.toContain("tools/dist/e\u0301.js");
    expect(result.facts.packages).toEqual(expect.arrayContaining([expect.objectContaining({ integrity: "sha512-é" })]));
  });

  it("rejects distinct filesystem paths that normalize to one canonical path", async () => {
    const fixture = createFixture();
    const decomposedName = "e\u0301-collision.js";
    const composedName = "é-collision.js";
    const decomposedFile = join(fixture.root, "tools", "dist", decomposedName);
    const composedFile = join(fixture.root, "tools", "dist", composedName);
    writeFileSync(decomposedFile, "filesystem-path-a\n", "utf8");
    writeFileSync(composedFile, "filesystem-path-b\n", "utf8");
    if (readFileSync(decomposedFile, "utf8") !== "filesystem-path-a\n") return;
    if (readFileSync(composedFile, "utf8") !== "filesystem-path-b\n") return;
    writeFileSync(decomposedFile, "same-bytes\n", "utf8");
    writeFileSync(composedFile, "same-bytes\n", "utf8");

    expect(invalidCodes(await observeLemmaScriptDependencyBinding(fixture.input))).toContain(
      "canonical-path-collision",
    );
  });

  it("sorts canonical paths by UTF-8 byte order", async () => {
    const fixture = createFixture();
    const bmpName = "\uE000-byte-order.js";
    const supplementaryName = "\u{10000}-byte-order.js";
    writeFileSync(join(fixture.root, "tools", "dist", bmpName), "same\n", "utf8");
    writeFileSync(join(fixture.root, "tools", "dist", supplementaryName), "same\n", "utf8");

    const result = await observeLemmaScriptDependencyBinding(fixture.input);
    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    const unicodePaths = result.facts.manifest
      .map((entry) => entry.path)
      .filter((path) => path.endsWith("-byte-order.js"));
    expect(unicodePaths).toEqual(
      [...unicodePaths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
    );
    expect(unicodePaths).toEqual([`tools/dist/${bmpName}`, `tools/dist/${supplementaryName}`]);
  });

  it("requires the entrypoint to be tools/dist/lsc.js and to match root bin", async () => {
    const fixture = createFixture();
    const wrongEntrypoint = join(fixture.root, "tools", "dist", "other.js");
    writeFileSync(wrongEntrypoint, "other\n", "utf8");
    expect(
      invalidCodes(await observeLemmaScriptDependencyBinding({ ...fixture.input, entrypointPath: wrongEntrypoint })),
    ).toContain("entrypoint-bin-mismatch");
    const wrongBin = JSON.parse(readFileSync(join(fixture.root, "package.json"), "utf8")) as Record<string, unknown>;
    wrongBin.bin = { lsc: "tools/dist/other.js" };
    writeFileSync(join(fixture.root, "package.json"), `${JSON.stringify(wrongBin)}\n`, "utf8");
    expect(invalidCodes(await observeLemmaScriptDependencyBinding(fixture.input))).toContain("entrypoint-bin-mismatch");
  });

  it("does not mutate or invoke a package manager", async () => {
    const fixture = createFixture();
    const before = JSON.stringify({
      package: readFileSync(join(fixture.root, "package.json"), "utf8"),
      lock: readFileSync(join(fixture.root, "package-lock.json"), "utf8"),
    });
    const result = await observeLemmaScriptDependencyBinding(fixture.input);
    const after = JSON.stringify({
      package: readFileSync(join(fixture.root, "package.json"), "utf8"),
      lock: readFileSync(join(fixture.root, "package-lock.json"), "utf8"),
    });
    expect(result.status).toBe("valid");
    expect(after).toBe(before);
    expect(existsSync(join(fixture.root, "node_modules", ".bin"))).toBe(false);
  });
});
