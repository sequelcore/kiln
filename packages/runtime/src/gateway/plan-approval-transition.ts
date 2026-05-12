import {
  createSessionEvent,
  PlanStateStore,
  type CanonicalPlanAnalysisReportedEvent,
  type CanonicalPlanSubmittedEvent,
  type CanonicalSessionEvent,
  type PlanSubmissionInput,
  type SessionEventSurface,
  type SessionPlan,
} from "@kilnai/core";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
import type { RuntimeSession } from "../session/runtime-session.js";
import type { SessionRegistry } from "../session/session-registry.js";
import type { AttachedRuntimeBuiltinToolSurface } from "./attached-runtime-tool-surface.js";

export type PlanApprovalTransitionResult =
  | {
      readonly ok: true;
      readonly frame: Extract<GuiInboundFrame, { type: "execution_mode_transitioned" }>;
      readonly event: CanonicalSessionEvent;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

export async function approvePlanExecutionTransition(input: {
  readonly surfaces: readonly AttachedRuntimeBuiltinToolSurface[];
  readonly planId?: string;
  readonly sessionRegistry: SessionRegistry;
  readonly appName: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly operatorId?: string;
  readonly residualRiskAcknowledged?: boolean;
  readonly residualRiskAcknowledgement?: string;
  readonly sourceSurface: SessionEventSurface;
  readonly component: string;
  readonly now?: () => Date;
}): Promise<PlanApprovalTransitionResult> {
  const session = await input.sessionRegistry.get(input.appName, input.userId, input.tenantId);
  if (!session) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_NO_SESSION",
      message: "No active session is available for plan approval.",
    };
  }

  const surface = findPlanSurface(input.surfaces, input.planId);
  const recovered = surface?.planStateStore
    ? undefined
    : recoverPlanApprovalContext(session, input.planId, input.now);
  if (recovered?.ok === false) {
    return {
      ok: false,
      code: recovered.code,
      message: recovered.message,
    };
  }
  const planStateStore = surface?.planStateStore ?? recovered?.planStateStore;
  if (!planStateStore) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_NO_PLAN_SURFACE",
      message: input.planId
        ? `No plan artifact found for '${input.planId}'.`
        : "No plan artifact is available for execution approval.",
    };
  }

  const plan = input.planId
    ? planStateStore.getPlan(input.planId)
    : planStateStore.latestPlan();
  if (!plan) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_NO_PLAN_ARTIFACT",
      message: input.planId
        ? `No plan artifact found for '${input.planId}'.`
        : "No plan artifact is available for execution approval.",
    };
  }
  if (plan.status !== "ready_for_approval") {
    return {
      ok: false,
      code: "PLAN_APPROVAL_PLAN_NOT_READY_FOR_APPROVAL",
      message: `Plan ${plan.id} is not ready for approval.`,
    };
  }

  const latestAnalysisReport = surface?.analysisStateStore?.listReports()
    .filter((report) => report.planId === plan.id)
    .at(-1) ?? recovered?.latestAnalysisReport;
  if (!latestAnalysisReport) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_ANALYSIS_REQUIRED",
      message: `Plan ${plan.id} cannot be approved until a plan/spec analysis report exists.`,
    };
  }
  if (latestAnalysisReport.status === "blocked" || latestAnalysisReport.blockingFindingIds.length > 0) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_ANALYSIS_BLOCKED",
      message: `Plan ${plan.id} cannot be approved while blocking analysis findings remain open: ${latestAnalysisReport.blockingFindingIds.join(", ")}.`,
    };
  }

  const residualRiskAcknowledged = input.residualRiskAcknowledged === true;
  const residualRiskAcknowledgement = input.residualRiskAcknowledgement?.trim();
  if (requiresResidualRiskAcknowledgement(plan) && !residualRiskAcknowledged) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_RESIDUAL_RISK_ACK_REQUIRED",
      message: `Plan ${plan.id} has residual risks that must be acknowledged before execution approval.`,
    };
  }

  const approvalResult = planStateStore.approvePlan(plan.id);
  if (!approvalResult.success) {
    return {
      ok: false,
      code: `PLAN_APPROVAL_${approvalResult.code.toUpperCase()}`,
      message: approvalResult.message,
    };
  }

  const readiness = planStateStore.executionReadiness(approvalResult.planId);
  if (!readiness.success || !readiness.ready) {
    return {
      ok: false,
      code: readiness.success
        ? `PLAN_APPROVAL_${readiness.code.toUpperCase()}`
        : `PLAN_APPROVAL_${readiness.code.toUpperCase()}`,
      message: readiness.message,
    };
  }

  const timestamp = input.now?.() ?? new Date();
  const approvedBy = input.operatorId?.trim() || input.userId;
  const event = createSessionEvent<"plan_approved">({
    kilnSessionId: session.id,
    sequence: session.nextSessionEventSequence(),
    kind: "plan_approved",
    planId: approvalResult.planId,
    approvalId: approvalResult.approval.approvalId,
    planHash: approvalResult.approval.planHash,
    approvedBy,
    approvedAt: timestamp.toISOString(),
    residualRiskAcknowledged,
    ...(residualRiskAcknowledgement ? { residualRiskAcknowledgement } : {}),
    fromMode: "plan",
    toMode: "execute",
    source: {
      actor: "runtime",
      surface: input.sourceSurface,
      component: input.component,
    },
    timestamp,
  });
  session.appendSessionEvents([event]);
  await input.sessionRegistry.save(session);

  return {
    ok: true,
    event,
    frame: {
      type: "execution_mode_transitioned",
      executionMode: "execute",
      planId: approvalResult.planId,
      approvalId: approvalResult.approval.approvalId,
      planHash: approvalResult.approval.planHash,
    },
  };
}

