import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { resolveTrustedWorkspace } from "../../src/application/trusted-workspace-resolution.js";
import { loadKilnConfig } from "../../src/config/config-merger.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("trusted workspace foundation", () => {
  it("resolves a private adopted binding and returns a composition revision", () => {
    const root = createProject("adopted");
    const kilnHome = join(root, "kiln-home");
    const globalConfigPath = join(root, "global-config.yaml");
    writeFileSync(globalConfigPath, "version: 1\n", "utf8");
    const binding = {
      cwd: () => join(root, "packages", "api"),
    };
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "packages", "api"), { recursive: true });
    const state = resolveProjectStateBinding(root, { kilnHome });
    createPrivateSources(state);
    bootstrapProjectAdoption(state);

    const result = resolveTrustedWorkspace(binding, { kilnHome, globalConfigPath });
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.canonicalRoot).toBe(root);
    expect(result.projectRuntimeId).toMatch(/^krp_[a-f0-9]{64}$/u);
    expect(result.projectStateRoot).toBe(state.projectStateRoot);
    expect(result.adoptionRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.globalConfigRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(result.compositionRevision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("does not treat a legacy repository .kiln marker as adoption", () => {
    const root = createProject("legacy-marker");
    mkdirSync(join(root, ".kiln"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), "version: 1\n", "utf8");
    const result = resolveTrustedWorkspace(
      { cwd: () => root },
      { kilnHome: join(root, "kiln-home"), globalConfigPath: join(root, "global.yaml") },
    );
    expect(result).toEqual({ status: "rejected", reason: "unadopted" });
  });

  it("changes composition when global bytes change while project identity and adoption stay stable", () => {
    const root = createProject("composition");
    mkdirSync(join(root, ".git"), { recursive: true });
    const kilnHome = join(root, "kiln-home");
    const globalConfigPath = join(root, "global.yaml");
    writeFileSync(globalConfigPath, "version: 1\n", "utf8");
    const state = resolveProjectStateBinding(root, { kilnHome });
    createPrivateSources(state);
    bootstrapProjectAdoption(state);
    const first = resolveTrustedWorkspace({ cwd: () => root }, { kilnHome, globalConfigPath });
    writeFileSync(globalConfigPath, "version: 2\n", "utf8");
    const second = resolveTrustedWorkspace({ cwd: () => root }, { kilnHome, globalConfigPath });
    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    if (first.status !== "resolved" || second.status !== "resolved") return;
    expect(second.projectRuntimeId).toBe(first.projectRuntimeId);
    expect(second.adoptionRevision).toBe(first.adoptionRevision);
    expect(second.globalConfigRevision).not.toBe(first.globalConfigRevision);
    expect(second.compositionRevision).not.toBe(first.compositionRevision);
  });

  it("keeps two private project configurations isolated under one operator Kiln home", async () => {
    const globalRoot = createProject("global-authority");
    const firstRoot = createProject("project-only-a");
    const secondRoot = createProject("project-only-b");
    mkdirSync(join(firstRoot, ".git"), { recursive: true });
    mkdirSync(join(secondRoot, ".git"), { recursive: true });
    const kilnHome = join(globalRoot, "kiln-home");
    const globalConfigPath = join(globalRoot, "global.yaml");
    writeFileSync(globalConfigPath, "version: 1\n", "utf8");
    const firstState = resolveProjectStateBinding(firstRoot, { kilnHome });
    const secondState = resolveProjectStateBinding(secondRoot, { kilnHome });
    createPrivateSources(firstState, "version: '1'\ndomain: project-a\n");
    createPrivateSources(secondState, "version: '1'\ndomain: project-b\n");
    bootstrapProjectAdoption(firstState);
    bootstrapProjectAdoption(secondState);

    const first = resolveTrustedWorkspace({ cwd: () => firstRoot }, { kilnHome, globalConfigPath });
    const second = resolveTrustedWorkspace({ cwd: () => secondRoot }, { kilnHome, globalConfigPath });
    const [firstConfig, secondConfig] = await Promise.all([
      loadKilnConfig(firstRoot, { projectStateBinding: firstState, globalConfig: null }),
      loadKilnConfig(secondRoot, { projectStateBinding: secondState, globalConfig: null }),
    ]);

    expect(first.status).toBe("resolved");
    expect(second.status).toBe("resolved");
    if (first.status !== "resolved" || second.status !== "resolved") return;
    expect(second.projectRuntimeId).not.toBe(first.projectRuntimeId);
    expect(second.projectStateRoot).not.toBe(first.projectStateRoot);
    expect(second.globalConfigRevision).toBe(first.globalConfigRevision);
    expect(second.compositionRevision).not.toBe(first.compositionRevision);
    expect(firstConfig?.domain).toBe("project-a");
    expect(secondConfig?.domain).toBe("project-b");
  });

  it("reports explicit re-adoption after repository relocation changes identity", () => {
    const container = createProject("relocation");
    const originalRoot = join(container, "original");
    const relocatedRoot = join(container, "relocated");
    mkdirSync(join(originalRoot, ".git"), { recursive: true });
    mkdirSync(join(relocatedRoot, ".git"), { recursive: true });
    const kilnHome = join(container, "kiln-home");
    const originalState = resolveProjectStateBinding(originalRoot, { kilnHome });
    const relocatedState = resolveProjectStateBinding(relocatedRoot, { kilnHome });
    createPrivateSources(originalState);
    bootstrapProjectAdoption(originalState);

    expect(relocatedState.projectRuntimeId).not.toBe(originalState.projectRuntimeId);
    expect(
      resolveTrustedWorkspace(
        { cwd: () => relocatedRoot },
        { kilnHome, globalConfigPath: join(container, "global.yaml") },
      ),
    ).toEqual({ status: "rejected", reason: "unadopted" });
  });

  it("rejects copied adoption state under another project identity", () => {
    const firstRoot = createProject("copy-a");
    const secondRoot = createProject("copy-b");
    mkdirSync(join(firstRoot, ".git"), { recursive: true });
    mkdirSync(join(secondRoot, ".git"), { recursive: true });
    const firstHome = join(firstRoot, "kiln-home");
    const secondHome = join(secondRoot, "kiln-home");
    const firstState = resolveProjectStateBinding(firstRoot, { kilnHome: firstHome });
    const secondState = resolveProjectStateBinding(secondRoot, { kilnHome: secondHome });
    createPrivateSources(firstState);
    bootstrapProjectAdoption(firstState);
    mkdirSync(secondState.projectStateRoot, { recursive: true });
    copyFileSync(firstState.adoptionManifestPath, secondState.adoptionManifestPath);
    expect(
      resolveTrustedWorkspace(
        { cwd: () => secondRoot },
        { kilnHome: secondHome, globalConfigPath: join(secondRoot, "global.yaml") },
      ),
    ).toEqual({ status: "rejected", reason: "unsafe-adoption" });
  });
});

function createProject(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `kiln-trusted-foundation-${label}-`));
  fixtures.push(root);
  return root;
}

function createPrivateSources(binding: ProjectStateBinding, config = "version: 1\n"): void {
  mkdirSync(binding.projectStateRoot, { recursive: true });
  mkdirSync(binding.agentsPath, { recursive: true });
  mkdirSync(binding.instructionsPath, { recursive: true });
  mkdirSync(binding.skillsPath, { recursive: true });
  writeFileSync(binding.configPath, config, "utf8");
  writeFileSync(binding.contextPath, "# Context\n", "utf8");
  writeFileSync(join(binding.agentsPath, "AGENTS.md"), "# Agents\n", "utf8");
  writeFileSync(join(binding.instructionsPath, "README.md"), "# Instructions\n", "utf8");
  writeFileSync(join(binding.skillsPath, "README.md"), "# Skills\n", "utf8");
}
