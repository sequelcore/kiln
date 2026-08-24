import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapProjectAdoption, readProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";
import {
  deriveProjectRuntimeId,
  normalizeProjectRootIdentity,
  type ProjectStateBinding,
  resolveProjectStateBinding,
} from "../../src/application/project-state-root.js";
import {
  assertPrivateStateFileTargetSync,
  ensurePrivateStateDirectorySync,
} from "../../src/application/private-project-state-filesystem.js";

const fixtures: string[] = [];

afterEach(() => {
  vi.unstubAllEnvs();
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

function fixture(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `kiln-project-state-${label}-`));
  fixtures.push(root);
  return root;
}

describe("project state root foundation", () => {
  it("derives one versioned full digest identity from a canonical root", () => {
    const root = fixture("identity");
    const normalized = normalizeProjectRootIdentity(root, "posix");
    const binding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });

    expect(normalized).toBe(root.replaceAll("\\", "/"));
    expect(binding.projectRuntimeId).toBe(deriveProjectRuntimeId(root));
    expect(binding.projectRuntimeId).toMatch(/^krp_[a-f0-9]{64}$/u);
    expect(binding.projectStateRoot).toBe(join(root, "kiln-home", "projects", binding.projectRuntimeId));
    expect(binding.projectRuntimeId).not.toContain(root);
    expect(binding.domainsPath).toBe(join(binding.projectStateRoot, "domains"));
    expect(binding.evidencePath).toBe(join(binding.projectStateRoot, "evidence"));
    expect(binding.memoryPath).toBe(join(binding.projectStateRoot, "memory"));
    expect(binding.feedbackPath).toBe(join(binding.projectStateRoot, "feedback"));
    expect(binding.benchmarksPath).toBe(join(binding.projectStateRoot, "benchmarks"));
  });

  it("normalizes Windows identity bytes independently of the host filesystem", () => {
    const windowsRoot = "C:\\Users\\Operator\\Projects\\Kiln\\..\\service\\";
    expect(normalizeProjectRootIdentity(windowsRoot, "win32")).toBe("c:/users/operator/projects/service");
    expect(normalizeProjectRootIdentity("C:\\\\", "win32")).toBe("c:/");
    expect(deriveProjectRuntimeId(windowsRoot, "win32")).toMatch(/^krp_[a-f0-9]{64}$/u);
    expect(deriveProjectRuntimeId(windowsRoot, "win32")).toBe(
      deriveProjectRuntimeId("c:/users/operator/projects/service", "win32"),
    );
  });

  it("converges nested directories and symlink aliases on one state root", () => {
    const container = fixture("convergence");
    const root = join(container, "project");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "packages", "cli"), { recursive: true });
    const alias = join(container, "project-alias");
    try {
      symlinkSync(root, alias, "junction");
    } catch {
      return;
    }

    const direct = resolveProjectStateBinding(resolveProjectRoot({ explicitPath: root }).rootPath, {
      kilnHome: join(container, "kiln-home"),
    });
    const nested = resolveProjectStateBinding(
      resolveProjectRoot({ explicitPath: join(root, "packages", "cli") }).rootPath,
      { kilnHome: join(container, "kiln-home") },
    );
    const throughAlias = resolveProjectStateBinding(resolveProjectRoot({ explicitPath: alias }).rootPath, {
      kilnHome: join(container, "kiln-home"),
    });
    expect(nested.projectRuntimeId).toBe(direct.projectRuntimeId);
    expect(throughAlias.projectRuntimeId).toBe(direct.projectRuntimeId);
    expect(throughAlias.canonicalRoot).toBe(direct.canonicalRoot);
  });

  it("canonicalizes an existing Kiln home alias before deriving private paths", () => {
    const container = fixture("kiln-home-alias");
    const root = join(container, "project");
    mkdirSync(root, { recursive: true });
    const realHome = join(container, "real-kiln-home");
    mkdirSync(realHome, { recursive: true });
    const alias = join(container, "kiln-home-alias");
    try {
      symlinkSync(realHome, alias, "junction");
    } catch {
      return;
    }
    const direct = resolveProjectStateBinding(root, { kilnHome: realHome });
    const throughAlias = resolveProjectStateBinding(root, { kilnHome: alias });
    expect(throughAlias.projectStateRoot).toBe(direct.projectStateRoot);
    expect(throughAlias.adoptionManifestPath).toBe(direct.adoptionManifestPath);
  });

  it("shares the XDG-selected operator Kiln home with global configuration", () => {
    const root = fixture("xdg-home");
    const xdgHome = join(root, "xdg");
    vi.stubEnv("XDG_CONFIG_HOME", xdgHome);

    const binding = resolveProjectStateBinding(root);

    expect(binding.projectStateRoot).toBe(join(
      xdgHome,
      "kiln",
      "projects",
      binding.projectRuntimeId,
    ));
  });

  it("resolves the Git root without consulting a repository-local .kiln marker", () => {
    const root = fixture("git-root");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".kiln"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), "legacy: true\n", "utf8");
    mkdirSync(join(root, "packages", "cli"), { recursive: true });

    const resolved = resolveProjectRoot({ cwd: join(root, "packages", "cli"), userHome: join(root, "home") });
    expect(resolved.rootPath).toBe(root);
    expect(resolved.source).toBe("git");
  });

  it("uses an explicit existing directory and canonical realpath, including a worktree .git file", () => {
    const root = fixture("worktree");
    const worktree = join(root, "worktree");
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, ".git"), "gitdir: ../git-dir\n", "utf8");
    const nested = join(worktree, "src");
    mkdirSync(nested, { recursive: true });

    const resolved = resolveProjectRoot({ cwd: root, explicitPath: worktree });
    expect(resolved.rootPath).toBe(worktree);
    expect(resolved.source).toBe("git");
    expect(resolved.hasGitRoot).toBe(true);
  });

  it("keeps synthetic state writes out of the operator home", () => {
    const root = fixture("home-seam");
    const syntheticHome = join(root, "kiln-home");
    const binding = resolveProjectStateBinding(root, { kilnHome: syntheticHome });
    createPrivateSources(binding);
    bootstrapProjectAdoption(binding);

    expect(readProjectAdoption(binding).status).toBe("adopted");
    expect(readFileSync(join(binding.projectStateRoot, "adoption.json"), "utf8")).not.toContain(root);
    expect(syntheticHome.startsWith(root)).toBe(true);
  });

  it("fails closed for private-state escapes and redirected mutable paths", () => {
    const root = fixture("private-path-safety");
    const binding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
    expect(() => ensurePrivateStateDirectorySync(binding.projectStateRoot, join(root, "outside")))
      .toThrow(/escapes/iu);

    mkdirSync(binding.projectStateRoot, { recursive: true });
    const outside = join(root, "redirect-target");
    mkdirSync(outside, { recursive: true });
    try {
      symlinkSync(outside, binding.runtimePath, "junction");
    } catch {
      return;
    }
    expect(() => ensurePrivateStateDirectorySync(binding.projectStateRoot, binding.runtimePath))
      .toThrow(/unsafe/iu);
    expect(() => assertPrivateStateFileTargetSync(binding.projectStateRoot, join(binding.runtimePath, "claims.sqlite")))
      .toThrow(/unsafe/iu);
  });
});

function createPrivateSources(binding: ProjectStateBinding): void {
  mkdirSync(binding.projectStateRoot, { recursive: true });
  mkdirSync(binding.agentsPath, { recursive: true });
  mkdirSync(binding.instructionsPath, { recursive: true });
  mkdirSync(binding.skillsPath, { recursive: true });
  writeFileSync(binding.configPath, "version: 1\n", "utf8");
  writeFileSync(binding.contextPath, "# Context\n", "utf8");
  writeFileSync(join(binding.agentsPath, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(binding.instructionsPath, "README.md"), "# Instructions\n", "utf8");
  writeFileSync(join(binding.skillsPath, "README.md"), "# Skills\n", "utf8");
}
