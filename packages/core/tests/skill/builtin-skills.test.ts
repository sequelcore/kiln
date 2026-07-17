import { describe, expect, it } from "vitest";
import {
  KILN_CORE_BUILTIN_SKILLS,
  renderSkillMarkdown,
  resolveKilnCoreBuiltinSkills,
} from "../../src/skill/index.js";

describe("Kiln core builtin skills", () => {
  it("defines a compact neutral core skill catalog", () => {
    const names = KILN_CORE_BUILTIN_SKILLS.map((skill) => skill.name);

    expect(names).toEqual([
      "repo-context-review",
      "codebase-scouting",
      "implementation-planning",
      "tdd-workflow",
      "code-review-findings",
      "clean-architecture-boundary-review",
      "ddd-boundary-review",
      "refactoring-safety",
      "security-scope-review",
      "managed-agent-risk-review",
      "benchmark-readiness-review",
      "config-projection-review",
      "clear-writing",
    ]);
    expect(KILN_CORE_BUILTIN_SKILLS.every((skill) => skill.filePath.startsWith("builtin://kiln/skills/"))).toBe(true);
    expect(KILN_CORE_BUILTIN_SKILLS.some((skill) => /sequel|internal-only/i.test(skill.name))).toBe(false);
  });

  it("applies builtin include and exclude policy", () => {
    expect(resolveKilnCoreBuiltinSkills({ enabled: false })).toEqual([]);
    expect(resolveKilnCoreBuiltinSkills({
      include: ["tdd-workflow", "code-review-findings"],
      exclude: ["code-review-findings"],
    }).map((skill) => skill.name)).toEqual(["tdd-workflow"]);
  });

  it("renders valid SKILL.md markdown for projection", () => {
    const markdown = renderSkillMarkdown(KILN_CORE_BUILTIN_SKILLS[0]!);

    expect(markdown).toContain("name: repo-context-review");
    expect(markdown).toContain("description:");
    expect(markdown).toContain("# Repo Context Review");
  });

  it("defines clear-writing as neutral reusable writing procedure", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "clear-writing");

    expect(skill).toBeDefined();
    expect(skill?.tags).toEqual(expect.arrayContaining(["writing", "plain-language"]));
    expect(skill?.instructions).toContain("Use this skill when writing, rewriting, or reviewing prose");
    expect(skill?.instructions).toMatch(/Preserve meaning, evidence, citations, quotes, code, tables, and required\s+format/);
    expect(skill?.instructions).not.toMatch(/Sequel's brand voice|GOV\.UK style skill/i);
  });
});
