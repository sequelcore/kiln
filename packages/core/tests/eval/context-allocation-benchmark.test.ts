import { describe, expect, it } from "vitest";
import {
  evaluateContextAllocationPromotion,
  type ContextAllocationObservation,
} from "../../src/eval/index.js";

function observation(
  taskId: string,
  policy: "whole-block-baseline" | "candidate",
  overrides: Partial<ContextAllocationObservation> = {},
): ContextAllocationObservation {
  return {
    taskId,
    taskClass: "verification-heavy",
    policy,
    verifiedSuccess: true,
    modelFacingTokens: policy === "whole-block-baseline" ? 200 : 100,
    requiredContextPreserved: true,
    auditEvidenceId: `sha256:${taskId}-${policy}`,
    ...overrides,
  };
}

describe("context allocation promotion", () => {
  it("promotes a five-task non-inferior lower-cost declared task class", () => {
    const observations = ["one", "two", "three", "four", "five"]
      .flatMap((taskId) => [observation(taskId, "whole-block-baseline"), observation(taskId, "candidate")]);

    const report = evaluateContextAllocationPromotion(observations);

    expect(report).toMatchObject({
      policyId: "context-allocation-promotion-v1",
      taskCount: 5,
      promotionEligible: true,
      issues: [],
      taskClasses: [{
        taskClass: "verification-heavy",
        baselineSuccessRate: 1,
        candidateSuccessRate: 1,
        baselineTokens: 1_000,
        candidateTokens: 500,
        tokenDelta: -500,
      }],
    });
  });

  it("blocks required-context violations, regressions, missing audits, and absent savings", () => {
    const observations = ["one", "two", "three", "four", "five"]
      .flatMap((taskId) => [
        observation(taskId, "whole-block-baseline"),
        observation(taskId, "candidate", {
          verifiedSuccess: taskId !== "five",
          modelFacingTokens: 200,
          requiredContextPreserved: taskId !== "four",
          auditEvidenceId: taskId === "three" ? "" : `sha256:${taskId}-candidate`,
        }),
      ]);

    expect(evaluateContextAllocationPromotion(observations)).toMatchObject({
      promotionEligible: false,
      issues: expect.arrayContaining([
        "candidate verified success regressed for task class verification-heavy",
        "candidate did not reduce model-facing tokens for any non-inferior task class",
        "candidate violated required context for task four",
        "missing allocation audit evidence for task three under candidate policy",
      ]),
    });
  });
});
