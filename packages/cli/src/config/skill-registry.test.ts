import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createConfiguredSkillRegistry } from "./skill-registry.js";
import { resolveProjectStateBinding } from "../application/project-state-root.js";

function writeProjectSkill(skillsRoot: string, name: string, description: string): void {
  const skillDir = join(skillsRoot, name);
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
      const projectStateBinding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
      writeProjectSkill(projectStateBinding.skillsPath, "tdd-workflow", "project override");

      const registry = createConfiguredSkillRegistry({
        projectPath: root,
        userHome: root,
        projectStateBinding,
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
      const projectStateBinding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
      const registry = createConfiguredSkillRegistry({
        projectPath: root,
        userHome: root,
        projectStateBinding,
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
        projectStateBinding,
        skillConfig: { builtin: { enabled: false } },
      });
      expect(disabled.all()).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes project skills disabled by canonical visibility", () => {
    const root = mkdtempSync(join(tmpdir(), "kiln-skill-registry-visibility-"));
    try {
      const projectStateBinding = resolveProjectStateBinding(root, { kilnHome: join(root, "kiln-home") });
      writeProjectSkill(projectStateBinding.skillsPath, "project-release", "project release");

      const registry = createConfiguredSkillRegistry({
        projectPath: root,
        userHome: root,
        projectStateBinding,
        skillConfig: {
          builtin: { enabled: false },
          visibility: { overrides: { "project-release": "disabled" } },
        },
      });

      expect(registry.get("project-release")).toBeUndefined();
      expect(registry.load("project-release")).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
