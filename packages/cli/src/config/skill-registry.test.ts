import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConfiguredSkillRegistry } from "./skill-registry.js";

function writeProjectSkill(root: string, name: string, description: string): void {
  const skillDir = join(root, ".kiln", "skills", name);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      "Project instructions.",
      "",
    ].join("\n"),
    "utf-8",
  );
}

describe("createConfiguredSkillRegistry", () => {
  it("adds Kiln core builtin skills after project and user discovery", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-registry-"));
    try {
      writeProjectSkill(root, "tdd-workflow", "project override");

      const registry = createConfiguredSkillRegistry({
        projectPath: root,
        userHome: root,
      });

      expect(registry.get("code-review-findings")).toBeDefined();
      expect(registry.get("tdd-workflow")?.description).toBe("project override");
      expect(registry.load("tdd-workflow")?.instructions).toContain("Project instructions.");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("honors builtin include, exclude, and disabled policy", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-registry-policy-"));
    try {
      const registry = createConfiguredSkillRegistry({
        projectPath: root,
        userHome: root,
        skillConfig: {
          builtin: {
            include: ["tdd-workflow", "code-review-findings"],
            exclude: ["code-review-findings"],
          },
        },
      });

      expect(registry.get("tdd-workflow")).toBeDefined();
      expect(registry.get("code-review-findings")).toBeUndefined();
      expect(registry.get("repo-context-review")).toBeUndefined();

      const disabled = createConfiguredSkillRegistry({
        projectPath: root,
        userHome: root,
        skillConfig: { builtin: { enabled: false } },
      });
      expect(disabled.all()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
