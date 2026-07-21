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
      "action-first-communication",
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

  it("defines action-first communication without medical assumptions or unsafe absolutes", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "action-first-communication");

    expect(skill).toBeDefined();
    expect(skill?.tags).toEqual(expect.arrayContaining(["accessibility", "communication"]));
    expect(skill?.instructions).toContain("Lead with the answer, outcome, or next concrete action");
    expect(skill?.instructions).toContain("Do not invent time estimates");
    expect(skill?.instructions).toContain("Safety, accuracy, and the user's requested format take precedence");
    expect(skill?.instructions).not.toMatch(/ADHD|diagnosis|every message/i);
  });

  it("requires portable synthetic fixtures in the TDD workflow", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "tdd-workflow");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Use synthetic, portable fixture values");
    expect(skill?.instructions).toContain("Never copy operator-specific paths");
    expect(skill?.instructions).toContain("temporary directories");
  });
});
