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
      agentProfile: "coder",
      roleIntent: "Execute governed work item work-managed for goal goal-managed.",
      expectedEvidence: ["managed-agent-review"],
      requiredResultFields: ["summary", "evidence", "checks"],
      doneCriteria: ["review child handoff", "Produce required evidence: managed-agent-review."],
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
});

function fixedNow(): string {
  return "2026-05-12T20:00:00.000Z";
}
