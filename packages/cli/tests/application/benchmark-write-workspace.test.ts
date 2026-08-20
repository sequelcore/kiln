import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBenchmarkWriteWorkspaceLease,
} from "../../src/application/benchmark-write-workspace.js";

const temporaryRoots: string[] = [];

function createRepository(): string {
  const root = mkdtempSync(join(tmpdir(), "kiln-benchmark-write-workspace-test-"));
  temporaryRoots.push(root);
  const fixture = join(root, "fixtures", "write");
  mkdirSync(join(fixture, "src"), { recursive: true });
  writeFileSync(join(fixture, "README.md"), "canonical fixture\n", "utf-8");
  writeFileSync(join(fixture, "src", "task.ts"), "export const task = 1;\n", "utf-8");
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("benchmark write workspace lease", () => {
  it("copies a validated synthetic fixture into an isolated temporary workspace", () => {
    const repositoryRoot = createRepository();
    const lease = createBenchmarkWriteWorkspaceLease(repositoryRoot, "fixtures/write");

    expect(lease.rootPath).not.toContain(repositoryRoot);
    expect(readFileSync(join(lease.rootPath, "README.md"), "utf-8")).toBe("canonical fixture\n");
    expect(lease.canonicalHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(lease.initialSnapshot.files.map((file) => file.path)).toEqual(["README.md", "src/task.ts"]);
    expect(execFileSync("git", ["rev-parse", "--verify", "HEAD^{commit}"], {
      cwd: lease.rootPath,
      encoding: "utf-8",
      windowsHide: true,
    }).trim()).toMatch(/^[a-f0-9]{40,64}$/u);
    expect(lease.collectChanges()).toEqual({ changed: [], added: [], deleted: [] });

    writeFileSync(join(lease.rootPath, "README.md"), "attempt-only change\n", "utf-8");
    expect(readFileSync(join(repositoryRoot, "fixtures", "write", "README.md"), "utf-8"))
      .toBe("canonical fixture\n");
    lease.cleanup();
  });

  it("produces deterministic changed, added, and deleted file hashes", () => {
    const repositoryRoot = createRepository();
    const lease = createBenchmarkWriteWorkspaceLease(repositoryRoot, "fixtures/write");

    writeFileSync(join(lease.rootPath, "README.md"), "changed\n", "utf-8");
    rmSync(join(lease.rootPath, "src", "task.ts"));
    writeFileSync(join(lease.rootPath, "new.ts"), "export const fresh = true;\n", "utf-8");

    expect(lease.collectChanges()).toEqual({
      changed: [{
        path: "README.md",
        beforeHash: "sha256:07eb40461e4dc34a7c44564dce69a9575b070ae4da024abd3d71fe22957d4266",
        afterHash: "sha256:7f8b1dfc466b6249f06cbe55c9174df2578e7754da793fded244ef5cba2a38f1",
      }],
      added: [{
        path: "new.ts",
        hash: "sha256:8a3356cf2c509f49e550d8ef3994ac5930deac0ed769340c95fa5ebb2cdc296e",
      }],
      deleted: [{
        path: "src/task.ts",
        hash: "sha256:2c8bb8a8e21c3dc5c661e2e6b5b20b8c65feffe323a8b9b937c001cd5833e2a1",
      }],
    });
    lease.cleanup();
  });

  it("rejects nonportable fixtures and preserves canonical fixture integrity", () => {
    const repositoryRoot = createRepository();
    const fixture = join(repositoryRoot, "fixtures", "write");
    symlinkSync(join(fixture, "README.md"), join(fixture, "escape.txt"), "file");

    expect(() => createBenchmarkWriteWorkspaceLease(repositoryRoot, "fixtures/write"))
      .toThrow(/symbolic link/iu);
  });

  it("detects canonical fixture mutation and cleans only its lease root idempotently", () => {
    const repositoryRoot = createRepository();
    const lease = createBenchmarkWriteWorkspaceLease(repositoryRoot, "fixtures/write");
    writeFileSync(join(repositoryRoot, "fixtures", "write", "README.md"), "mutated\n", "utf-8");

    expect(() => lease.verifyCanonicalUnchanged()).toThrow(/changed during benchmark execution/iu);
    const leaseRoot = lease.rootPath;
    lease.cleanup();
    lease.cleanup();
    expect(existsSync(leaseRoot)).toBe(false);
    expect(existsSync(repositoryRoot)).toBe(true);
  });
});