type ApprovalAnalysisReport = Pick<
  CanonicalPlanAnalysisReportedEvent,
  "planId" | "status" | "blockingFindingIds"
>;

type RecoveredPlanApprovalContext =
  | {
      readonly ok: true;
      readonly planStateStore: PlanStateStore;
      readonly latestAnalysisReport?: ApprovalAnalysisReport;
    }
  | {
      readonly ok: false;
      readonly code: string;
      readonly message: string;
    };

function recoverPlanApprovalContext(
  session: RuntimeSession,
  planId: string | undefined,
  now: (() => Date) | undefined,
): RecoveredPlanApprovalContext | undefined {
  const planEvent = session.sessionEvents
    .filter(isPlanSubmittedEvent)
    .filter((event) => !planId || event.planId === planId)
    .at(-1);
  if (!planEvent) {
    return undefined;
  }

  const planStateStore = new PlanStateStore({
    now: () => now?.().getTime() ?? Date.now(),
  });
  const plan = planStateStore.submitPlan(planSubmissionInputFromEvent(planEvent));
  if (planEvent.planHash && plan.contentHash !== planEvent.planHash) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_RECOVERED_PLAN_HASH_MISMATCH",
      message: `Recovered plan ${plan.id} hash does not match the canonical plan_submitted event.`,
    };
  }

  const latestAnalysisReport = session.sessionEvents
    .filter(isPlanAnalysisReportedEvent)
    .filter((event) => event.planId === plan.id && event.sequence > planEvent.sequence)
    .at(-1)
    ?? session.sessionEvents
      .filter(isPlanAnalysisReportedEvent)
      .filter((event) => event.planId === plan.id)
      .at(-1);

  return {
    ok: true,
    planStateStore,
    ...(latestAnalysisReport ? { latestAnalysisReport } : {}),
  };
}

function planSubmissionInputFromEvent(event: CanonicalPlanSubmittedEvent): PlanSubmissionInput {
  return {
    planId: event.planId,
    objective: event.objective,
    nonGoals: event.nonGoals ?? [],
    operatorDecisionsRequired: event.operatorDecisionsRequired ?? [],
    assumptions: event.assumptions ?? [],
    affectedSurfaces: event.affectedSurfaces ?? [],
    riskClassification: event.riskClassification,
    workGovernanceRecommendation: {
      posture: event.workGovernancePosture,
      rationale: event.workGovernanceRationale,
      workflowProfile: isWorkflowProfile(event.workflowProfile) ? event.workflowProfile : "verification-heavy",
    },
    proposedWorkItems: (event.proposedWorkItems ?? []).map((item) => ({
      id: item.id,
      summary: item.summary,
      workflowProfile: isWorkflowProfile(item.workflowProfile) ? item.workflowProfile : "verification-heavy",
      risk: item.risk,
      expectedEvidence: item.expectedEvidence ?? [],
      verificationGates: item.verificationGates ?? [],
      dependencies: item.dependencies ?? [],
    })),
    expectedEvidence: event.expectedEvidence ?? [],
    verificationGates: event.verificationGates ?? [],
    managedAgentDelegationCandidates: event.managedAgentDelegationCandidates ?? [],
    approvalBoundaries: event.approvalBoundaries ?? [],
    rollbackNotes: event.rollbackNotes,
    residualRisks: event.residualRisks ?? [],
    sourceSpecificationId: event.sourceSpecificationId,
    clarificationRecordIds: event.clarificationRecordIds ?? [],
    constitutionSnapshot: {
      instructionProfileHash: event.constitutionSnapshotHash,
      instructionProfileIds: event.constitutionSnapshotIds ?? [],
    },
  };
}

function isPlanSubmittedEvent(event: CanonicalSessionEvent): event is CanonicalPlanSubmittedEvent {
  return event.kind === "plan_submitted";
}

function isPlanAnalysisReportedEvent(event: CanonicalSessionEvent): event is CanonicalPlanAnalysisReportedEvent {
  return event.kind === "plan_analysis_reported";
}

function requiresResidualRiskAcknowledgement(plan: SessionPlan): boolean {
  if (plan.residualRisks.length === 0) {
    return false;
  }
  return plan.riskClassification === "high"
    || plan.riskClassification === "critical"
    || isHighControlWorkflowProfile(plan.workGovernanceRecommendation.workflowProfile);
}

function isHighControlWorkflowProfile(value: string): boolean {
  return value === "architecture-change"
    || value === "managed-agent-change"
    || value === "verification-heavy"
    || value === "formal-proof-candidate";
}

function isWorkflowProfile(value: string): value is PlanSubmissionInput["workGovernanceRecommendation"]["workflowProfile"] {
  return value === "small-fix"
    || value === "bug-diagnosis"
    || value === "architecture-change"
    || value === "ui-change"
    || value === "managed-agent-change"
    || value === "config-change"
    || value === "verification-heavy"
    || value === "formal-proof-candidate";
}

function findPlanSurface(
  surfaces: readonly AttachedRuntimeBuiltinToolSurface[],
  planId: string | undefined,
): AttachedRuntimeBuiltinToolSurface | undefined {
  for (const surface of surfaces) {
    const store = surface.planStateStore;
    if (!store) {
      continue;
    }
    if (planId) {
      if (store.getPlan(planId)) {
        return surface;
      }
      continue;
    }
    if (store.latestPlan()) {
      return surface;
    }
  }
  return undefined;
}
