import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
    mkdirSync(join(project, ".kiln", "agents"), { recursive: true });
    mkdirSync(join(project, ".kiln", "skills", "review"), { recursive: true });
    mkdirSync(join(root, "home", ".kiln"), { recursive: true });
    writeFileSync(mocks.globalPath, "version: '4'\n", "utf8");
    writeFileSync(join(project, ".kiln", "kiln.yaml"), "version: '1'\n", "utf8");
    const agentPath = join(project, ".kiln", "agents", "reviewer.md");
    const skillPath = join(project, ".kiln", "skills", "review", "SKILL.md");
    writeFileSync(agentPath, "agent R1", "utf8");
    writeFileSync(skillPath, "skill R1", "utf8");

    const agentsR1 = captureCanonicalReconciliationGeneration(project, "native-agents");
    const skillsR1 = captureCanonicalReconciliationGeneration(project, "native-skills");
    writeFileSync(agentPath, "agent R2", "utf8");
    writeFileSync(skillPath, "skill R2", "utf8");

    expect(captureCanonicalReconciliationGeneration(project, "native-agents")).not.toBe(agentsR1);
    expect(captureCanonicalReconciliationGeneration(project, "native-skills")).not.toBe(skillsR1);
  });
});
