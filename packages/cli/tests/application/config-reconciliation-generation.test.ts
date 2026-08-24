import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrapProjectAdoption } from "../../src/application/project-adoption-manifest.js";
import { resolveProjectStateBinding } from "../../src/application/project-state-root.js";

const roots: string[] = [];
const mocks = vi.hoisted(() => ({ globalPath: "" }));

vi.mock("../../src/config/global-config.js", () => ({
  resolveGlobalConfigPath: () => mocks.globalPath,
}));

import { captureCanonicalReconciliationGeneration } from "../../src/application/config-reconciliation-generation.js";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("reconciliation source generations", () => {
  it("changes when project agent or skill source content changes", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-reconciliation-generation-"));
    roots.push(root);
    const project = join(root, "project");
    mocks.globalPath = join(root, "home", ".kiln", "config.yaml");
    mkdirSync(project, { recursive: true });
    const projectStateBinding = resolveProjectStateBinding(project, { kilnHome: join(root, "home", ".kiln") });
    mkdirSync(projectStateBinding.agentsPath, { recursive: true });
    mkdirSync(join(projectStateBinding.skillsPath, "review"), { recursive: true });
    mkdirSync(join(root, "home", ".kiln"), { recursive: true });
    writeFileSync(mocks.globalPath, "version: '5'\n", "utf8");
    writeFileSync(projectStateBinding.configPath, "version: '1'\n", "utf8");
    const agentPath = join(projectStateBinding.agentsPath, "reviewer.md");
    const skillPath = join(projectStateBinding.skillsPath, "review", "SKILL.md");
    writeFileSync(agentPath, "agent R1", "utf8");
    writeFileSync(skillPath, "skill R1", "utf8");
    bootstrapProjectAdoption(projectStateBinding);

    const options = { projectStateBinding, globalConfigPath: mocks.globalPath };
    const agentsR1 = captureCanonicalReconciliationGeneration(project, "native-agents", options);
    const skillsR1 = captureCanonicalReconciliationGeneration(project, "native-skills", options);
    writeFileSync(agentPath, "agent R2", "utf8");
    writeFileSync(skillPath, "skill R2", "utf8");

    expect(captureCanonicalReconciliationGeneration(project, "native-agents", options)).not.toBe(agentsR1);
    expect(captureCanonicalReconciliationGeneration(project, "native-skills", options)).not.toBe(skillsR1);
  });
});
