import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { type ProjectStateBinding, resolveProjectStateBinding } from "../../src/application/project-state-root.js";
import { readRuntimeConfigurationRevision } from "../../src/application/runtime-configuration-revision.js";

const fixtures: string[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true });
});

describe("private project runtime configuration revision", () => {
  it("uses private project bytes as the exact project CAS revision and ignores repo .kiln", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-state-revision-"));
    fixtures.push(root);
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, ".kiln"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), "legacy: true\n", "utf8");
    const kilnHome = join(root, "kiln-home");
    const globalConfigPath = join(root, "global.yaml");
    writeFileSync(globalConfigPath, "version: global\n", "utf8");
    const binding = resolveProjectStateBinding(root, { kilnHome });
    const projectBytes = "version: private\nprojectName: fixture\n";
    createPrivateSources(binding);
    writeFileSync(binding.configPath, projectBytes, "utf8");
    bootstrapProjectAdoption(binding);

    const snapshot = readRuntimeConfigurationRevision(root, {
      projectStateBinding: binding,
      globalConfigPath,
      mutationStoreRoot: join(root, "synthetic-mutations"),
    });

    expect(snapshot.revisions.project).toBe(`sha256:${createHash("sha256").update(projectBytes).digest("hex")}`);
    expect(snapshot.revisions.global).toBe(`sha256:${createHash("sha256").update("version: global\n").digest("hex")}`);
    expect(snapshot.revisions["project-state"]).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(snapshot.revisions.adoption).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(JSON.stringify(snapshot)).not.toContain(root);

    writeFileSync(binding.contextPath, "# Context changed\n", "utf8");
    const changed = readRuntimeConfigurationRevision(root, {
      projectStateBinding: binding,
      globalConfigPath,
      mutationStoreRoot: join(root, "synthetic-mutations"),
    });
    expect(changed.revisions.project).toBe(snapshot.revisions.project);
    expect(changed.revisions.adoption).toBe(snapshot.revisions.adoption);
    expect(changed.revisions["project-state"]).not.toBe(snapshot.revisions["project-state"]);
  });

  it("fails closed when private adoption is absent even if repository state exists", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-runtime-state-absent-"));
    fixtures.push(root);
    const kilnHome = join(root, "synthetic-kiln-home");
    const globalConfigPath = join(root, "global.yaml");
    writeFileSync(globalConfigPath, "version: global\n", "utf8");
    mkdirSync(join(root, ".kiln"), { recursive: true });
    writeFileSync(join(root, ".kiln", "kiln.yaml"), "version: legacy\n", "utf8");

    expect(() => readRuntimeConfigurationRevision(root, { kilnHome, globalConfigPath })).toThrow(
      "Project adoption is not valid: missing",
    );
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
