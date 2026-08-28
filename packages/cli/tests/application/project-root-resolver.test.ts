import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

  it("uses the Git root without consulting a repository-local Kiln config", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".kiln"), { recursive: true });
    mkdirSync(join(root, "packages", "api"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), 'version: "1"\n', "utf-8");
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "fixture-project" }), "utf-8");

    const resolved = resolveProjectRoot({ cwd: join(root, "packages", "api") });

    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("git");
    expect(resolved.hasGitRoot).toBe(true);
    expect(resolved.projectName).toBe("fixture-project");
  });

  it("falls back to the git root when no kiln.yaml exists", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "apps", "web"), { recursive: true });
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "git-only-project" }), "utf-8");

    const resolved = resolveProjectRoot({ cwd: join(root, "apps", "web") });

    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("git");
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

  it("stops the ancestor walk at the user home", () => {
    const root = resetFixture();
    const home = join(root, "home");
    const scratch = join(home, "tmp", "scratch");
    mkdirSync(join(home, ".git"), { recursive: true });
    mkdirSync(join(home, ".kiln"), { recursive: true });
    mkdirSync(scratch, { recursive: true });
    writeFileSync(join(home, ".kiln", "kiln.yaml"), 'version: "1"\n', "utf-8");

    const resolved = resolveProjectRoot({ cwd: scratch, userHome: home });

    expect(resolved.rootPath).toBe(scratch);
    expect(resolved.source).toBe("cwd");
    expect(resolved.hasGitRoot).toBe(false);
    expect(resolved.projectName).toBe("scratch");
  });

  it("keeps an explicit path out of a git-tracked user home", () => {
    const root = resetFixture();
    const home = join(root, "home");
    mkdirSync(join(home, ".git"), { recursive: true });
    mkdirSync(join(home, "tmp", "fixture"), { recursive: true });

    const resolved = resolveProjectRoot({
      cwd: home,
      explicitPath: join("tmp", "fixture"),
      userHome: home,
    });

    expect(resolved.rootPath).toBe(join(home, "tmp", "fixture"));
    expect(resolved.source).toBe("explicit");
    expect(resolved.hasGitRoot).toBe(false);
  });

  it("still adopts a project nested under the user home", () => {
    const root = resetFixture();
    const home = join(root, "home");
    const project = join(home, "projects", "service");
    mkdirSync(join(home, ".git"), { recursive: true });
    mkdirSync(join(project, ".git"), { recursive: true });
    mkdirSync(join(project, "src"), { recursive: true });

    const resolved = resolveProjectRoot({ cwd: join(project, "src"), userHome: home });

    expect(resolved.rootPath).toBe(project);
    expect(resolved.source).toBe("git");
    expect(resolved.hasGitRoot).toBe(true);
  });

  it("does not adopt a user home from a repository-local Kiln config", () => {
    const root = resetFixture();
    const home = join(root, "home");
    mkdirSync(join(home, ".kiln"), { recursive: true });
    writeFileSync(join(home, ".kiln", "kiln.yaml"), 'version: "1"\n', "utf-8");

    const resolved = resolveProjectRoot({ cwd: home, userHome: home });

    expect(resolved.rootPath).toBe(home);
    expect(resolved.source).toBe("cwd");
  });

  it("ignores nested Kiln state that is not a project config", () => {
    const root = resetFixture();
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".kiln"), { recursive: true });
    mkdirSync(join(root, "packages", "cli", ".kiln"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), 'version: "1"\n', "utf-8");
    writeFileSync(
      join(root, "packages", "cli", ".kiln", "continuation-targets.json"),
      JSON.stringify({ defaultSessionId: "stale-nested-session" }),
      "utf-8",
    );

    const resolved = resolveProjectRoot({
      cwd: root,
      explicitPath: "packages/cli",
    });

    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("git");
  });
});
