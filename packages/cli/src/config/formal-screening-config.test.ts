import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { KilnGlobalConfig } from "./global-config.js";
import { resolveFormalScreeningConfig } from "./formal-screening-config.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveFormalScreeningConfig", () => {
  it("resolves only exact operator-owned files", () => {
    const fixture = createFixture();

    expect(resolveFormalScreeningConfig(configFor(fixture))).toEqual({
      privatePackagePath: fixture.privatePackage,
      lemmaScriptPackageRoot: fixture.lemmaRoot,
      lscScriptPath: fixture.entrypoint,
      expectedLemmaScriptVersion: "0.6.0",
      dafnyExecutable: fixture.dafny,
      expectedDafnyVersion: "4.11.0",
    });
  });

  it("fails closed when screening is not configured", () => {
    expect(() => resolveFormalScreeningConfig({ version: "6" })).toThrow(
      "Formal screening requires global verification.formal.screening configuration.",
    );
  });

  it("rejects an entrypoint outside the declared LemmaScript package", () => {
    const fixture = createFixture();
    const outside = join(fixture.root, "outside.js");
    writeFileSync(outside, "export {};", "utf8");

    expect(() => resolveFormalScreeningConfig(configFor({ ...fixture, entrypoint: outside }))).toThrow(
      "LemmaScript entrypoint must be contained by its configured package root.",
    );
  });

  it("rejects symbolic toolchain paths", () => {
    const fixture = createFixture();
    const link = join(fixture.root, "dafny-link");
    symlinkSync(fixture.dafny, link, "file");

    expect(() => resolveFormalScreeningConfig(configFor({ ...fixture, dafny: link }))).toThrow(
      "Configured Dafny executable must be a regular non-symbolic file.",
    );
  });
});

function createFixture(): {
  readonly root: string;
  readonly privatePackage: string;
  readonly lemmaRoot: string;
  readonly entrypoint: string;
  readonly dafny: string;
} {
  const root = mkdtempSync(join(tmpdir(), "kiln-formal-screening-config-"));
  roots.push(root);
  const privatePackage = join(root, "private-package");
  const lemmaRoot = join(root, "lemmascript");
  const entrypoint = join(lemmaRoot, "tools", "dist", "lsc.js");
  const dafny = join(root, "dafny");
  mkdirSync(privatePackage, { recursive: true });
  mkdirSync(join(lemmaRoot, "tools", "dist"), { recursive: true });
  writeFileSync(entrypoint, "export {};", "utf8");
  writeFileSync(dafny, "dafny", "utf8");
  return { root, privatePackage, lemmaRoot, entrypoint, dafny };
}

function configFor(fixture: ReturnType<typeof createFixture>): KilnGlobalConfig {
  return {
    version: "6",
    verification: {
      formal: {
        dafny: {
          executable: fixture.dafny,
          installationRoot: fixture.root,
          expectedVersion: "4.11.0",
          expectedInstallationDigest: `sha256:${createHash("sha256").update("dafny installation").digest("hex")}`,
        },
        screening: {
          packagePath: fixture.privatePackage,
          lemmaScript: {
            packageRoot: fixture.lemmaRoot,
            entrypoint: fixture.entrypoint,
            expectedVersion: "0.6.0",
          },
        },
      },
    },
  };
}
