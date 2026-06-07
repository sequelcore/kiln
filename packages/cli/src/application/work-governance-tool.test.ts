import { describe, expect, it } from "vitest";
import { GoalRunStore, WorkItemStore } from "@kilnai/core";
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
    expect(result?.output).toContain('"visual-reference-research"');
    expect(result?.output).toContain('"browser-qa"');
    expect(result?.output).toContain('"evidenceMatrix"');
    expect(result?.output).toContain('"frontend-reference evidence before planning: running-product UI captures when available, or code-backed frontend implementation evidence when the reference has no public screenshots"');
    expect(result?.output).toContain('"browser QA screenshot or interaction proof"');
  });

  it("uses explicit property types for strict provider governance tool schemas", () => {
    const missingTypes: string[] = [];
    const walk = (schema: unknown, path: string): void => {
      if (!schema || typeof schema !== "object") {
        return;
      }
      const record = schema as Record<string, unknown>;
      const properties = record["properties"];
      if (properties && typeof properties === "object" && !Array.isArray(properties)) {
        for (const [propertyName, propertySchema] of Object.entries(properties as Record<string, unknown>)) {
          if (propertySchema && typeof propertySchema === "object" && !Array.isArray(propertySchema)) {
            const propertyRecord = propertySchema as Record<string, unknown>;
            const hasExplicitShape = "type" in propertyRecord
              || "oneOf" in propertyRecord
              || "anyOf" in propertyRecord
              || "allOf" in propertyRecord
              || "$ref" in propertyRecord;
            if (!hasExplicitShape) {
              missingTypes.push(`${path}.properties.${propertyName}`);
            }
          }
          walk(propertySchema, `${path}.properties.${propertyName}`);
        }
      }
      const items = record["items"];
      if (items && typeof items === "object" && !Array.isArray(items)) {
        const itemRecord = items as Record<string, unknown>;
        const hasExplicitShape = "type" in itemRecord
          || "oneOf" in itemRecord
          || "anyOf" in itemRecord
          || "allOf" in itemRecord
          || "$ref" in itemRecord;
        if (!hasExplicitShape) {
          missingTypes.push(`${path}.items`);
        }
      }
      walk(items, `${path}.items`);
    };

    for (const tool of createWorkGovernanceTools(policy)) {
      walk(tool.inputSchema, `${tool.name}.inputSchema`);
    }

    expect(missingTypes).toEqual([]);
  });

  it("exposes the visual reference phase route as an explicit work item update field", () => {
    const updateTool = createWorkGovernanceTools(policy)
      .find((candidate) => candidate.name === "work_item.update");
    const schema = updateTool?.inputSchema as {
      readonly properties?: {
        readonly phaseRoutes?: {
          readonly properties?: Record<string, unknown>;
        };
      };
    };

    expect(schema.properties?.phaseRoutes).toMatchObject({
      type: "object",
      properties: {
        "visual-reference-research": {
          type: "string",
        },
      },
    });
  });

  it("materializes visual reference research before browser QA for UI work", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Refactor GUI visual hierarchy from real product references.",
        workflowProfile: "ui-change",
        triggers: ["ui", "cross-surface"],
      },
    });

    expect(created?.isError).toBe(false);
    const parsed = JSON.parse(created?.output ?? "{}") as {
      item: {
        expectedEvidence: readonly string[];
        verificationGates: readonly string[];
      };
    };
    expect(parsed.item.expectedEvidence).toEqual(expect.arrayContaining([
      "surface-map",
      "risk-hypothesis",
      "visual-reference-research",
      "browser-qa",
      "tests",
      "typecheck",
      "residual-risk",
    ]));
    expect(parsed.item.verificationGates).toEqual(expect.arrayContaining([
      "frontend-reference evidence before planning: running-product UI captures when available, or code-backed frontend implementation evidence when the reference has no public screenshots",
      "source URLs, relevant frontend file paths, and extracted reusable design principles; repository chrome, stars/forks/issues, and raw file listings alone do not count",
      "browser QA screenshot or interaction proof",
    ]));
  });

  it("materializes expected evidence and verification gates from the profile evidence matrix", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Validate managed agent replay evidence.",
        workflowProfile: "managed-agent-change",
        triggers: ["managed-agents", "provider-routing"],
      },
    });

    expect(created?.isError).toBe(false);
    const parsed = JSON.parse(created?.output ?? "{}") as {
      item: {
        expectedEvidence: readonly string[];
        verificationGates: readonly string[];
      };
    };
    expect(parsed.item.expectedEvidence).toEqual(expect.arrayContaining([
      "managed-agent-review",
      "tests",
      "typecheck",
      "residual-risk",
    ]));
    expect(parsed.item.verificationGates).toEqual(expect.arrayContaining([
      "managed child live or simulated evidence",
      "route/provider identity check",
      "typecheck/build",
    ]));
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
    expect(blocked?.output).toContain("visual-reference-research");
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

  it("blocks direct work item completion when a verification gate is skipped without residual risk", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const completeTool = tools.find((candidate) => candidate.name === "work_item.complete");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Verify skipped direct closeout.",
        workflowProfile: "small-fix",
        triggers: [],
        expectedEvidence: ["tests"],
        verificationGates: ["bun test", "bun run typecheck"],
      },
    });
    expect(created?.isError).toBe(false);
    const parsed = JSON.parse(created?.output ?? "{}") as { item: { id: string; expectedEvidence: string[] } };

    const blocked = await completeTool?.execute({
      name: "work_item.complete",
      input: {
        id: parsed.item.id,
        providedEvidence: parsed.item.expectedEvidence,
        skippedVerificationGates: ["bun run typecheck"],
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("residual-risk closeout");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "complete",
      status: "blocked",
      missingEvidence: [],
      missingResidualRisk: true,
      errorCode: "missing_evidence",
      item: {
        skippedVerificationGates: ["bun run typecheck"],
      },
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

  it("starts and finishes goal-bound work item execution attempts through tools", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-execute",
      summary: "Execute governed work.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      goalRunId: "goal-execute",
    });
    const goal = goalRunStore.create({
      id: "goal-execute",
      objective: "Execute approved work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    const started = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        summary: "Start direct execution.",
      },
    });
    expect(started?.isError).toBe(false);
    expect(started?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_started",
      id: item.id,
      status: "in_progress",
      attempt: {
        id: "goal-execute:work-execute:attempt:1",
        executionMode: "direct",
        status: "started",
      },
    });

    const finished = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-execute:work-execute:attempt:1",
        providedEvidence: ["tests"],
        summary: "Finished with tests.",
        closeoutSummary: "Goal execution finished.",
      },
    });

    expect(finished?.isError).toBe(false);
    expect(finished?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_finished",
      id: item.id,
      status: "completed",
      attempt: {
        id: "goal-execute:work-execute:attempt:1",
        status: "completed",
        providedEvidence: ["tests"],
      },
      missingEvidence: [],
      missingResidualRisk: false,
    });
    expect(goalRunStore.get(goal.id)?.status).toBe("completed");
  });

  it("records managed child execution failure through a canonical finished work item event shape", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-fail-tool",
      summary: "Execute delegated managed work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review", "tests"],
      verificationGates: ["managed child live or simulated evidence"],
      goalRunId: "goal-managed-fail-tool",
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-fail-tool",
      objective: "Record delegated child failure.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    await tools.find((candidate) => candidate.name === "work_item.execution.start")?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        managedInvocationId: "invocation-failed-tool",
      },
    });

    const failed = await tools.find((candidate) => candidate.name === "work_item.execution.fail")?.execute({
      name: "work_item.execution.fail",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-managed-fail-tool:work-managed-fail-tool:attempt:1",
        failureReason: "timed_out",
        summary: "Managed child timed out before returning evidence.",
      },
    });

    expect(failed?.isError).toBe(true);
    expect(failed?.metadata).toMatchObject({
      kind: "work_item",
      toolName: "work_item.execution.fail",
      operation: "execution_finished",
      id: item.id,
      status: "blocked",
      attempt: {
        id: "goal-managed-fail-tool:work-managed-fail-tool:attempt:1",
        status: "failed",
        failureReason: "timed_out",
        summary: "Managed child timed out before returning evidence.",
        missingEvidence: ["managed-agent-review", "tests"],
        managedInvocationId: "invocation-failed-tool",
      },
      missingEvidence: ["managed-agent-review", "tests"],
      errorCode: "missing_evidence",
    });
    expect(goalRunStore.get(goal.id)).toMatchObject({
      status: "active",
      currentPhase: "paused:work-managed-fail-tool",
    });
  });

  it("synthesizes structured managed orchestration result handoff from raw invocation handoff", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "orch-cli:child:1:work-item",
      summary: "Execute managed child handoff.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:result-handoff"],
      verificationGates: ["managed orchestration child handoff"],
      goalRunId: "goal-managed-handoff",
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
      authorityProfile: "foundation-propose-writes",
      managedOrchestration: {
        orchestrationId: "orch-cli",
        mode: "decomposition",
        childId: "orch-cli:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [{
          kind: "result-handoff",
          label: "bounded child result handoff",
          required: true,
        }],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: false,
        },
        adoptionGate: {
          required: false,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption not required for this child.",
        },
      },
    });
    const goal = goalRunStore.create({
      id: "goal-managed-handoff",
      objective: "Close with structured managed handoff.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: {
        workflowProfile: "managed-agent-change",
        preferredRouteId: "opencode-readonly",
        managedAgentProfile: "coder",
      },
      evidenceRequirements: [{
        id: "managed-orchestration:result-handoff",
        description: "Structured child result handoff.",
        required: true,
      }],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");
    const started = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        managedInvocationId: "orch-cli:child:1",
      },
    });
    expect(started?.isError).toBe(false);
    expect(started?.metadata).toMatchObject({
      attempt: {
        executionMode: "managed_delegation",
        managedInvocationId: "orch-cli:child:1",
      },
    });

    const finished = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-managed-handoff:orch-cli:child:1:work-item:attempt:1",
        providedEvidence: ["managed-orchestration:result-handoff"],
        managedInvocationResultHandoff: {
          summary: "Implemented the managed child scope and produced reviewable handoff evidence.",
          resourceUris: ["kiln://artifacts/orch-cli/child-1-handoff"],
        },
      },
    });

    expect(finished?.isError).toBe(false);
    expect(finished?.metadata).toMatchObject({
      operation: "execution_finished",
      status: "completed",
      item: {
        managedOrchestrationResultHandoff: {
          orchestrationId: "orch-cli",
          childId: "orch-cli:child:1",
          workItemId: item.id,
          resourceUris: ["kiln://artifacts/orch-cli/child-1-handoff"],
        },
      },
      missingEvidence: [],
      missingGoalEvidence: [],
    });
    expect(goalRunStore.get(goal.id)?.status).toBe("completed");
  });

  it("passes managed orchestration adoption readiness evidence through finish execution", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "orch-cli-readiness:child:1:work-item",
      summary: "Execute managed child adoption readiness.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: [
        "managed-orchestration:result-handoff",
        "managed-orchestration:completion-signal",
        "managed-orchestration:merge:collect-all",
        "managed-orchestration:diff",
        "managed-orchestration:verification",
        "managed-orchestration:review",
        "managed-orchestration:adoption-gate",
      ],
      verificationGates: [
        "managed orchestration diff evidence",
        "managed orchestration verification",
        "managed orchestration review",
        "managed orchestration adoption gate",
      ],
      goalRunId: "goal-managed-readiness",
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
      authorityProfile: "foundation-apply-approved-writes",
      managedOrchestration: {
        orchestrationId: "orch-cli-readiness",
        mode: "decomposition",
        childId: "orch-cli-readiness:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [{
          kind: "result-handoff",
          label: "bounded child result handoff",
          required: true,
        }],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: true,
        },
        adoptionGate: {
          required: true,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption required for code-writing child.",
          readiness: {
            required: true,
            evidence: [
              "managed-orchestration:diff",
              "managed-orchestration:verification",
              "managed-orchestration:review",
            ],
            verificationGates: [
              "managed orchestration diff evidence",
              "managed orchestration verification",
              "managed orchestration review",
              "managed orchestration adoption gate",
            ],
          },
        },
      },
    });
    const goal = goalRunStore.create({
      id: "goal-managed-readiness",
      objective: "Close with adoption readiness.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: {
        workflowProfile: "managed-agent-change",
        preferredRouteId: "opencode-readonly",
        managedAgentProfile: "coder",
      },
      evidenceRequirements: [{
        id: "managed-orchestration:adoption-gate",
        description: "Structured child adoption readiness.",
        required: true,
      }],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    await tools.find((candidate) => candidate.name === "work_item.execution.start")?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        managedInvocationId: "orch-cli-readiness:child:1",
      },
    });

    const rejectedWrongTarget = await tools.find((candidate) => candidate.name === "work_item.execution.finish")?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-managed-readiness:orch-cli-readiness:child:1:work-item:attempt:1",
        managedOrchestrationAdoption: {
          target: "wrong-adoption-target",
          adoptedBy: "reviewer",
          adoptedAt: "2026-05-12T10:30:00.000Z",
          resourceUris: ["kiln://artifacts/orch-cli-readiness/wrong-adoption"],
        },
      },
    });

    expect(rejectedWrongTarget?.isError).toBe(true);
    expect(rejectedWrongTarget?.output).toContain("managedOrchestrationAdoption.target");
    expect(workItemStore.get(item.id)?.status).toBe("in_progress");

    const finished = await tools.find((candidate) => candidate.name === "work_item.execution.finish")?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-managed-readiness:orch-cli-readiness:child:1:work-item:attempt:1",
        providedEvidence: [
          "managed-orchestration:result-handoff",
          "managed-orchestration:completion-signal",
          "managed-orchestration:merge:collect-all",
          "managed-orchestration:diff",
          "managed-orchestration:verification",
          "managed-orchestration:review",
          "managed-orchestration:adoption-gate",
        ],
        verificationGateResults: [
          { gate: "managed orchestration diff evidence", status: "passed" },
          { gate: "managed orchestration verification", status: "passed" },
          { gate: "managed orchestration review", status: "passed" },
          { gate: "managed orchestration adoption gate", status: "passed" },
        ],
        managedInvocationResultHandoff: {
          summary: "Implemented child scope with diff, verification, and review resources.",
          resourceUris: ["kiln://artifacts/orch-cli-readiness/child-1-handoff"],
        },
        managedOrchestrationAdoption: {
          target: "slice-6-handoff-review-adoption",
          adoptedBy: "reviewer",
          adoptedAt: "2026-05-12T10:30:00.000Z",
          resourceUris: ["kiln://artifacts/orch-cli-readiness/adoption"],
        },
      },
    });

    expect(finished?.isError).toBe(false);
    expect(finished?.metadata).toMatchObject({
      operation: "execution_finished",
      status: "completed",
      item: {
        status: "completed",
        managedOrchestrationAdoption: {
          target: "slice-6-handoff-review-adoption",
          adoptedBy: "reviewer",
        },
      },
      missingEvidence: [],
      missingGoalEvidence: [],
      missingVerificationGates: [],
    });
    expect(goalRunStore.get(goal.id)?.status).toBe("completed");
  });

  it("rejects malformed raw managed invocation handoff input before finishing execution", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "orch-cli-invalid:child:1:work-item",
      summary: "Reject malformed managed child handoff.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agent-change"],
      expectedEvidence: ["managed-orchestration:result-handoff"],
      verificationGates: ["managed orchestration child handoff"],
      goalRunId: "goal-invalid-handoff",
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
      authorityProfile: "foundation-propose-writes",
      managedOrchestration: {
        orchestrationId: "orch-cli-invalid",
        mode: "decomposition",
        childId: "orch-cli-invalid:child:1",
        ordinal: 1,
        roleIntent: "implementation-child",
        expectedEvidence: [{
          kind: "result-handoff",
          label: "bounded child result handoff",
          required: true,
        }],
        isolation: {
          required: true,
          reason: "isolated worktree required",
          workingDirectoryMode: "isolated-worktree",
        },
        mergePolicy: {
          mode: "collect-all",
          adoptionRequired: false,
        },
        adoptionGate: {
          required: false,
          target: "slice-6-handoff-review-adoption",
          reason: "Adoption not required for this child.",
        },
      },
    });
    const goal = goalRunStore.create({
      id: "goal-invalid-handoff",
      objective: "Reject malformed handoff.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: {
        workflowProfile: "managed-agent-change",
        preferredRouteId: "opencode-readonly",
        managedAgentProfile: "coder",
      },
      evidenceRequirements: [{
        id: "managed-orchestration:result-handoff",
        description: "Structured child result handoff.",
        required: true,
      }],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    await tools.find((candidate) => candidate.name === "work_item.execution.start")?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        managedInvocationId: "orch-cli-invalid:child:1",
      },
    });

    const rejected = await tools.find((candidate) => candidate.name === "work_item.execution.finish")?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-invalid-handoff:orch-cli-invalid:child:1:work-item:attempt:1",
        managedInvocationResultHandoff: {
          summary: "Implemented the managed child scope.",
          resourceUris: [],
        },
      },
    });

    expect(rejected?.isError).toBe(true);
    expect(rejected?.output).toContain("managedInvocationResultHandoff.resourceUris");
    expect(workItemStore.get(item.id)?.status).toBe("in_progress");

    const rejectedMixedUris = await tools.find((candidate) => candidate.name === "work_item.execution.finish")?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-invalid-handoff:orch-cli-invalid:child:1:work-item:attempt:1",
        managedInvocationResultHandoff: {
          summary: "Implemented the managed child scope.",
          resourceUris: ["", "kiln://artifacts/orch-cli-invalid/child-1-handoff"],
        },
      },
    });

    expect(rejectedMixedUris?.isError).toBe(true);
    expect(rejectedMixedUris?.output).toContain("managedInvocationResultHandoff.resourceUris");
    expect(workItemStore.get(item.id)?.status).toBe("in_progress");
  });

  it("returns generated goal closeout summary when final execution omits manual summary", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-generated-closeout",
      summary: "Verify generated closeout summary.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck"],
      verificationGates: ["bun test", "bun run typecheck"],
      goalRunId: "goal-generated-closeout",
    });
    const goal = goalRunStore.create({
      id: "goal-generated-closeout",
      objective: "Generate closeout from evidence.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    await startTool?.execute({
      name: "work_item.execution.start",
      input: { goalRunId: goal.id },
    });

    const finished = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-generated-closeout:work-generated-closeout:attempt:1",
        providedEvidence: ["tests", "typecheck"],
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "passed" },
        ],
      },
    });

    expect(finished?.isError).toBe(false);
    expect(finished?.output).toContain("Goal goal-generated-closeout completed from canonical evidence.");
    expect(finished?.output).toContain("Evidence: tests, typecheck.");
    expect(finished?.output).toContain("Passed gates: bun test, bun run typecheck.");
  });

  it("blocks goal-bound execution finish until evidence and residual risk are present", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-blocked-finish",
      summary: "Verify governed closeout.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck", "residual-risk"],
      verificationGates: ["bun test", "bun run typecheck"],
      goalRunId: "goal-blocked-finish",
    });
    const goal = goalRunStore.create({
      id: "goal-blocked-finish",
      objective: "Execute closeout-gated work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    const started = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        summary: "Start closeout-gated execution.",
      },
    });
    expect(started?.isError).toBe(false);

    const blocked = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-blocked-finish:work-blocked-finish:attempt:1",
        providedEvidence: ["tests"],
        summary: "Only tests completed.",
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain('"status": "blocked"');
    expect(blocked?.output).toContain("typecheck");
    expect(blocked?.output).toContain("residual-risk closeout");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_finished",
      id: item.id,
      status: "blocked",
      missingEvidence: ["typecheck", "residual-risk"],
      missingResidualRisk: true,
      errorCode: "missing_evidence",
      attempt: {
        id: "goal-blocked-finish:work-blocked-finish:attempt:1",
        status: "blocked",
        providedEvidence: ["tests"],
      },
    });
    expect(workItemStore.get(item.id)?.status).toBe("blocked");
    expect(goalRunStore.get(goal.id)?.currentPhase).toBe("paused:work-blocked-finish");
  });

  it("blocks skipped verification gates until residual risk is documented", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-skipped-gate",
      summary: "Verify skipped gate closeout.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test", "bun run typecheck"],
      goalRunId: "goal-skipped-gate",
    });
    const goal = goalRunStore.create({
      id: "goal-skipped-gate",
      objective: "Execute closeout-gated work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        summary: "Start closeout-gated execution.",
      },
    });

    const blocked = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-skipped-gate:work-skipped-gate:attempt:1",
        providedEvidence: ["tests"],
        skippedVerificationGates: ["bun run typecheck"],
        summary: "Tests passed; typecheck was skipped.",
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("residual-risk closeout");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_finished",
      id: item.id,
      status: "blocked",
      missingEvidence: [],
      missingResidualRisk: true,
      errorCode: "missing_evidence",
      attempt: {
        id: "goal-skipped-gate:work-skipped-gate:attempt:1",
        skippedVerificationGates: ["bun run typecheck"],
      },
      item: {
        skippedVerificationGates: ["bun run typecheck"],
      },
    });
    expect(goalRunStore.get(goal.id)?.currentPhase).toBe("paused:work-skipped-gate");
  });

  it("blocks final goal closeout when required goal evidence is missing", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-goal-evidence",
      summary: "Complete item evidence only.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      goalRunId: "goal-evidence-closeout",
    });
    const goal = goalRunStore.create({
      id: "goal-evidence-closeout",
      objective: "Close only with goal-level evidence.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [
        { id: "tests", description: "Focused tests pass.", required: true },
        { id: "typecheck", description: "Typecheck passes.", required: true },
      ],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
      },
    });

    const blocked = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-evidence-closeout:work-goal-evidence:attempt:1",
        providedEvidence: ["tests"],
        closeoutSummary: "Should not close without typecheck.",
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("typecheck");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_finished",
      id: item.id,
      status: "completed",
      missingEvidence: [],
      missingGoalEvidence: ["typecheck"],
      errorCode: "missing_evidence",
    });
    expect(goalRunStore.get(goal.id)).toMatchObject({
      status: "active",
      currentPhase: "paused:goal-closeout",
    });
  });

  it("records verification gate results and blocks failed gates", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-gate-results",
      summary: "Record verification gate results.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests", "typecheck"],
      verificationGates: ["bun test", "bun run typecheck"],
      goalRunId: "goal-gate-results",
    });
    const goal = goalRunStore.create({
      id: "goal-gate-results",
      objective: "Execute closeout-gated work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    await startTool?.execute({
      name: "work_item.execution.start",
      input: { goalRunId: goal.id },
    });

    const blocked = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: item.id,
        attemptId: "goal-gate-results:work-gate-results:attempt:1",
        providedEvidence: ["tests", "typecheck"],
        verificationGateResults: [
          { gate: "bun test", status: "passed", summary: "Focused tests passed." },
          { gate: "bun run typecheck", status: "failed", summary: "TypeScript error in workflow projection." },
        ],
        summary: "Typecheck failed.",
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("failed gate: bun run typecheck");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_finished",
      id: item.id,
      status: "blocked",
      failedVerificationGates: ["bun run typecheck"],
      errorCode: "missing_evidence",
      attempt: {
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "failed" },
        ],
      },
      item: {
        verificationGateResults: [
          { gate: "bun test", status: "passed" },
          { gate: "bun run typecheck", status: "failed" },
        ],
      },
    });
    expect(goalRunStore.get(goal.id)?.currentPhase).toBe("paused:work-gate-results");
  });

  it("blocks risky profile closeout until reviewer gates pass", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const finishTool = tools.find((candidate) => candidate.name === "work_item.execution.finish");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-review-gate",
        summary: "Verify managed-agent review closeout.",
        workflowProfile: "managed-agent-change",
        triggers: ["managed-agents"],
        goalRunId: "goal-review-gate",
      },
    });
    expect(created?.isError).toBe(false);
    const item = workItemStore.get("work-review-gate");
    expect(item?.verificationGates).toContain("adversarial managed-agent review");
    const goal = goalRunStore.create({
      id: "goal-review-gate",
      objective: "Execute risky profile work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: ["work-review-gate"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "managed-agent-change" },
      evidenceRequirements: [],
    });

    await startTool?.execute({
      name: "work_item.execution.start",
      input: { goalRunId: goal.id },
    });

    const blocked = await finishTool?.execute({
      name: "work_item.execution.finish",
      input: {
        goalRunId: goal.id,
        workItemId: "work-review-gate",
        attemptId: "goal-review-gate:work-review-gate:attempt:1",
        providedEvidence: item?.expectedEvidence ?? [],
        verificationGateResults: [
          { gate: "managed child live or simulated evidence", status: "passed" },
          { gate: "route/provider identity check", status: "passed" },
          { gate: "typecheck/build", status: "passed" },
        ],
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("missing gate: adversarial managed-agent review");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "execution_finished",
      status: "blocked",
      missingVerificationGates: ["adversarial managed-agent review"],
      errorCode: "missing_evidence",
    });
  });

  it("blocks UI profile closeout until browser QA gates pass", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const completeTool = tools.find((candidate) => candidate.name === "work_item.complete");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Verify browser QA closeout.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
      },
    });
    expect(created?.isError).toBe(false);
    const parsed = JSON.parse(created?.output ?? "{}") as {
      item: {
        id: string;
        expectedEvidence: readonly string[];
      };
    };

    const blocked = await completeTool?.execute({
      name: "work_item.complete",
      input: {
        id: parsed.item.id,
        providedEvidence: parsed.item.expectedEvidence,
        residualRisk: "No known residual risk after UI verification.",
        verificationGateResults: [
          {
            gate: "frontend-reference evidence before planning: running-product UI captures when available, or code-backed frontend implementation evidence when the reference has no public screenshots",
            status: "passed",
            evidence: [
              "Product UI screenshot from running app at http://localhost:3000 with artifact kiln://artifacts/interactive-screenshots/artifact_1/content.",
            ],
          },
          {
            gate: "source URLs and extracted reusable design principles",
            status: "passed",
            evidence: ["Source URL https://github.com/sybil-solutions/vllm-studio plus running product UI screenshot."],
          },
          { gate: "typecheck", status: "passed" },
        ],
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("missing gate: browser QA screenshot or interaction proof");
    expect(blocked?.output).toContain("missing gate: accessibility/overflow check");
    expect(blocked?.metadata).toMatchObject({
      kind: "work_item",
      operation: "complete",
      status: "blocked",
      missingVerificationGates: [
        "browser QA screenshot or interaction proof",
        "accessibility/overflow check",
      ],
      errorCode: "missing_evidence",
    });
  });

  it("does not start an explicit work item before earlier dependencies are complete", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const first = workItemStore.upsert({
      id: "work-first",
      summary: "First work.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      goalRunId: "goal-ordered",
    });
    const second = workItemStore.upsert({
      id: "work-second",
      summary: "Second work.",
      workflowProfile: "verification-heavy",
      triggers: ["verification-heavy"],
      expectedEvidence: ["tests"],
      verificationGates: ["bun test"],
      dependencies: [first.id],
      goalRunId: "goal-ordered",
    });
    const goal = goalRunStore.create({
      id: "goal-ordered",
      objective: "Execute ordered work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [first.id, second.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });
    const startTool = createWorkGovernanceTools(policy, { workItemStore, goalRunStore })
      .find((candidate) => candidate.name === "work_item.execution.start");

    const blocked = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        workItemId: second.id,
      },
    });

    expect(blocked?.isError).toBe(true);
    expect(blocked?.output).toContain("Explicit work item is not the next ready item");
    expect(workItemStore.get(second.id)?.status).toBe("pending");
  });

  it("creates a governed goal and links existing work items before execution starts", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const tools = createWorkGovernanceTools(policy, {
      workItemStore,
      goalRunStore,
      ownerSessionId: "session-current",
    });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const goalTool = tools.find((candidate) => candidate.name === "goal.create");
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");

    await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-goal-linked",
        summary: "Execute governed linked work.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        expectedEvidence: ["tests"],
      },
    });

    const createdGoal = await goalTool?.execute({
      name: "goal.create",
      input: {
        id: "goal-linked",
        objective: "Execute linked work.",
        planId: "plan-1",
        workItemIds: ["work-goal-linked"],
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        authorityReason: "Approved plan.",
        workflowProfile: "verification-heavy",
      },
    });

    expect(createdGoal?.isError).toBe(false);
    expect(goalRunStore.get("goal-linked")?.ownerSessionId).toBe("session-current");
    expect(workItemStore.get("work-goal-linked")?.goalRunId).toBe("goal-linked");
    expect(workItemStore.get("work-goal-linked")?.planId).toBe("plan-1");

    const started = await startTool?.execute({
      name: "work_item.execution.start",
      input: { goalRunId: "goal-linked" },
    });

    expect(started?.isError).toBe(false);
    expect(started?.metadata).toMatchObject({
      operation: "execution_started",
      id: "work-goal-linked",
      status: "in_progress",
    });
  });

  it("rejects goal-level route and agent-profile ownership in the same route policy", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const tools = createWorkGovernanceTools(policy, {
      workItemStore,
      goalRunStore,
      ownerSessionId: "session-current",
    });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const goalTool = tools.find((candidate) => candidate.name === "goal.create");

    await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-route-conflict",
        summary: "Scout route ownership.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        expectedEvidence: ["surface-map"],
      },
    });

    const createdGoal = await goalTool?.execute({
      name: "goal.create",
      input: {
        id: "goal-route-conflict",
        objective: "Scout route ownership.",
        planId: "plan-1",
        workItemIds: ["work-route-conflict"],
        maximumAuthority: "read_only",
        escalationPolicy: "approval_required",
        authorityReason: "Scouting only.",
        workflowProfile: "verification-heavy",
        preferredRouteId: "codex-oauth-readonly",
        managedAgentProfile: "scout",
      },
    });

    expect(createdGoal?.isError).toBe(true);
    expect(createdGoal?.output).toContain("preferredRouteId");
    expect(createdGoal?.output).toContain("managedAgentProfile");
    expect(goalRunStore.get("goal-route-conflict")).toBeUndefined();
    expect(workItemStore.get("work-route-conflict")?.routeId).toBeUndefined();
  });

  it("normalizes redundant goal route hints when each linked work item already owns the exact route", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const tools = createWorkGovernanceTools(policy, {
      workItemStore,
      goalRunStore,
      ownerSessionId: "session-current",
    });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const goalTool = tools.find((candidate) => candidate.name === "goal.create");

    await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-route-owned",
        summary: "Execute route-owned UI work.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
        routeId: "opencode-go-frontend-approved-write",
        phaseRoutes: {
          "visual-reference-research": "opencode-go-qwen3-6-plus-readonly",
        },
        assignedAgentProfile: "frontend-coder",
        authorityProfile: "foundation-apply-approved-writes",
      },
    });

    const createdGoal = await goalTool?.execute({
      name: "goal.create",
      input: {
        id: "goal-route-owned",
        objective: "Execute route-owned UI work.",
        planId: "plan-1",
        workItemIds: ["work-route-owned"],
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        authorityReason: "Work item owns the exact write route.",
        workflowProfile: "ui-change",
        preferredRouteId: "opencode-go-frontend-approved-write",
        managedAgentProfile: "frontend-coder",
      },
    });

    expect(createdGoal?.isError).toBe(false);
    expect(goalRunStore.get("goal-route-owned")?.routePolicy).toEqual({
      workflowProfile: "ui-change",
    });
    expect(workItemStore.get("work-route-owned")).toMatchObject({
      goalRunId: "goal-route-owned",
      routeId: "opencode-go-frontend-approved-write",
      assignedAgentProfile: "frontend-coder",
    });
  });

  it("rejects manual in-progress transitions because execution.start owns active attempts", async () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const updateTool = createWorkGovernanceTools(policy, { workItemStore })
      .find((candidate) => candidate.name === "work_item.update");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-manual-progress",
        summary: "Do not bypass execution start.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        status: "in_progress",
      },
    });

    expect(created?.isError).toBe(true);
    expect(created?.output).toContain("work_item.execution.start");
    expect(workItemStore.get("work-manual-progress")).toBeUndefined();
  });

  it("fails fast instead of fabricating an owner session for goal creation", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const goalTool = tools.find((candidate) => candidate.name === "goal.create");

    await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-no-session",
        summary: "Execute governed linked work.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        expectedEvidence: ["tests"],
      },
    });

    const createdGoal = await goalTool?.execute({
      name: "goal.create",
      input: {
        id: "goal-no-session",
        objective: "Execute linked work.",
        planId: "plan-1",
        workItemIds: ["work-no-session"],
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        authorityReason: "Approved plan.",
        workflowProfile: "verification-heavy",
      },
    });

    expect(createdGoal?.isError).toBe(true);
    expect(createdGoal?.output).toContain("ownerSessionId");
    expect(goalRunStore.get("goal-no-session")).toBeUndefined();
  });

  it("treats null optional work item arrays as omitted", async () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const updateTool = createWorkGovernanceTools(policy, { workItemStore })
      .find((candidate) => candidate.name === "work_item.update");

    const result = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-null-optionals",
        summary: "Create work item with omitted optional arrays.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        providedEvidence: null,
        dependencies: null,
        pauseRequirements: null,
      },
    });

    expect(result?.isError).toBe(false);
    expect(workItemStore.get("work-null-optionals")).toMatchObject({
      providedEvidence: [],
      dependencies: [],
      pauseRequirements: [],
    });
  });

  it("rejects visual-reference evidence when the only screenshot is repository chrome", async () => {
    const tools = createWorkGovernanceTools(policy);
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");

    const rejected = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Collect visual reference research.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
        expectedEvidence: ["visual-reference-research"],
        providedEvidence: ["visual-reference-research"],
        verificationGateResults: [{
          gate: "real product screenshots or browser visual references before planning",
          status: "passed",
          evidence: [
            "Browser opened https://github.com/sybil-solutions/vllm-studio and captured repository files navigation screenshot kiln://artifacts/interactive-screenshots/artifact_23/content.",
          ],
        }],
      },
    });

    expect(rejected?.isError).toBe(true);
    expect(rejected?.output).toContain("visual_reference_product_ui_required");

    const placeholderRejected = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Collect visual reference research.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
        expectedEvidence: ["visual-reference-research"],
        providedEvidence: ["visual-reference-research"],
        verificationGateResults: [{
          gate: "visual-reference-research: real product UI evidence",
          status: "passed",
          summary: "<summarize qualifying product UI evidence, source URLs, artifact URIs, and reusable design principles>",
          evidence: [
            "<source URL showing product UI or comparable technical workstation UI>",
            "<kiln:// artifact URI for screenshot/image evidence>",
          ],
        }],
      },
    });

    expect(placeholderRejected?.isError).toBe(true);
    expect(placeholderRejected?.output).toContain("visual_reference_product_ui_required");

    const codeBackedAccepted = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Collect frontend reference research.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
        expectedEvidence: ["visual-reference-research"],
        providedEvidence: ["visual-reference-research"],
        verificationGateResults: [{
          gate: "visual-reference-research: frontend-reference evidence before planning",
          status: "passed",
          summary: "No public product screenshots were found. Code-backed frontend implementation evidence from https://github.com/sybil-solutions/vllm-studio identifies frontend/src app shell component structure, layout pattern, navigation model, panel density, typography, spacing, and product ergonomics.",
          evidence: [
            "https://github.com/sybil-solutions/vllm-studio frontend/src/app and frontend/src/components .tsx files show component structure, layout pattern, navigation model, panels, status area, typography, spacing, and density.",
          ],
        }],
      },
    });

    expect(codeBackedAccepted?.isError).toBe(false);

    const localCodeBackedAccepted = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Collect local frontend reference research.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
        expectedEvidence: ["visual-reference-research"],
        providedEvidence: ["visual-reference-research"],
        verificationGateResults: [{
          gate: "visual-reference-research: frontend-reference evidence before planning",
          status: "passed",
          summary: "No running product screenshots were available. Code-backed frontend implementation evidence from local source /workspace/references/vllm-studio identifies frontend/src app shell component structure, layout pattern, navigation model, panel density, typography, spacing, and product ergonomics.",
          evidence: [
            "Local source /workspace/references/vllm-studio/frontend/src/components/AppShell.tsx and /workspace/references/t1code/src/app/layout.tsx show component structure, layout pattern, navigation model, panels, status area, typography, spacing, and density.",
          ],
        }],
      },
    });

    expect(localCodeBackedAccepted?.isError).toBe(false);

    const accepted = await updateTool?.execute({
      name: "work_item.update",
      input: {
        summary: "Collect visual reference research.",
        workflowProfile: "ui-change",
        triggers: ["ui"],
        expectedEvidence: ["visual-reference-research"],
        providedEvidence: ["visual-reference-research"],
        verificationGateResults: [{
          gate: "real product screenshots or browser visual references before planning",
          status: "passed",
          evidence: [
            "Product UI screenshot of the running vLLM Studio dashboard captured from http://localhost:3000 with artifact kiln://artifacts/interactive-screenshots/artifact_24/content.",
          ],
        }, {
          gate: "source URLs and extracted reusable design principles",
          status: "passed",
          evidence: [
            "Source URL https://github.com/sybil-solutions/vllm-studio; extracted product UI principles from the running dashboard screenshot.",
          ],
        }],
      },
    });

    expect(accepted?.isError).toBe(false);
  });

  it("rejects routed UI write work without an explicit read-only visual research phase route", async () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const updateTool = createWorkGovernanceTools(policy, { workItemStore })
      .find((candidate) => candidate.name === "work_item.update");

    const rejected = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-ui-with-write-route",
        summary: "Refactor the GUI experience.",
        workflowProfile: "ui-change",
        risk: "high",
        triggers: ["ui", "cross-surface"],
        routeId: "opencode-go-frontend-approved-write",
        authorityProfile: "foundation-apply-approved-writes",
        expectedEvidence: ["visual-reference-research", "tests", "typecheck"],
        phaseRoutes: {},
      },
    });

    expect(rejected?.isError).toBe(true);
    expect(rejected?.output).toContain("visual_reference_phase_route_required");
    expect(rejected?.output).toContain("phaseRoutes.visual-reference-research");
    expect(rejected?.output).toContain('"nextTool": "work_item.update"');
    expect(rejected?.output).toContain('"visual-reference-research": "<read-only web/frontend-reference capable route id>"');
    expect(rejected?.output).toContain("Do not paste this JSON as assistant text");
    expect(rejected?.metadata).toMatchObject({
      kind: "work_item",
      operation: "update",
      status: "blocked",
      errorCode: "invalid_input",
      requiredPhaseRoute: "visual-reference-research",
      suggestedNextTool: "work_item.update",
    });
    expect(workItemStore.get("work-ui-with-write-route")).toBeUndefined();

    const accepted = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-ui-with-write-route",
        summary: "Refactor the GUI experience.",
        workflowProfile: "ui-change",
        risk: "high",
        triggers: ["ui", "cross-surface"],
        routeId: "opencode-go-frontend-approved-write",
        authorityProfile: "foundation-apply-approved-writes",
        expectedEvidence: ["visual-reference-research", "tests", "typecheck"],
        phaseRoutes: {
          "visual-reference-research": "opencode-go-qwen3-6-plus-readonly",
        },
      },
    });
    const output = JSON.parse(accepted?.output ?? "{}") as { readonly nextAction?: string };

    expect(accepted?.isError).toBe(false);
    expect(output.nextAction).toContain("visual-reference-research");
    expect(output.nextAction).toContain("opencode-go-qwen3-6-plus-readonly");
  });

  it("returns explicit next governed execution tools after creating a pending routed work item", async () => {
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const updateTool = createWorkGovernanceTools(policy, { workItemStore })
      .find((candidate) => candidate.name === "work_item.update");

    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-routed",
        summary: "Execute routed frontend implementation.",
        workflowProfile: "ui-change",
        triggers: ["ui", "managed-agents"],
        assignedAgentProfile: "frontend-coder",
        routeId: "opencode-go-frontend-approved-write",
        phaseRoutes: {
          "visual-reference-research": "opencode-go-qwen3-6-plus-readonly",
        },
        authorityProfile: "foundation-apply-approved-writes",
      },
    });
    const output = JSON.parse(created?.output ?? "{}") as {
      readonly nextRequiredTools?: readonly string[];
      readonly nextAction?: string;
    };

    expect(created?.isError).toBe(false);
    expect(output.nextRequiredTools).toEqual(["goal.create", "work_item.execution.start"]);
    expect(output.nextAction).toContain("Do not stop after scout");
    expect(output.nextAction).toContain("opencode-go-frontend-approved-write");
  });

  it("returns a recoverable goal.create contract error when execution references an unknown goal", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const startTool = createWorkGovernanceTools(policy, { workItemStore, goalRunStore })
      .find((candidate) => candidate.name === "work_item.execution.start");

    const result = await startTool?.execute({
      name: "work_item.execution.start",
      input: { goalRunId: "goal-missing" },
    });
    const output = JSON.parse(result?.output ?? "{}") as {
      readonly error?: {
        readonly code?: string;
        readonly recoverable?: boolean;
        readonly suggestedNextTool?: string;
      };
    };

    expect(result?.isError).toBe(true);
    expect(output.error).toMatchObject({
      code: "goal_not_found",
      recoverable: true,
      suggestedNextTool: "goal.create",
    });
  });

  it("pauses execution on unresolved work item requirements and resumes after update resolves them", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const tools = createWorkGovernanceTools(policy, { workItemStore, goalRunStore });
    const updateTool = tools.find((candidate) => candidate.name === "work_item.update");
    const startTool = tools.find((candidate) => candidate.name === "work_item.execution.start");
    const created = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-paused",
        summary: "Execute after credentials are available.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        expectedEvidence: ["tests"],
        pauseRequirements: [
          {
            id: "credential-access",
            kind: "credentials",
            summary: "Provide test service credentials.",
            status: "pending",
          },
        ],
      },
    });
    expect(created?.isError).toBe(false);
    goalRunStore.create({
      id: "goal-paused-requirement",
      objective: "Execute approved work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: ["work-paused"],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: { workflowProfile: "verification-heavy" },
      evidenceRequirements: [],
    });

    const paused = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: "goal-paused-requirement",
      },
    });

    expect(paused?.isError).toBe(true);
    expect(paused?.output).toContain("pause_requirements_unresolved");
    expect(paused?.output).toContain("credential-access");
    expect(workItemStore.get("work-paused")?.status).toBe("pending");

    const resolved = await updateTool?.execute({
      name: "work_item.update",
      input: {
        id: "work-paused",
        summary: "Execute after credentials are available.",
        workflowProfile: "verification-heavy",
        triggers: ["verification-heavy"],
        expectedEvidence: ["tests"],
        pauseRequirements: [
          {
            id: "credential-access",
            kind: "credentials",
            summary: "Provide test service credentials.",
            status: "resolved",
            resolvedBy: "operator",
            resolvedAt: "2026-05-12T20:00:00.000Z",
            resolution: "Credentials supplied through approved channel.",
          },
        ],
      },
    });
    expect(resolved?.isError).toBe(false);

    const started = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: "goal-paused-requirement",
      },
    });

    expect(started?.isError).toBe(false);
    expect(started?.metadata).toMatchObject({
      operation: "execution_started",
      id: "work-paused",
      status: "in_progress",
    });
  });

  it("requires a managed invocation id before starting managed-delegation execution", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed",
      summary: "Execute delegated work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: ["review child handoff"],
      goalRunId: "goal-managed",
      routeId: "opencode-readonly",
      assignedAgentProfile: "coder",
      authorityProfile: "foundation-propose-writes",
    });
    const goal = goalRunStore.create({
      id: "goal-managed",
      objective: "Execute delegated work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: {
        workflowProfile: "managed-agent-change",
        preferredRouteId: "opencode-readonly",
        managedAgentProfile: "coder",
      },
      evidenceRequirements: [],
    });
    const startTool = createWorkGovernanceTools(policy, { workItemStore, goalRunStore })
      .find((candidate) => candidate.name === "work_item.execution.start");

    const missingInvocation = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        governanceRecommendation: "orchestrate",
        managedProviderId: "opencode",
        managedModel: "opencode-default-model",
      },
    });

    expect(missingInvocation?.isError).toBe(true);
    expect(missingInvocation?.output).toContain("managedInvocationId is required");
    const missingInvocationOutput = JSON.parse(missingInvocation?.output ?? "{}") as {
      readonly nextTool?: string;
      readonly managedInvocationRequest?: {
        readonly profile?: string;
        readonly routeId?: string;
        readonly providerRoute?: {
          readonly providerId?: string;
          readonly model?: string;
        };
        readonly requestedAuthority?: string;
        readonly task?: string;
        readonly summary?: string;
        readonly workItemId?: string;
        readonly attemptId?: string;
        readonly agentProfile?: string;
        readonly roleIntent?: string;
        readonly expectedEvidence?: readonly string[];
        readonly requiredResultFields?: readonly string[];
        readonly doneCriteria?: readonly string[];
        readonly residualRiskRequired?: boolean;
      };
    };
    expect(missingInvocationOutput.nextTool).toBe("managed_agent.invoke");
    expect(missingInvocationOutput.managedInvocationRequest).toMatchObject({
      profile: "foundation-propose-writes",
      routeId: "opencode-readonly",
      providerRoute: {
        providerId: "opencode",
        model: "opencode-default-model",
      },
      requestedAuthority: "audited",
      summary: "Execute delegated work.",
      workItemId: "work-managed",
      attemptId: "goal-managed:work-managed:attempt:1",
      agentProfile: "coder",
      roleIntent: "Execute governed work item work-managed for goal goal-managed.",
      executionPhase: {
        id: "managed-review-closeout",
        expectedEvidence: ["managed-agent-review"],
        requiredToolNames: [],
        remainingEvidenceAfterPhase: [],
        finalPhase: true,
        completionTool: "work_item.execution.finish",
      },
      expectedEvidence: ["managed-agent-review"],
      requiredResultFields: ["summary", "evidence", "checks"],
      doneCriteria: ["review child handoff", "Produce phase evidence: managed-agent-review."],
      residualRiskRequired: false,
    });
    expect(missingInvocationOutput.managedInvocationRequest?.task).toContain("Execute delegated work.");
    expect(workItemStore.get(item.id)?.status).toBe("pending");

    const started = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        governanceRecommendation: "orchestrate",
        managedInvocationId: "invocation-managed-1",
      },
    });

    expect(started?.isError).toBe(false);
    expect(started?.metadata).toMatchObject({
      operation: "execution_started",
      attempt: {
        executionMode: "managed_delegation",
        managedInvocationId: "invocation-managed-1",
      },
    });
  });

  it("does not report providerRoute.providerId missing when a managed route id is already selected", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-route",
      summary: "Execute delegated route-owned work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: ["review child handoff"],
      goalRunId: "goal-managed-route",
      routeId: "opencode-go-frontend-approved-write",
      assignedAgentProfile: "frontend-coder",
      authorityProfile: "foundation-apply-approved-writes",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-route",
      objective: "Execute delegated route-owned work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: {
        workflowProfile: "managed-agent-change",
        managedAgentProfile: "frontend-coder",
      },
      evidenceRequirements: [],
    });
    const startTool = createWorkGovernanceTools(policy, { workItemStore, goalRunStore })
      .find((candidate) => candidate.name === "work_item.execution.start");

    const missingInvocation = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        governanceRecommendation: "orchestrate",
      },
    });
    const output = JSON.parse(missingInvocation?.output ?? "{}") as {
      readonly missingManagedInvocationFields?: readonly string[];
      readonly managedInvocationRequest?: {
        readonly routeId?: string;
        readonly agentProfile?: string;
        readonly providerRoute?: { readonly providerId?: string };
      };
    };

    expect(missingInvocation?.isError).toBe(true);
    expect(output.managedInvocationRequest).toMatchObject({
      routeId: "opencode-go-frontend-approved-write",
      agentProfile: "frontend-coder",
    });
    expect(output.managedInvocationRequest?.providerRoute).toBeUndefined();
    expect(output.missingManagedInvocationFields).toBeUndefined();
  });

  it("scopes managed UI work to the next missing execution phase instead of the whole work item", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-ui-phase",
      summary: "Refactor the GUI experience.",
      workflowProfile: "ui-change",
      triggers: ["ui", "cross-surface"],
      expectedEvidence: [
        "surface-map",
        "risk-hypothesis",
        "visual-reference-research",
        "tests",
        "typecheck",
        "browser-qa",
        "residual-risk",
      ],
      verificationGates: ["browser QA screenshot or interaction proof", "typecheck"],
      goalRunId: "goal-managed-ui-phase",
      routeId: "opencode-go-frontend-approved-write",
      phaseRoutes: {
        "visual-reference-research": "opencode-go-qwen3-6-plus-readonly",
      },
      referenceRoots: ["/workspace/references/cloned"],
      assignedAgentProfile: "frontend-coder",
      authorityProfile: "foundation-apply-approved-writes",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-ui-phase",
      objective: "Refactor the GUI experience.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved UI work.",
      },
      routePolicy: {
        workflowProfile: "ui-change",
      },
      evidenceRequirements: [],
    });
    const startTool = createWorkGovernanceTools(policy, { workItemStore, goalRunStore })
      .find((candidate) => candidate.name === "work_item.execution.start");

    const missingInvocation = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        governanceRecommendation: "orchestrate",
        managedProviderId: "opencode-go",
        managedModel: "kimi-k2.6",
      },
    });
    const output = JSON.parse(missingInvocation?.output ?? "{}") as {
      readonly managedInvocationRequest?: {
        readonly profile?: string;
        readonly routeId?: string;
        readonly agentProfile?: string;
        readonly forbiddenInputFields?: readonly string[];
        readonly providerRoute?: {
          readonly providerId?: string;
          readonly model?: string;
        };
        readonly executionPhase?: {
          readonly id?: string;
          readonly expectedEvidence?: readonly string[];
          readonly requiredToolNames?: readonly string[];
          readonly remainingEvidenceAfterPhase?: readonly string[];
          readonly completionTool?: string;
          readonly finalPhase?: boolean;
          readonly autoStartAllowed?: boolean;
        };
        readonly expectedEvidence?: readonly string[];
        readonly requiredToolNames?: readonly string[];
        readonly requiredReadPaths?: readonly string[];
        readonly doneCriteria?: readonly string[];
        readonly task?: string;
      };
      readonly missingManagedInvocationFields?: readonly string[];
    };

    expect(missingInvocation?.isError).toBe(true);
    expect(output.managedInvocationRequest).toMatchObject({
      profile: "foundation-readonly-plan",
      routeId: "opencode-go-qwen3-6-plus-readonly",
      forbiddenInputFields: ["agentProfile"],
      providerRoute: {
        providerId: "opencode-go",
      },
    });
    expect(output.managedInvocationRequest?.agentProfile).toBeUndefined();
    expect(output.managedInvocationRequest?.providerRoute?.model).toBeUndefined();
    expect(output.missingManagedInvocationFields).toBeUndefined();
    expect(output.managedInvocationRequest?.executionPhase).toMatchObject({
      id: "visual-reference-research",
      expectedEvidence: ["visual-reference-research"],
      requiredToolNames: ["read", "glob", "grep"],
      completionTool: "work_item.update",
      finalPhase: false,
      autoStartAllowed: false,
    });
    expect(output.managedInvocationRequest?.executionPhase?.remainingEvidenceAfterPhase).toEqual([
      "surface-map",
      "risk-hypothesis",
      "tests",
      "typecheck",
      "browser-qa",
      "residual-risk",
    ]);
    expect(output.managedInvocationRequest?.expectedEvidence).toEqual(["visual-reference-research"]);
    expect(output.managedInvocationRequest?.requiredToolNames).toEqual([
      "read",
      "glob",
      "grep",
    ]);
    expect(output.managedInvocationRequest?.requiredReadPaths).toEqual([
      "/workspace/references/cloned",
    ]);
    expect(output.managedInvocationRequest?.doneCriteria).toEqual([
      "Produce phase evidence: visual-reference-research.",
      "Stop after phase visual-reference-research; record evidence with work_item.update before requesting the next phase.",
    ]);
    expect(output.managedInvocationRequest?.task).toContain("Produce only this phase evidence: visual-reference-research.");
    expect(output.managedInvocationRequest?.task).toContain("Use read-only frontend-reference research authority.");
    expect(output.managedInvocationRequest?.task).toContain("Required reference roots: /workspace/references/cloned.");
    expect(output.managedInvocationRequest?.task).toContain("inspect each required reference root enough to cite concrete frontend source paths");
    expect(output.managedInvocationRequest?.task).toContain("analysis of only this Kiln repository does not satisfy this phase");
    expect(output.managedInvocationRequest?.task).toContain("This phase requires route tools: read, glob, grep.");
    expect(output.managedInvocationRequest?.task).toContain("Do not expand into later phases.");
  });

  it("keeps explicit work item authority ahead of caller-supplied readonly managed hints", async () => {
    const goalRunStore = new GoalRunStore({ now: fixedNow });
    const workItemStore = new WorkItemStore({ now: fixedNow });
    const item = workItemStore.upsert({
      id: "work-managed-authority",
      summary: "Execute delegated route-owned work.",
      workflowProfile: "managed-agent-change",
      triggers: ["managed-agents"],
      expectedEvidence: ["managed-agent-review"],
      verificationGates: ["review child handoff"],
      goalRunId: "goal-managed-authority",
      routeId: "opencode-go-frontend-approved-write",
      assignedAgentProfile: "frontend-coder",
      authorityProfile: "foundation-apply-approved-writes",
    });
    const goal = goalRunStore.create({
      id: "goal-managed-authority",
      objective: "Execute delegated route-owned work.",
      ownerSessionId: "session-1",
      planId: "plan-1",
      workItemIds: [item.id],
      authorityEnvelope: {
        maximumAuthority: "audited",
        escalationPolicy: "approval_required",
        reason: "Approved plan.",
      },
      routePolicy: {
        workflowProfile: "managed-agent-change",
        managedAgentProfile: "frontend-coder",
      },
      evidenceRequirements: [],
    });
    const startTool = createWorkGovernanceTools(policy, { workItemStore, goalRunStore })
      .find((candidate) => candidate.name === "work_item.execution.start");

    const missingInvocation = await startTool?.execute({
      name: "work_item.execution.start",
      input: {
        goalRunId: goal.id,
        governanceRecommendation: "orchestrate",
        managedProfile: "foundation-readonly-plan",
        requestedAuthority: "read_only",
      },
    });
    const output = JSON.parse(missingInvocation?.output ?? "{}") as {
      readonly managedInvocationRequest?: {
        readonly profile?: string;
        readonly requestedAuthority?: string;
        readonly routeId?: string;
      };
    };

    expect(missingInvocation?.isError).toBe(true);
    expect(output.managedInvocationRequest).toMatchObject({
      profile: "foundation-apply-approved-writes",
      requestedAuthority: "audited",
      routeId: "opencode-go-frontend-approved-write",
    });
  });
});

function fixedNow(): string {
  return "2026-05-12T20:00:00.000Z";
}
