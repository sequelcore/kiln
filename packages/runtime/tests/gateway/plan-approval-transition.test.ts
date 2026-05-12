import { describe, expect, it } from "vitest";
import type { PlanSubmissionInput } from "@kilnai/core";
import { createAttachedRuntimeBuiltinToolSurface } from "../../src/gateway/attached-runtime-tool-surface.js";
import { approvePlanExecutionTransition } from "../../src/gateway/plan-approval-transition.js";
import { SessionRegistry } from "../../src/session/session-registry.js";

describe("approvePlanExecutionTransition", () => {
  it("approves the latest ready plan and appends a canonical plan_approved event", async () => {
    const registry = new SessionRegistry();
    const session = await registry.getOrCreate({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      systemPrompt: "You are a helpful assistant.",
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const plan = surface.planStateStore?.submitPlan(basePlanInput());
    expect(plan).toBeDefined();
    submitReadyAnalysis(surface, plan?.id);

    const result = await approvePlanExecutionTransition({
      surfaces: [surface],
      sessionRegistry: registry,
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      sourceSurface: "gui",
      component: "gui-gateway",
      now: () => new Date("2026-05-11T12:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok || !plan) return;
    expect(result.frame).toMatchObject({
      type: "execution_mode_transitioned",
      executionMode: "execute",
      planId: plan.id,
      planHash: plan.contentHash,
    });
    expect(result.event.kind).toBe("plan_approved");
    expect(result.event).toMatchObject({
      kilnSessionId: session.id,
      planId: plan.id,
      planHash: plan.contentHash,
      fromMode: "plan",
      toMode: "execute",
    });
    await expect(registry.getById(session.id).then((stored) => stored?.sessionEvents.at(-1)?.kind)).resolves.toBe("plan_approved");
  });

  it("fails closed when the selected plan has no analysis report", async () => {
    const registry = new SessionRegistry();
    await registry.getOrCreate({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      systemPrompt: "You are a helpful assistant.",
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    surface.planStateStore?.submitPlan(basePlanInput());

    const result = await approvePlanExecutionTransition({
      surfaces: [surface],
      sessionRegistry: registry,
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      sourceSurface: "gui",
      component: "gui-gateway",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PLAN_APPROVAL_ANALYSIS_REQUIRED",
    });
  });

  it("fails closed when the latest analysis report has blocking findings", async () => {
    const registry = new SessionRegistry();
    const session = await registry.getOrCreate({
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      systemPrompt: "You are a helpful assistant.",
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const plan = surface.planStateStore?.submitPlan({
      ...basePlanInput(),
      proposedWorkItems: [
        {
          id: "wi-1",
          summary: "Wire plan approval transition.",
          workflowProfile: "verification-heavy",
          risk: "medium",
          expectedEvidence: ["runtime tests"],
          verificationGates: ["bun run --filter @kilnai/runtime test"],
          dependencies: ["missing-work-item"],
        },
      ],
    });
    expect(plan).toBeDefined();
    submitReadyAnalysis(surface, plan?.id);

    const result = await approvePlanExecutionTransition({
      surfaces: [surface],
      sessionRegistry: registry,
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      sourceSurface: "gui",
      component: "gui-gateway",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PLAN_APPROVAL_ANALYSIS_BLOCKED",
    });
    expect(surface.planStateStore?.getPlan(plan!.id)?.approval).toBeUndefined();
    expect(session.sessionEvents).toHaveLength(0);
  });

  it("fails closed for malformed plans", async () => {
    const registry = new SessionRegistry();
    const session = await registry.getOrCreate({
      appName: "kiln-tui",
      tenantId: "_tui",
      userId: "operator-1",
      systemPrompt: "You are a helpful assistant.",
    });
    const surface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const plan = surface.planStateStore?.submitPlan({
      ...basePlanInput(),
      objective: " ",
    });
    expect(plan?.status).toBe("draft");

    const result = await approvePlanExecutionTransition({
      surfaces: [surface],
      sessionRegistry: registry,
      appName: "kiln-tui",
      tenantId: "_tui",
      userId: "operator-1",
      sourceSurface: "tui",
      component: "tui-gateway",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PLAN_APPROVAL_PLAN_NOT_READY_FOR_APPROVAL",
    });
    expect(session.sessionEvents).toHaveLength(0);
  });

  it("does not approve plan state when no active session exists", async () => {
    const surface = createAttachedRuntimeBuiltinToolSurface({ executionMode: "plan" });
    const plan = surface.planStateStore?.submitPlan(basePlanInput());
    expect(plan).toBeDefined();

    const result = await approvePlanExecutionTransition({
      surfaces: [surface],
      sessionRegistry: new SessionRegistry(),
      appName: "kiln-gui",
      tenantId: "_gui",
      userId: "operator-1",
      sourceSurface: "gui",
      component: "gui-gateway",
    });

    expect(result).toMatchObject({
      ok: false,
      code: "PLAN_APPROVAL_NO_SESSION",
    });
    expect(plan && surface.planStateStore?.getPlan(plan.id)?.approval).toBeUndefined();
  });
});

function basePlanInput(): PlanSubmissionInput {
  return {
    objective: "Approve Slice 4 execution.",
    nonGoals: ["Do not implement goal runs."],
    operatorDecisionsRequired: ["Operator approves the reviewed plan."],
    assumptions: ["Plan artifacts are retained in the active tool surface."],
    affectedSurfaces: ["runtime/gateway"],
    riskClassification: "medium",
    workGovernanceRecommendation: {
      posture: "orchestrate",
      rationale: "Cross-surface execution transition.",
      workflowProfile: "verification-heavy",
    },
    proposedWorkItems: [{
      id: "wi-1",
      summary: "Wire plan approval transition.",
      workflowProfile: "verification-heavy",
      risk: "medium",
      expectedEvidence: ["runtime tests"],
      verificationGates: ["bun run --filter @kilnai/runtime test"],
      dependencies: [],
    }],
    expectedEvidence: ["runtime tests"],
    verificationGates: ["typecheck"],
    managedAgentDelegationCandidates: [],
    approvalBoundaries: ["Approve only the current plan hash."],
    rollbackNotes: "Return to plan mode and revise the plan.",
    residualRisks: ["Reload persistence is handled by a later slice."],
    sourceSpecificationId: "spec_1",
    clarificationRecordIds: [],
    constitutionSnapshot: {
      instructionProfileHash: "profile-hash",
      instructionProfileIds: ["sequel-engineering"],
    },
  };
}

function submitReadyAnalysis(
  surface: ReturnType<typeof createAttachedRuntimeBuiltinToolSurface>,
  planId: string | undefined,
): void {
  const plan = planId ? surface.planStateStore?.getPlan(planId) : undefined;
  expect(plan).toBeDefined();
  const specification = surface.specificationStateStore?.upsertSpecification({
    title: "Plan approval analysis gate",
    objective: "Approve Slice 4 execution.",
    nonGoals: ["Do not implement goal runs."],
    successCriteria: ["Wire plan approval transition."],
    actors: [],
    dataLifecycle: "Session-scoped analysis reports.",
    uxEdgeCases: [],
    securityPrivacy: "No secrets.",
    externalDependencies: [],
    completionSignals: ["Runtime tests pass."],
    constitutionSnapshot: {
      instructionProfileHash: "profile-hash",
      instructionProfileIds: ["sequel-engineering"],
    },
  });
  expect(specification).toBeDefined();
  surface.analysisStateStore?.analyzePlan({ specification: specification!, plan: plan! });
}
