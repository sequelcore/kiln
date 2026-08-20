import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const PACKAGES_ROOT = resolve(REPOSITORY_ROOT, "packages");

interface ContextualPackage {
  readonly name: string;
  readonly contexts: readonly string[];
}

/**
 * A workspace package is "contextual" once it publishes bounded-context
 * subpaths: export entries backed by a directory barrel at
 * `src/<context>/index.ts`. Module-level subpaths that expose a single file do
 * not decompose a package and are excluded. Deriving the rule from the exports
 * map keeps this test correct as packages gain contexts, with no list to
 * maintain.
 */
function listContextualPackages(): readonly ContextualPackage[] {
  return readdirSync(PACKAGES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const manifestPath = resolve(PACKAGES_ROOT, entry.name, "package.json");
      if (!existsSync(manifestPath)) return [];
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name?: string;
        exports?: Record<string, unknown>;
      };
      const contexts = Object.keys(manifest.exports ?? {})
        .filter((subpath) => subpath.startsWith("./"))
        .map((subpath) => subpath.slice(2))
        .filter((context) => (
          existsSync(resolve(PACKAGES_ROOT, entry.name, "src", context, "index.ts"))
        ));
      return manifest.name && contexts.length > 0
        ? [{ name: manifest.name, contexts }]
        : [];
    });
}

function listTrackedTestFiles(): readonly string[] {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--", "packages/*.test.ts", "packages/*.test.tsx"],
    { cwd: REPOSITORY_ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return output
    .split("\0")
    .filter(Boolean)
    .filter((file) => existsSync(resolve(REPOSITORY_ROOT, file)));
}

function rootBarrelSpecifier(packageName: string): RegExp {
  return new RegExp(`from\\s*"${packageName.replaceAll("/", "\\/")}"`, "u");
}

describe("workspace import boundaries", () => {
  it("publishes bounded-context subpaths for at least one workspace package", () => {
    expect(listContextualPackages().map((entry) => entry.name)).toContain("@kilnai/core");
  });

  it.each(listContextualPackages().map((entry) => [entry.name, entry] as const))(
    "publishes every %s bounded context through the exports map",
    (_name, entry) => {
      const source = resolve(PACKAGES_ROOT, entry.name.replace("@kilnai/", ""), "src");
      const published = new Set(entry.contexts);
      const unpublished = readdirSync(source, { withFileTypes: true })
        .filter((candidate) => (
          candidate.isDirectory()
          && existsSync(resolve(source, candidate.name, "index.ts"))
          && !published.has(candidate.name)
        ))
        .map((candidate) => candidate.name);

      expect(
        unpublished,
        "A context barrel that is not in the exports map is unreachable by consumers",
      ).toEqual([]);
    },
  );

  it("imports contextual packages through a bounded context, never the root barrel", () => {
    const contextual = listContextualPackages();
    const testFiles = listTrackedTestFiles();

    const violations = testFiles.flatMap((file) => {
      const content = readFileSync(resolve(REPOSITORY_ROOT, file), "utf8");
      return contextual
        .filter((entry) => rootBarrelSpecifier(entry.name).test(content))
        .map((entry) => `${relative(REPOSITORY_ROOT, file).replaceAll("\\", "/")} imports ${entry.name}`);
    });

    expect(
      violations,
      "A test names the bounded context it exercises. Import @kilnai/core/<context> "
        + "instead of the root barrel: the root barrel re-exports every context and "
        + "costs seconds of module-graph instantiation per test file.",
    ).toEqual([]);
  });
});
