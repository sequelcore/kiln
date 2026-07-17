import { describe, expect, it } from "vitest";
import {
  evaluateProgressiveLoadingPromotion,
  type ProgressiveLoadingObservation,
} from "../../src/eval/index.js";

function observation(
  taskId: string,
  policy: "eager" | "progressive",
  overrides: Partial<ProgressiveLoadingObservation> = {},
): ProgressiveLoadingObservation {
  return {
    taskId,
    policy,
    taskSucceeded: true,
    skillInstructionTokens: policy === "eager" ? 120 : 24,
    irrelevantSkillTokens: policy === "eager" ? 96 : 0,
    toolSchemaTokens: policy === "eager" ? 300 : 80,
    irrelevantToolSchemaTokens: policy === "eager" ? 220 : 0,
    selectionEvidenceId: `sha256:${taskId}-${policy}-selection`,
    replayEvidenceId: `sha256:${taskId}-${policy}-replay`,
    ...overrides,
  };
}

describe("progressive loading benchmark promotion", () => {
  it("promotes a k=5 non-inferior candidate only when irrelevant context declines", () => {
    const observations = ["read", "search", "inspect", "browse", "query"]
      .flatMap((taskId) => [observation(taskId, "eager"), observation(taskId, "progressive")]);

    const report = evaluateProgressiveLoadingPromotion(observations);

    expect(report).toMatchObject({
      policyId: "progressive-loading-promotion-v1",
      taskCount: 5,
      eagerSuccessRate: 1,
      progressiveSuccessRate: 1,
      promotionEligible: true,
      issues: [],
    });
    expect(report.tokenDelta.totalModelFacing).toBeLessThan(0);
    expect(report.tokenDelta.irrelevantSkills).toBeLessThan(0);
    expect(report.tokenDelta.irrelevantToolSchemas).toBeLessThan(0);
    expect(report.comparisonHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("fails closed on insufficient samples, success regression, missing evidence, or no token decline", () => {
    const noReduction = {
      irrelevantSkillTokens: 96,
      irrelevantToolSchemaTokens: 220,
    } as const;
    const observations = ["one", "two", "three", "four"]
      .flatMap((taskId) => [
        observation(taskId, "eager"),
        observation(taskId, "progressive", noReduction),
      ]);
    observations.push(
      observation("five", "eager"),
      observation("five", "progressive", {
        taskSucceeded: false,
        ...noReduction,
        selectionEvidenceId: "",
      }),
    );

    const report = evaluateProgressiveLoadingPromotion(observations, { minimumTaskCount: 6 });

    expect(report.promotionEligible).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      "requires at least 6 paired tasks; received 5",
      "progressive task success is inferior to eager loading",
      "missing selection or replay evidence for task five under progressive policy",
      "irrelevant skill tokens did not decline",
      "irrelevant tool-schema tokens did not decline",
    ]));
  });
});
