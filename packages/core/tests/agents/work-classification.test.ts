import { describe, expect, it } from "vitest";
import {
  defineWorkClassification,
  recommendedSkillsForWorkClassification,
} from "../../src/agents/work-classification.js";

describe("work classification", () => {
  it("normalizes explicit cross-domain work facets", () => {
    expect(defineWorkClassification({
      intents: [" write ", "review", "write"],
      artifacts: ["document", "message"],
      domains: ["education"],
      effects: ["answer-only"],
      modes: ["coauthor", "critique"],
    })).toEqual({
      intents: ["write", "review"],
      artifacts: ["document", "message"],
      domains: ["education"],
      effects: ["answer-only"],
      modes: ["coauthor", "critique"],
    });
  });

  it("fails closed for unknown explicit facets", () => {
    expect(() => defineWorkClassification({
      intents: ["writing"],
    })).toThrow("Unsupported work classification intent: writing");
  });

  it("recommends clear-writing for prose-like work", () => {
    const classification = defineWorkClassification({
      intents: ["edit"],
      artifacts: ["document"],
      domains: ["support"],
      effects: ["write-artifact"],
      modes: ["transform"],
    });

    expect(recommendedSkillsForWorkClassification(classification)).toEqual(["clear-writing"]);
  });

  it("does not treat coding work as writing work", () => {
    const classification = defineWorkClassification({
      intents: ["code"],
      artifacts: ["code"],
      domains: ["software"],
      effects: ["mutate-workspace"],
      modes: ["transform"],
    });

    expect(recommendedSkillsForWorkClassification(classification)).toEqual([]);
  });

  it("does not recommend writing guidance for ambiguous review of a non-writing artifact", () => {
    const classification = defineWorkClassification({
      intents: ["review"],
      artifacts: ["code"],
      domains: ["software"],
      effects: ["read-only"],
      modes: ["critique"],
    });

    expect(recommendedSkillsForWorkClassification(classification)).toEqual([]);
  });

  it("keeps writing guidance separate from publish authority", () => {
    const classification = defineWorkClassification({
      intents: ["support"],
      artifacts: ["message"],
      domains: ["support"],
      effects: ["publish-send"],
      modes: ["coauthor"],
    });

    expect(recommendedSkillsForWorkClassification(classification)).toEqual(["clear-writing"]);
  });
});
