import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  hashBenchmarkWorkspace,
  resolveBenchmarkWorkspace,
  verifyBenchmarkWorkspaceUnchanged,
} from "../../src/application/benchmark-workspace.js";

const temporaryRoots: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-benchmark-workspace-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "fixtures", "roster"), { recursive: true });
  writeFileSync(join(root, "fixtures", "roster", "README.md"), "fixture\n", "utf-8");
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("benchmark workspace isolation", () => {
  it("resolves a portable fixture contained by the repository", () => {
    const root = createRepository();

    expect(resolveBenchmarkWorkspace(root, "fixtures/roster")).toMatchObject({
      kind: "synthetic-fixture",
      fixturePath: "fixtures/roster",
    });
  });

  it.each([
    "../outside",
    "fixtures/../roster",
    "C:\\outside",
    "/outside",
  ])("rejects non-portable fixture path %s", (fixturePath) => {
    const root = createRepository();

    expect(() => resolveBenchmarkWorkspace(root, fixturePath)).toThrow(/workspace fixture/iu);
  });

  it("rejects a fixture containing a symbolic link", () => {
    const root = createRepository();
    const outside = join(root, "outside.txt");
    writeFileSync(outside, "outside\n", "utf-8");
    symlinkSync(outside, join(root, "fixtures", "roster", "escape.txt"), "file");

    expect(() => resolveBenchmarkWorkspace(root, "fixtures/roster")).toThrow(/symbolic link/iu);
  });

  it("hashes sorted fixture contents and changes when content changes", () => {
    const root = createRepository();
    const workspace = resolveBenchmarkWorkspace(root, "fixtures/roster");
    const first = hashBenchmarkWorkspace(workspace);

    writeFileSync(join(root, "fixtures", "roster", "README.md"), "changed\n", "utf-8");

    expect(hashBenchmarkWorkspace(resolveBenchmarkWorkspace(root, "fixtures/roster"))).not.toBe(first);
    expect(first).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails post-run verification when fixture bytes changed", () => {
    const root = createRepository();
    const workspace = resolveBenchmarkWorkspace(root, "fixtures/roster");
    const expectedHash = hashBenchmarkWorkspace(workspace);
    writeFileSync(join(root, "fixtures", "roster", "README.md"), "changed during run\n", "utf-8");

    expect(() => verifyBenchmarkWorkspaceUnchanged(root, workspace, expectedHash))
      .toThrow(/changed during benchmark execution/iu);
  });
});
