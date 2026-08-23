import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { resolveTrustedWorkspace } from "../../src/application/trusted-workspace-resolution.js";

const fixtureRoots: string[] = [];
const fixtureParent = dirname(resolve(import.meta.dirname, "../../../.."));

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveTrustedWorkspace", () => {
  it("binds a nested process CWD to the nearest single adopted ancestor", () => {
    const root = createFixture("adopted");
    const cwd = join(root, "packages", "api", "src");
    mkdirSync(cwd, { recursive: true });
    adopt(root, 'version: "1"\nprojectName: fixture\n');

    const result = resolveTrustedWorkspace({ cwd: () => cwd });

    expect(result).toMatchObject({
      status: "resolved",
      canonicalRoot: root,
    });
    if (result.status !== "resolved") throw new Error("Expected a resolved workspace");
    expect(result.projectRuntimeId).toMatch(/^krp_[a-f0-9]{64}$/);
    expect(result.projectRuntimeId).not.toContain(basename(root));
  });

  it("derives the same opaque identity through a canonicalized CWD alias", () => {
    const container = createFixture("canonical");
    const root = join(container, "project");
    const nested = join(root, "src");
    const alias = join(container, "project-alias");
    mkdirSync(nested, { recursive: true });
    adopt(root, 'version: "1"\nprojectName: fixture\n');
    symlinkSync(root, alias, "junction");

    const direct = resolveTrustedWorkspace({ cwd: () => nested });
    const throughAlias = resolveTrustedWorkspace({ cwd: () => join(alias, "src") });

    expect(direct.status).toBe("resolved");
    expect(throughAlias).toEqual(direct);
  });

  it("keeps runtime identity stable while changing marker freshness when canonical config changes", () => {
    const root = createFixture("marker-digest");
    adopt(root, 'version: "1"\nprojectName: first\n');
    const first = resolveTrustedWorkspace({ cwd: () => root });

    writeFileSync(join(root, ".kiln", "kiln.yaml"), 'version: "1"\nprojectName: second\n', "utf8");
    const second = resolveTrustedWorkspace({ cwd: () => root });

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    if (first.status !== "resolved" || second.status !== "resolved") return;
    expect(second.projectRuntimeId).toBe(first.projectRuntimeId);
    expect(first.markerDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.markerDigest).not.toBe(first.markerDigest);
  });

  it("rejects a process CWD that does not exist", () => {
    const root = createFixture("missing-cwd");

    expect(resolveTrustedWorkspace({ cwd: () => join(root, "absent") })).toEqual({
      status: "rejected",
      reason: "invalid-cwd",
    });
  });

  it("rejects a process CWD that is not a directory", () => {
    const root = createFixture("file-cwd");
    const cwd = join(root, "file.txt");
    writeFileSync(cwd, "fixture", "utf8");

    expect(resolveTrustedWorkspace({ cwd: () => cwd })).toEqual({
      status: "rejected",
      reason: "invalid-cwd",
    });
  });

  it("rejects a CWD without an adopted ancestor", () => {
    const root = createFixture("unadopted");

    expect(resolveTrustedWorkspace({ cwd: () => root })).toEqual({
      status: "rejected",
      reason: "missing-marker",
    });
  });

  it("rejects ambiguous nested adopted roots instead of silently choosing the nearest", () => {
    const outer = createFixture("ambiguous");
    const inner = join(outer, "workspaces", "nested");
    const cwd = join(inner, "src");
    mkdirSync(cwd, { recursive: true });
    adopt(outer, 'version: "1"\nprojectName: outer\n');
    adopt(inner, 'version: "1"\nprojectName: inner\n');

    expect(resolveTrustedWorkspace({ cwd: () => cwd })).toEqual({
      status: "rejected",
      reason: "ambiguous-adoption",
    });
  });

  it("rejects an adoption marker reached through a symlinked .kiln directory", () => {
    const container = createFixture("symlink-marker");
    const root = join(container, "project");
    const externalKiln = join(container, "external-kiln");
    mkdirSync(root, { recursive: true });
    mkdirSync(externalKiln, { recursive: true });
    writeFileSync(join(externalKiln, "kiln.yaml"), 'version: "1"\n', "utf8");
    symlinkSync(externalKiln, join(root, ".kiln"), "junction");

    expect(resolveTrustedWorkspace({ cwd: () => root })).toEqual({
      status: "rejected",
      reason: "unsafe-marker",
    });
  });
});

function createFixture(label: string): string {
  const root = mkdtempSync(join(fixtureParent, `kiln-trusted-workspace-${label}-`));
  fixtureRoots.push(root);
  return root;
}

function adopt(root: string, marker: string): void {
  mkdirSync(join(root, ".kiln"), { recursive: true });
  writeFileSync(join(root, ".kiln", "kiln.yaml"), marker, "utf8");
}
