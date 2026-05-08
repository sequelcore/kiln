import { describe, expect, it } from "vitest";
import { WorkItemStore } from "@kilnai/core";
import { assessWorkGovernance } from "./work-governance-policy.js";
import { createWorkGovernanceTools, WorkGovernanceAssessTool } from "./work-governance-tool.js";

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

  it("lists workflow profiles with UI evidence gates", async () => {
    const tools = createWorkGovernanceTools(policy);
    const tool = tools.find((candidate) => candidate.name === "work_profile.list");

    const result = await tool?.execute({
      name: "work_profile.list",
      input: { trigger: "ui" },
    });

    expect(result?.isError).toBe(false);
    expect(result?.output).toContain('"id": "ui-change"');
    expect(result?.output).toContain('"browser-qa"');
  });

  it("blocks work item completion until expected evidence and residual risk are present", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const completeTool = tools.find((candidate) => candidate.name === "work_item.complete");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Fix GUI approval UX",
        risk: "medium",
        triggers: ["ui", "cross-surface"],
      },
    });
    expect(created?.isError).toBe(false);
    const parsed = JSON.parse(created?.output ?? "{}") as { item: { id: string } };

    const blocked = await completeTool?.execute({
      name: "work_item.complete",
      input: {
        id: parsed.item.id,
        providedEvidence: ["surface-map"],
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("browser-qa");
    expect(blocked?.output).toContain("residual-risk closeout");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "complete",
      status: "blocked",
      errorCode: "missing_evidence",
    });
  });

  it("completes work items when all evidence is supplied", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const completeTool = tools.find((candidate) => candidate.name === "work_item.complete");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Small docs correction",
        workflowProfile: "small-fix",
        triggers: [],
        expectedEvidence: [],
      },
    });
    expect(created?.isError).toBe(false);
    const parsed = JSON.parse(created?.output ?? "{}") as { item: { id: string; expectedEvidence: string[] } };

    const completed = await completeTool?.execute({
      name: "work_item.complete",
      input: {
        id: parsed.item.id,
        providedEvidence: parsed.item.expectedEvidence,
        residualRisk: "No known residual risk after focused verification.",
      },
    });

    expect(completed?.isError).toBe(false);
    expect(completed?.output).toContain('"status": "completed"');
    expect(completed?.metadata).toMatchObject({
      kind: "work_item",
      operation: "complete",
      status: "completed",
    });
  });

  it("shares work item state with the caller-provided session store", async () => {
    const workItemStore = new WorkItemStore();
    const tools = createWorkGovernanceTools(policy, { workItemStore });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");

    await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Track runtime evidence",
        workflowProfile: "managed-agent-change",
        triggers: ["managed-agents"],
      },
    });

    expect(workItemStore.snapshot().items).toHaveLength(1);
    expect(workItemStore.snapshot().items[0]).toMatchObject({
      summary: "Track runtime evidence",
      workflowProfile: "managed-agent-change",
    });
  });
});
