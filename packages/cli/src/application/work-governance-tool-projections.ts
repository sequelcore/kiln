import type {
  VerificationGateResult,
  WorkItem,
  WorkItemExecutionAttempt,
} from "@kilnai/core";
import {
  projectManagedOrchestrationAdoptionGate,
  projectManagedOrchestrationResultHandoff,
} from "@kilnai/core";
import type { GoalRun } from "@kilnai/core";

export function workItemToolOutputProjection(item: WorkItem): Record<string, unknown> {
  const latestAttempt = item.executionAttempts.at(-1);
  return {
    id: item.id,
    summary: boundedToolProjectionText(item.summary),
    status: item.status,
    workflowProfile: item.workflowProfile,
    ...(item.risk ? { risk: item.risk } : {}),
    triggers: item.triggers,
    ...(item.surface ? { surface: item.surface } : {}),
    ...(item.assignedAgentProfile ? { assignedAgentProfile: item.assignedAgentProfile } : {}),
    ...(item.routeId ? { routeId: item.routeId } : {}),
    ...(item.authority ? { authority: item.authority } : {}),
    ...(item.access ? { access: item.access } : {}),
    expectedEvidence: item.expectedEvidence,
    providedEvidence: item.providedEvidence,
    verificationGates: item.verificationGates,
    skippedVerificationGates: item.skippedVerificationGates,
    verificationGateResults: item.verificationGateResults.map(verificationGateResultToolOutputProjection),
    dependencies: item.dependencies,
    ...(item.residualRisk ? { residualRisk: boundedToolProjectionText(item.residualRisk) } : {}),
    pauseRequirements: item.pauseRequirements,
    ...(item.goalRunId ? { goalRunId: item.goalRunId } : {}),
    ...(item.workClassification ? { workClassification: item.workClassification } : {}),
    ...(item.workClassificationProvenance
      ? { workClassificationProvenance: item.workClassificationProvenance }
      : {}),
    ...(latestAttempt ? { latestAttempt: executionAttemptToolOutputProjection(latestAttempt) } : {}),
    managedOrchestrationResultHandoff: projectManagedOrchestrationResultHandoff(item),
    managedOrchestrationAdoptionGate: projectManagedOrchestrationAdoptionGate(item),
    resourceUri: `kiln://session/work-items/${encodeURIComponent(item.id)}`,
    updatedAt: item.updatedAt,
    sequence: item.sequence,
  };
}

export function executionAttemptToolOutputProjection(
  attempt: WorkItemExecutionAttempt,
): Record<string, unknown> {
  return {
    id: attempt.id,
    workItemId: attempt.workItemId,
    goalRunId: attempt.goalRunId,
    status: attempt.status,
    executionMode: attempt.executionMode,
    ...(attempt.managedInvocationId ? { managedInvocationId: attempt.managedInvocationId } : {}),
    hasManagedInvocationResultHandoff: attempt.managedInvocationResultHandoff !== undefined,
    providedEvidence: attempt.providedEvidence,
    missingEvidence: attempt.missingEvidence,
    missingResidualRisk: attempt.missingResidualRisk,
    skippedVerificationGates: attempt.skippedVerificationGates,
    verificationGateResults: attempt.verificationGateResults.map(verificationGateResultToolOutputProjection),
    ...(attempt.residualRisk ? { residualRisk: boundedToolProjectionText(attempt.residualRisk) } : {}),
    startedAt: attempt.startedAt,
    ...(attempt.completedAt ? { completedAt: attempt.completedAt } : {}),
    ...(attempt.candidate
      ? {
          candidateDigest: attempt.candidate.candidateDigest,
          candidateContentDigest: attempt.candidate.candidateContentDigest,
          candidateEvidence: attempt.candidateEvidence ?? [],
        }
      : {}),
  };
}

export function goalToolOutputProjection(goal: GoalRun): Record<string, unknown> {
  const recordedEvidence = new Set(goal.evidence.map((record) => record.requirementId));
  return {
    id: goal.id,
    objective: boundedToolProjectionText(goal.objective),
    status: goal.status,
    workItemIds: goal.workItemIds,
    ...(goal.currentPhase ? { currentPhase: goal.currentPhase } : {}),
    ...(goal.closeoutSummary ? { closeoutSummary: boundedToolProjectionText(goal.closeoutSummary) } : {}),
    ...(goal.boundedWorkCloseoutDecision
      ? {
          boundedWorkCloseout: {
            kind: goal.boundedWorkCloseoutDecision.kind,
            candidateDigest: goal.boundedWorkCloseoutDecision.candidateDigest,
            contractRevisionDigest: goal.boundedWorkCloseoutDecision.contractRevisionDigest,
            accountingRevision: goal.boundedWorkCloseoutDecision.accounting.revision,
          },
        }
      : {}),
    ...(goal.terminalReason ? { terminalReason: boundedToolProjectionText(goal.terminalReason) } : {}),
    createdAt: goal.createdAt,
    evidenceRequirements: goal.evidenceRequirements.map((requirement) => ({
      id: requirement.id,
      required: requirement.required,
      recorded: recordedEvidence.has(requirement.id),
    })),
    resourceUri: `kiln://session/goals/${encodeURIComponent(goal.id)}`,
    activeDurationMs: goal.activeDurationMs,
    ...(goal.activeSince ? { activeSince: goal.activeSince } : {}),
    updatedAt: goal.updatedAt,
    sequence: goal.sequence,
  };
}

function verificationGateResultToolOutputProjection(
  result: VerificationGateResult,
): Record<string, unknown> {
  return {
    gate: result.gate,
    status: result.status,
    ...(result.summary ? { summary: boundedToolProjectionText(result.summary, 240) } : {}),
    evidenceCount: result.evidence?.length ?? 0,
    ...(result.completedAt ? { completedAt: result.completedAt } : {}),
  };
}

function boundedToolProjectionText(value: string, maxLength = 480): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
