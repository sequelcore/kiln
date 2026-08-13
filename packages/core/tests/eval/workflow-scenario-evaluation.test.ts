import { describe, expect, it } from "vitest";
import { evaluateWorkflowScenario, WORKFLOW_SCENARIOS } from "../../src/eval/workflow-scenario-evaluation.js";

describe("portable workflow scenario evaluation", () => {
  it("covers and passes all 13 canonical synthetic fixtures", () => {
    expect(WORKFLOW_SCENARIOS).toHaveLength(13);
    const evaluations = WORKFLOW_SCENARIOS.map((scenario) => evaluateWorkflowScenario({
      scenarioId: scenario.id,
      signals: scenario.requiredSignals,
      replayEvidenceId: `fixture:${scenario.id}:v1`,
    }));
    expect(evaluations.every((evaluation) => evaluation.passed)).toBe(true);
  });

  it("retains missing signals and replay evidence as failures", () => {
    expect(evaluateWorkflowScenario({
      scenarioId: "orchestration-authority-widening",
      signals: [],
      replayEvidenceId: "",
    })).toMatchObject({
      passed: false,
      missingSignals: ["authority-denied-or-paused"],
      issues: ["missing required signal: authority-denied-or-paused", "missing replay evidence"],
    });
  });
});
