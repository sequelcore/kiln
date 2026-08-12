import { describe, expect, it } from "vitest";
import {
  defineWorkClassification,
  defineWorkClassificationProvenance,
  recommendedSkillsForWorkClassification,
} from "../../src/agents/work-classification.js";

describe("work classification", () => {
  it("normalizes explicit cross-domain work facets", () => {
    expect(defineWorkClassification({
      intents: [" write ", "review", "write"],
      artifacts: ["document", "message"],
      domains: ["education"],
      evidenceScopes: ["repository", "external", "repository"],
      effects: ["answer-only"],
      modes: ["coauthor", "critique"],
    })).toEqual({
      intents: ["write", "review"],
      artifacts: ["document", "message"],
      domains: ["education"],
      evidenceScopes: ["repository", "external"],
      effects: ["answer-only"],
      modes: ["coauthor", "critique"],
    });
  });

  it("fails closed for unknown explicit facets", () => {
    expect(() => defineWorkClassification({
      intents: ["writing"],
    })).toThrow("Unsupported work classification intent: writing");
  });

  it("normalizes plan work-item classification provenance", () => {
    expect(defineWorkClassificationProvenance({
      sourceKind: "plan-work-item",
      sourceId: " wi-1 ",
    })).toEqual({
      sourceKind: "plan-work-item",
      sourceId: "wi-1",
    });
  });

  it("fails closed for incomplete classification provenance", () => {
    expect(() => defineWorkClassificationProvenance({
      sourceKind: "plan-work-item",
      sourceId: " ",
    })).toThrow("Work classification provenance sourceId must be a non-empty string");
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

  it("routes research procedures by explicit evidence scope", () => {
    const unscopedResearch = defineWorkClassification({
      intents: ["research"],
      effects: ["answer-only"],
    });
    const repositoryResearch = defineWorkClassification({
      intents: ["research"],
      evidenceScopes: ["repository"],
      effects: ["read-only"],
    });
    const externalReport = defineWorkClassification({
      intents: ["research"],
      evidenceScopes: ["external"],
      artifacts: ["document"],
      effects: ["write-artifact"],
    });
    const mixedResearch = defineWorkClassification({
      intents: ["research"],
      evidenceScopes: ["repository", "provided", "external"],
      effects: ["read-only"],
    });

    expect(recommendedSkillsForWorkClassification(unscopedResearch)).toEqual([]);
    expect(recommendedSkillsForWorkClassification(repositoryResearch)).toEqual(["codebase-scouting"]);
    expect(recommendedSkillsForWorkClassification(externalReport)).toEqual([
      "research-workflow",
      "clear-writing",
    ]);
    expect(recommendedSkillsForWorkClassification(mixedResearch)).toEqual([
      "codebase-scouting",
      "research-workflow",
    ]);
  });

  it("fails closed for unknown evidence scope", () => {
    expect(() => defineWorkClassification({
      intents: ["research"],
      evidenceScopes: ["internet"],
    })).toThrow("Unsupported work classification evidence scope: internet");
  });
});
