import { describe, expect, it } from "vitest";
import { assessWorkGovernance } from "./work-governance-policy.js";
import { WorkGovernanceAssessTool } from "./work-governance-tool.js";

describe("work-governance-tool", () => {
  const policy = {
    defaultPosture: "orchestrate" as const,
    directExecution: {
      maxFiles: 1,
      maxRisk: "low" as const,
    },
    requireDelegationFor: ["architecture", "ui"] as const,
    requiredEvidence: ["surface-map", "residual-risk"] as const,
  };

  it("recommends orchestration when a configured trigger matches", () => {
    const assessment = assessWorkGovernance(policy, {
      summary: "Update GUI layout",
      estimatedFiles: 1,
      risk: "low",
      triggers: ["ui"],
    });

    expect(assessment.recommendation).toBe("orchestrate");
    expect(assessment.reasons).toContain("default posture is orchestrate");
    expect(assessment.reasons).toContain("delegation trigger matched: ui");
    expect(assessment.requiredEvidence).toContain("browser-qa");
  });

  it("recommends direct execution inside a direct policy envelope", () => {
    const assessment = assessWorkGovernance({
      defaultPosture: "direct",
      directExecution: {
        maxFiles: 1,
        maxRisk: "low",
      },
    }, {
      summary: "Fix typo",
      estimatedFiles: 1,
      risk: "low",
      triggers: [],
    });

    expect(assessment).toMatchObject({
      recommendation: "direct",
      reasons: ["inside direct-execution envelope"],
    });
  });

  it("returns a readable tool result with required evidence", async () => {
    const tool = new WorkGovernanceAssessTool(policy);

    const result = await tool.execute({
      name: "work_governance.assess",
      input: {
        summary: "Refactor managed agent route selection",
        estimatedFiles: 4,
        risk: "medium",
        triggers: ["managed-agents", "cross-surface"],
      },
    });

    expect(result.isError).toBe(false);
    expect(result.output).toContain("recommendation: orchestrate");
    expect(result.output).toContain("estimated file count 4 exceeds direct max 1");
    expect(result.output).toContain("managed-agent-review");
  });
});
