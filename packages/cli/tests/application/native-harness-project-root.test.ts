import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNativeHarnessProjectRoot } from "../../src/application/native-harness-project-root.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveNativeHarnessProjectRoot", () => {
  it("accepts an explicit ordinary project root without a repository-local marker", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-harness-project-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-application" }), "utf8");

    expect(resolveNativeHarnessProjectRoot(root)).toEqual({ status: "resolved", rootPath: root });
  });

  it("fails closed when the explicit project root does not exist", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-harness-no-project-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-application" }), "utf8");

    expect(resolveNativeHarnessProjectRoot(join(root, "missing"))).toEqual({ status: "missing" });
  });
});
