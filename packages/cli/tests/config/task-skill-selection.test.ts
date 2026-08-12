import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTaskSkillSelection } from "../../src/config/task-skill-selection.js";

function writeSkill(root: string, name: string, instructions = "Use this skill."): void {
  const dir = join(root, ".kiln", "skills", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `description: ${name} skill.`,
    "---",
    "",
    `# ${name}`,
    "",
    instructions,
    "",
  ].join("\n"), "utf-8");
}

describe("task skill selection work classification", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function tempRoot(): string {
    const root = mkdtempSync(join(tmpdir(), "kiln-task-skill-selection-"));
    roots.push(root);
    return root;
  }

  it("keeps work-classification skills advisory unless auto selection is enabled", () => {
    const root = tempRoot();
    writeSkill(root, "clear-writing");

    const selection = resolveTaskSkillSelection({
      projectPath: root,
      userHome: root,
      skillConfig: {
        selection: { mode: "advisory" },
        builtin: { enabled: false },
      },
      selection: { mode: "advisory" },
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      requesterLabel: "Task skill selection",
    });

    expect(selection.skillNames).toEqual([]);
    expect(selection.autoSkillNames).toEqual([]);
    expect(selection.workRecommendedSkillDiagnostics).toEqual([{
      skillName: "clear-writing",
      state: "advisory",
      reason: "skills.selection.mode is advisory; recommendation was not auto-admitted.",
    }]);
  });

  it("auto-admits clear-writing for explicit writing work classification", () => {
    const root = tempRoot();
    writeSkill(root, "clear-writing");

    const selection = resolveTaskSkillSelection({
      projectPath: root,
      userHome: root,
      skillConfig: {
        selection: { mode: "auto" },
        builtin: { enabled: false },
      },
      selection: { mode: "auto" },
      workClassification: {
        intents: ["review"],
        artifacts: ["message"],
        domains: ["support"],
        effects: ["answer-only"],
        modes: ["critique"],
      },
      requesterLabel: "Task skill selection",
    });

    expect(selection.skillNames).toEqual(["clear-writing"]);
    expect(selection.autoSkillNames).toEqual(["clear-writing"]);
    expect(selection.workRecommendedSkillNames).toEqual(["clear-writing"]);
    expect(selection.workRecommendedSkillDiagnostics).toEqual([{
      skillName: "clear-writing",
      state: "admitted",
      reason: "Recommended by work classification and admitted by auto selection.",
    }]);
    expect(selection.contextCandidates[0]?.content).toContain("# clear-writing");
  });

  it("auto-admits the canonical research workflow for research classification", () => {
    const root = tempRoot();

    const selection = resolveTaskSkillSelection({
      projectPath: root,
      userHome: root,
      skillConfig: {
        selection: { mode: "auto" },
        builtin: { enabled: true, include: ["research-workflow"] },
      },
      selection: { mode: "auto" },
      workClassification: {
        intents: ["research"],
        effects: ["answer-only"],
      },
      requesterLabel: "Task skill selection",
    });

    expect(selection.skillNames).toEqual(["research-workflow"]);
    expect(selection.autoSkillNames).toEqual(["research-workflow"]);
    expect(selection.workRecommendedSkillDiagnostics).toEqual([{
      skillName: "research-workflow",
      state: "admitted",
      reason: "Recommended by work classification and admitted by auto selection.",
    }]);
    expect(selection.contextCandidates[0]?.content).toContain("# Research Workflow");
    expect(selection.projectionEvidence.selections[0]?.selectionReason).toBe("auto");
  });

  it("diagnoses unavailable auto work recommendations without admitting them", () => {
    const root = tempRoot();

    const selection = resolveTaskSkillSelection({
      projectPath: root,
      userHome: root,
      skillConfig: {
        selection: { mode: "auto" },
        builtin: { enabled: false },
      },
      selection: { mode: "auto" },
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      requesterLabel: "Task skill selection",
    });

    expect(selection.skillNames).toEqual([]);
    expect(selection.unavailableAutoSkillNames).toEqual(["clear-writing"]);
    expect(selection.workRecommendedSkillDiagnostics).toEqual([{
      skillName: "clear-writing",
      state: "unavailable",
      reason: "Recommended by work classification but not found in the governed Kiln registry.",
    }]);
  });

  it("rejects explicitly requested skills disabled by catalog visibility", () => {
    const root = tempRoot();
    writeSkill(root, "selected-skill");

    expect(() => resolveTaskSkillSelection({
      explicitSkills: ["selected-skill"],
      projectPath: root,
      userHome: root,
      skillConfig: {
        builtin: { enabled: false },
        visibility: { overrides: { "selected-skill": "disabled" } },
      },
      requesterLabel: "Task skill selection",
    })).toThrow("Task skill selection references unavailable skill(s): selected-skill");
  });

  it("does not auto-admit a disabled work-recommended skill", () => {
    const root = tempRoot();
    writeSkill(root, "clear-writing");

    const selection = resolveTaskSkillSelection({
      projectPath: root,
      userHome: root,
      skillConfig: {
        selection: { mode: "auto" },
        builtin: { enabled: false },
        visibility: { overrides: { "clear-writing": "disabled" } },
      },
      selection: { mode: "auto" },
      workClassification: {
        intents: ["write"],
        artifacts: ["document"],
        domains: ["education"],
        effects: ["write-artifact"],
        modes: ["coauthor"],
      },
      requesterLabel: "Task skill selection",
    });

    expect(selection.skillNames).toEqual([]);
    expect(selection.unavailableAutoSkillNames).toEqual(["clear-writing"]);
    expect(selection.workRecommendedSkillDiagnostics[0]?.state).toBe("unavailable");
  });

  it("materializes only exact selected skill bodies and records path-free progressive projection evidence", () => {
    const root = tempRoot();
    writeSkill(root, "selected-skill", "Use the exact selected procedure.");
    writeSkill(root, "unselected-large-skill", `UNSELECTED_BODY_MUST_NOT_MATERIALIZE ${"waste ".repeat(400)}`);

    const selection = resolveTaskSkillSelection({
      explicitSkills: ["selected-skill"],
      projectPath: root,
      userHome: root,
      skillConfig: { builtin: { enabled: false } },
      requesterLabel: "Task skill selection",
    });

    expect(selection.contextCandidates).toHaveLength(1);
    expect(selection.contextCandidates[0]?.content).toContain("Use the exact selected procedure.");
    expect(selection.contextCandidates[0]?.content).not.toContain("UNSELECTED_BODY_MUST_NOT_MATERIALIZE");
    expect(selection.projectionEvidence).toMatchObject({
      policyId: "progressive-skill-projection-v1",
      catalogSkillCount: 2,
      selectedSkillCount: 1,
      deferredSkillCount: 1,
      selections: [{
        skillName: "selected-skill",
        selectionReason: "explicit",
        materializationSource: "filesystem",
      }],
    });
    expect(selection.projectionEvidence.catalogMetadataBytes).toBeGreaterThan(0);
    expect(selection.projectionEvidence.selectedContextBytes).toBeGreaterThan(0);
    expect(selection.projectionEvidence.selectedContextTokens).toBeGreaterThan(0);
    expect(selection.projectionEvidence.avoidedSourceBytes).toBeGreaterThan(2_000);
    expect(JSON.stringify(selection.projectionEvidence)).not.toContain(root);
  });
});
