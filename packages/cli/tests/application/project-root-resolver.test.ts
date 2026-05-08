import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const FIXTURE_ROOT = join(tmpdir(), "kiln-project-root-resolver-test");

function resetFixture(): string {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  return FIXTURE_ROOT;
}

describe("project-root-resolver", () => {
  afterEach(() => {
    rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  });

  it("prefers the nearest Kiln project config over a repository root", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".kiln"), { recursive: true });
    mkdirSync(join(root, "packages", "api"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), "version: \"1\"\n", "utf-8");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-project" }), "utf-8");

    const resolved = resolveProjectRoot({ cwd: join(root, "packages", "api") });

    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("kiln-yaml");
    expect(resolved.hasKilnYaml).toBe(true);
    expect(resolved.hasGitRoot).toBe(true);
    expect(resolved.projectName).toBe("fixture-project");
  });

  it("falls back to git root for repository shims when no kiln.yaml exists", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "git-only-project" }), "utf-8");

    const resolved = resolveProjectRoot({ cwd: join(root, "apps", "web") });

    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("git");
    expect(resolved.hasKilnYaml).toBe(false);
    expect(resolved.hasGitRoot).toBe(true);
    expect(resolved.projectName).toBe("git-only-project");
  });

  it("resolves explicit paths relative to the current working directory", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "packages", "cli"), { recursive: true });

    const resolved = resolveProjectRoot({
      cwd: root,
      explicitPath: "packages/cli",
    });

    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("git");
  });
});
