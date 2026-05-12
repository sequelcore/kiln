import {
  createSessionEvent,
  type CanonicalSessionEvent,
  type SessionEventSurface,
} from "@kilnai/core";
import type { GuiInboundFrame } from "@kilnai/gateway-contracts";
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
  readonly sourceSurface: SessionEventSurface;
  readonly component: string;
  readonly now?: () => Date;
}): Promise<PlanApprovalTransitionResult> {
  const surface = findPlanSurface(input.surfaces, input.planId);
  if (!surface?.planStateStore) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_NO_PLAN_SURFACE",
      message: input.planId
        ? `No plan artifact found for '${input.planId}'.`
        : "No plan artifact is available for execution approval.",
    };
  }

  const session = await input.sessionRegistry.get(input.appName, input.userId, input.tenantId);
  if (!session) {
    return {
      ok: false,
      code: "PLAN_APPROVAL_NO_SESSION",
      message: "No active session is available for plan approval.",
    };
  }

  const plan = input.planId
    ? surface.planStateStore.getPlan(input.planId)
    : surface.planStateStore.latestPlan();
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

  const latestAnalysisReport = surface.analysisStateStore?.listReports()
    .filter((report) => report.planId === plan.id)
    .at(-1);
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

  const approvalResult = surface.planStateStore.approvePlan(input.planId);
  if (!approvalResult.success) {
    return {
      ok: false,
      code: `PLAN_APPROVAL_${approvalResult.code.toUpperCase()}`,
      message: approvalResult.message,
    };
  }

  const readiness = surface.planStateStore.executionReadiness(approvalResult.planId);
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
  const event = createSessionEvent<"plan_approved">({
    kilnSessionId: session.id,
    sequence: session.nextSessionEventSequence(),
    kind: "plan_approved",
    planId: approvalResult.planId,
    approvalId: approvalResult.approval.approvalId,
    planHash: approvalResult.approval.planHash,
    approvedAt: approvalResult.approval.approvedAt ?? approvalResult.approval.decidedAt,
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
