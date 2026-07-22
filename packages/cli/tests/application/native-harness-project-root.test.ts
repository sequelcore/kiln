import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveNativeHarnessProjectRoot } from "../../src/application/native-harness-project-root.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("resolveNativeHarnessProjectRoot", () => {
  it("accepts an explicit ordinary project root with canonical kiln.yaml without requiring Kiln's own package identity", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-harness-project-"));
    roots.push(root);
    mkdirSync(join(root, ".kiln"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), 'version: "1"\nname: fixture-application\n', "utf8");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-application" }), "utf8");

    expect(resolveNativeHarnessProjectRoot(root)).toEqual({ status: "resolved", rootPath: root });
  });

  it("fails closed when the explicit project root has no canonical kiln.yaml", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-native-harness-no-project-"));
    roots.push(root);
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-application" }), "utf8");

    expect(resolveNativeHarnessProjectRoot(root)).toEqual({ status: "missing" });
  });
});
