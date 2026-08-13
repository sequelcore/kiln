import { describe, expect, it } from "vitest";
import { evaluateSkillValuePromotion, type SkillValueObservation } from "../../src/eval/skill-value-promotion.js";

function observation(taskId: string, condition: "baseline" | "skill", passed: boolean): SkillValueObservation {
  return {
    taskId, condition, passed, qualityScore: passed ? 0.9 : 0.3,
    routingCorrect: true, authorityBoundaryFailures: 0,
    modelFacingTokens: condition === "skill" ? 120 : 80,
    latencyMs: condition === "skill" ? 1100 : 1000,
    costUsd: condition === "skill" ? 0.02 : 0.015,
    skillDigest: "sha256:" + "a".repeat(64), candidateSetDigest: "sha256:" + "b".repeat(64),
    model: "test-model", harness: "test-harness", fixtureVersion: "1", replayEvidenceId: `${taskId}:${condition}`,
  };
}

describe("skill value promotion", () => {
  it("requires paired evidence and reports per-task regressions", () => {
    const observations = [
      observation("one", "baseline", false), observation("one", "skill", true),
      observation("two", "baseline", true), observation("two", "skill", false),
      observation("three", "baseline", true), observation("three", "skill", true),
    ];
    const report = evaluateSkillValuePromotion(observations, { minimumTaskCount: 3 });
    expect(report.taskCount).toBe(3);
    expect(report.regressedTaskIds).toEqual(["two"]);
    expect(report.promotionEligible).toBe(false);
    expect(report.issues).toContain("skill regressed task two");
  });

  it("promotes only evidence-complete non-inferior skill observations", () => {
    const observations = ["one", "two", "three"].flatMap((taskId) => [
      observation(taskId, "baseline", false), observation(taskId, "skill", true),
    ]);
    expect(evaluateSkillValuePromotion(observations, { minimumTaskCount: 3 })).toMatchObject({
      promotionEligible: true, issues: [], baselineSuccessRate: 0, skillSuccessRate: 1,
    });
  });

  it("rejects incomparable environments and mean quality regression", () => {
    const baseline = observation("one", "baseline", true);
    const mismatched = { ...observation("one", "skill", true), model: "other-model", qualityScore: 0.1 };
    const report = evaluateSkillValuePromotion([baseline, mismatched], { minimumTaskCount: 1 });

    expect(report.promotionEligible).toBe(false);
    expect(report.issues).toEqual(expect.arrayContaining([
      "task one has incomparable model",
      "skill mean quality is inferior to promotion policy",
    ]));
  });

  it("enforces explicitly declared resource regression limits", () => {
    const report = evaluateSkillValuePromotion([
      observation("one", "baseline", false), observation("one", "skill", true),
    ], {
      minimumTaskCount: 1,
      maximumMeanTokenIncrease: 10,
      maximumMeanLatencyIncreaseMs: 50,
      maximumMeanCostIncreaseUsd: 0.001,
    });
    expect(report.issues).toEqual(expect.arrayContaining([
      "skill token increase exceeds promotion policy",
      "skill latency increase exceeds promotion policy",
      "skill cost increase exceeds promotion policy",
    ]));
  });

  it("requires distinct replay evidence for both conditions", () => {
    const baseline = { ...observation("one", "baseline", true), replayEvidenceId: "" };
    const firstSkill = observation("one", "skill", true);
    const secondBaseline = { ...observation("two", "baseline", true), replayEvidenceId: firstSkill.replayEvidenceId };
    const secondSkill = observation("two", "skill", true);
    const report = evaluateSkillValuePromotion([baseline, firstSkill, secondBaseline, secondSkill], { minimumTaskCount: 2 });
    expect(report.issues).toEqual(expect.arrayContaining([
      "baseline observation lacks replay evidence for task one",
      `replay evidence ${firstSkill.replayEvidenceId} is reused`,
    ]));
  });

  it("rejects blank comparison identities", () => {
    expect(() => evaluateSkillValuePromotion([
      { ...observation("one", "baseline", true), harness: " " },
    ])).toThrow("requires harness");
  });
});
