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

  it("requires evidence-backed actionable code review findings", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "code-review-findings");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Read the task, contract, and relevant repository context");
    expect(skill?.instructions).toMatch(/Treat plausible\s+explanations as hypotheses, not evidence/);
    expect(skill?.instructions).toContain("distinct behavioral signal");
    expect(skill?.instructions).toContain("Do not report speculative findings");
    expect(skill?.instructions).toMatch(/State the reviewed surface and any material surface not reviewed/);
  });

  it("requires bounded evidence-driven codebase scouting", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "codebase-scouting");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Read the task and repository contract");
    expect(skill?.instructions).toContain("direct, transitive, or uncertain");
    expect(skill?.instructions).toMatch(/Treat text search and\s+naming proximity as leads, not dependency proof/);
    expect(skill?.instructions).toMatch(/registration, configuration,\s+reflection, code generation/);
    expect(skill?.instructions).toContain("Facts, inferences, and unknowns");
    expect(skill?.instructions).toMatch(/Focused affected tests are a\s+fast-feedback gate, not proof of complete impact coverage/);
    expect(skill?.instructions).toMatch(/Stop when ownership, contracts, consumer paths, verification ownership, and\s+material unknowns are mapped/);
    expect(skill?.instructions).toContain("Do not turn the map into an implementation plan");
  });

  it("requires explicit equivalence evidence for behavior-preserving refactors", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "refactoring-safety");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Define the observable behavior contract and capture baseline evidence");
    expect(skill?.instructions).toContain("Absence of static references is not proof that code is dead");
    expect(skill?.instructions).toContain("Apply one named transformation at a time");
    expect(skill?.instructions).toContain("Compare before-and-after behavior");
    expect(skill?.instructions).toContain("Delete the obsolete path in the same change");
    expect(skill?.instructions).toContain("reclassify the work as a behavior change or migration");
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

  it("defines proportional verification and test-value discipline in the TDD workflow", () => {
    const skill = KILN_CORE_BUILTIN_SKILLS.find((entry) => entry.name === "tdd-workflow");

    expect(skill).toBeDefined();
    expect(skill?.instructions).toContain("Run the owning suite and affected downstream suites");
    expect(skill?.instructions).toContain("If impact is uncertain, widen the gate");
    expect(skill?.instructions).toContain("Do not use test count or raw coverage as quality objectives");
    expect(skill?.instructions).toContain("Do not delete a test solely because its line coverage overlaps");
    expect(skill?.instructions).toContain("Use synthetic, portable fixture values");
    expect(skill?.instructions).toContain("Never copy operator-specific paths");
    expect(skill?.instructions).toContain("temporary directories");
  });
});
