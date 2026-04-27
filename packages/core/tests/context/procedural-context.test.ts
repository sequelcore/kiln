import { describe, expect, it } from "vitest";
import { DefaultContextGovernor } from "../../src/context/governor.js";
import type { ContextCandidate } from "../../src/context/projected-context.js";
import { skillConfigToContextCandidate } from "../../src/context/procedural-context.js";
import type { SkillConfig } from "../../src/skill/types.js";

type ProceduralKind = ContextCandidate["kind"] | "procedural";

function makeSkill(overrides: Partial<SkillConfig> = {}): SkillConfig {
  return {
    name: "slice-3a-procedural-skill",
    description: "Summarizes procedural runtime instructions into governed context.",
    tools: ["Read", "Write"],
    triggers: [],
    tags: ["context", "procedural"],
    filePath: "skills/slice-3a-procedural-skill.md",
    instructions: [
      "Summarize the current procedural objective.",
      "Preserve explicit constraints and ordering requirements.",
      "Defer implementation details until budgeting completes.",
    ].join("\n"),
    ...overrides,
  };
}

function asProceduralCandidate(
  candidate: unknown,
): ContextCandidate & { readonly kind: ProceduralKind } {
  return candidate as ContextCandidate & { readonly kind: ProceduralKind };
}

describe("skillConfigToContextCandidate", () => {
  it("maps SkillConfig into a stable procedural candidate with skill file provenance", () => {
    const skill = makeSkill();

    const firstPass = asProceduralCandidate(skillConfigToContextCandidate(skill));
    const secondPass = asProceduralCandidate(skillConfigToContextCandidate(skill));

    expect(firstPass).toEqual(secondPass);
    expect(firstPass).toMatchObject({
      kind: "procedural",
      source: "runtime-skill:skills/slice-3a-procedural-skill.md",
      score: 0.7,
      required: false,
    });
    expect(firstPass.content).toContain(skill.name);
    expect(firstPass.content).toContain(skill.description);
    expect(firstPass.content).toContain(skill.instructions);
  });

  it("allows score and required defaults to be overridden while preserving source provenance", () => {
    const skill = makeSkill({
      name: "budget-critical-procedural-skill",
      description: "Must remain required in projected context.",
    });

    const candidate = asProceduralCandidate(
      skillConfigToContextCandidate(skill, {
        score: 0.93,
        required: true,
      }),
    );

    expect(candidate).toMatchObject({
      kind: "procedural",
      source: "runtime-skill:skills/slice-3a-procedural-skill.md",
      score: 0.93,
      required: true,
    });
  });
});

describe("DefaultContextGovernor procedural audit integration", () => {
  it("ranks and defers procedural candidates under budget while preserving procedural audit metadata", () => {
    const governor = new DefaultContextGovernor<undefined, "procedural", "balanced">();
    const higherPriority = {
      ...asProceduralCandidate(
        skillConfigToContextCandidate(
          makeSkill({
            name: "planner-procedural-skill",
            filePath: "skills/planner-procedural-skill.md",
            description: "Planner instructions should win the first budget slot.",
          }),
          { score: 0.9 },
        ),
      ),
      estimatedTokens: 30,
    };
    const lowerPriority = {
      ...asProceduralCandidate(
        skillConfigToContextCandidate(
          makeSkill({
            name: "reviewer-procedural-skill",
            filePath: "skills/reviewer-procedural-skill.md",
            description: "Reviewer instructions should be deferred when the budget is tight.",
          }),
          { score: 0.4 },
        ),
      ),
      estimatedTokens: 30,
    };

    const result = governor.project({
      artifacts: [higherPriority, lowerPriority] as readonly ContextCandidate[],
      tokenBudget: 35,
    });
    const auditEntry = result.auditTrail?.[0];

    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]).toMatchObject({
      kind: "procedural",
      source: "runtime-skill:skills/planner-procedural-skill.md",
      score: 0.9,
    });
    expect(result.deferredBlocks).toHaveLength(1);
    expect(result.deferredBlocks?.[0]).toMatchObject({
      kind: "procedural",
      source: "runtime-skill:skills/reviewer-procedural-skill.md",
      score: 0.4,
    });
    expect(result.overflow).toBe(true);

    expect(auditEntry).toBeDefined();
    expect(auditEntry?.blocks).toHaveLength(2);
    expect(auditEntry?.blocks[0]).toMatchObject({
      kind: "procedural",
      source: "runtime-skill:skills/planner-procedural-skill.md",
      decision: "admitted",
      reason: "within-budget",
      effectiveScore: 0.9,
    });
    expect(auditEntry?.blocks[1]).toMatchObject({
      kind: "procedural",
      source: "runtime-skill:skills/reviewer-procedural-skill.md",
      decision: "deferred",
      reason: "budget-cap",
      effectiveScore: 0.4,
    });
  });
});
