import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTaskSkillSelection } from "../../src/config/task-skill-selection.js";

function writeSkill(root: string, name: string): void {
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
    "Use this skill.",
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
    expect(selection.contextCandidates[0]?.content).toContain("# clear-writing");
  });
});
