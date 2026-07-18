import { containsFrontendReferenceEvidence } from "@kilnai/core";
import type { ManagedAgentResultHandoff, WorkItemExecutionFailureReason } from "@kilnai/core";

export const VISUAL_REFERENCE_PHASE_ID = "visual-reference-research";

export function buildManagedInvocationPhaseRecovery(
  request: Record<string, unknown> | undefined,
  failureReason: WorkItemExecutionFailureReason = "failed",
): Record<string, unknown> | undefined {
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_evidence_required",
    reason: "Managed child failed before recording an intermediate execution phase. If the parent completes this evidence locally, it must record the phase before replying or starting the next phase.",
    includeResultResources: false,
    failureReason,
  });
}

export function managedInvocationFailureReasonFromStatus(status: unknown): WorkItemExecutionFailureReason {
  switch (status) {
    case "denied":
      return "denied";
    case "unavailable":
      return "unavailable";
    case "timed_out":
    case "timed-out":
      return "timed_out";
    case "cancelled":
      return "cancelled";
    case "skipped":
      return "skipped";
    case "failed":
    default:
      return "failed";
  }
}

export function buildManagedInvocationPhaseCompletion(
  request: Record<string, unknown> | undefined,
  resultHandoff: ManagedAgentResultHandoff | undefined,
  invocationId: string,
): Record<string, unknown> | undefined {
  const evidenceDisposition = resolvePhaseEvidenceDisposition(request, resultHandoff);
  if (!evidenceDisposition) {
    return undefined;
  }
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_completed_by_child",
    reason: "Managed child completed a validated execution phase. Runtime owns evidence recording and progression on the same work item.",
    includeResultResources: true,
    resultHandoff,
    invocationId,
    evidenceDisposition,
  });
}

export function buildManagedInvocationPhaseHandoffRecovery(
  request: Record<string, unknown> | undefined,
  resultHandoff: ManagedAgentResultHandoff | undefined,
): Record<string, unknown> | undefined {
  if (resolvePhaseEvidenceDisposition(request, resultHandoff)) {
    return undefined;
  }
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_evidence_required",
    reason: "Managed child completed with a no-handoff or otherwise unacceptable phase result. Inspect the transcript, continue recovery with admitted tools, and record the phase only after required evidence, approvals, and verification have passed.",
    includeResultResources: true,
    resultHandoff,
    failureReason: resultHandoff?.structuredResult?.status === "cancelled" ? "cancelled" : "failed",
  });
}

function buildManagedInvocationPhaseAction(
  request: Record<string, unknown> | undefined,
  options: {
    readonly status: "phase_evidence_required" | "phase_completed_by_child";
    readonly reason: string;
    readonly includeResultResources: boolean;
    readonly resultHandoff?: ManagedAgentResultHandoff;
    readonly failureReason?: WorkItemExecutionFailureReason;
    readonly invocationId?: string;
    readonly evidenceDisposition?: PhaseEvidenceDisposition;
  },
): Record<string, unknown> | undefined {
  const phase = readRecord(request?.executionPhase);
  const completionTool = readText(phase?.completionTool);
  if (
    !request
    || !phase
    || (completionTool !== "work_item.update" && completionTool !== "work_item.execution.finish")
  ) {
    return undefined;
  }
  const workItemId = readText(request.workItemId);
  const goalRunId = readText(request.goalRunId);
  const evidenceToRecord = readTextArray(phase.expectedEvidence);
  const verificationRequirementIds = readTextArray(phase.verificationRequirementIds);
  if (
    !workItemId
    || (evidenceToRecord.length === 0 && verificationRequirementIds.length === 0)
  ) {
    return undefined;
  }
  const summary = readText(request.summary)
    ?? readText(request.task)
    ?? `Record managed evidence for ${workItemId}.`;
  const phaseRequiredTools = readTextArray(phase.requiredToolNames);
  const requestRequiredTools = readTextArray(request.requiredToolNames);
  const requiredToolNames = phaseRequiredTools.length > 0 ? phaseRequiredTools : requestRequiredTools;
  const requiredReadPaths = readTextArray(request.requiredReadPaths);
  const visualReferenceRecovery = evidenceToRecord.includes(VISUAL_REFERENCE_PHASE_ID)
    ? visualReferenceRecoveryContract(requiredReadPaths)
    : undefined;
  const sourceResourceUris = options.includeResultResources
    ? options.resultHandoff?.resourceUris.filter((uri) => readText(uri) !== undefined) ?? []
    : [];
  const providedEvidence = options.evidenceDisposition?.providedEvidence ?? [];
  const skippedVerificationGates = options.evidenceDisposition?.skippedVerificationGates ?? [];
  const verificationGateResults = options.evidenceDisposition?.verificationGateResults ?? [];
  const residualRisk = options.evidenceDisposition?.residualRisk;
  if (completionTool === "work_item.execution.finish") {
    if (options.status === "phase_evidence_required") {
      return {
        status: options.status,
        reason: options.reason,
        nextTool: "work_item.update",
        workItemId,
        ...(goalRunId ? { goalRunId } : {}),
        evidenceToRecord,
        ...(requiredToolNames.length > 0 ? { requiredToolNames } : {}),
        ...(sourceResourceUris.length > 0
          ? {
              sourceResourceUris,
              inspectionTool: "resource_read",
              inspection: "Use resource_read on sourceResourceUris when the managed handoff content is needed before recording failure evidence.",
            }
          : {}),
        blockedWorkItemUpdateInputTemplate: {
          id: workItemId,
          status: "blocked",
          summary: `Managed invocation did not produce a verified handoff for ${summary}`,
          pauseRequirements: [{
            id: "managed-invocation-capability",
            kind: "capability",
            summary: options.resultHandoff?.summary
              ?? `Managed invocation ${options.failureReason ?? "failed"}: ${options.reason}`,
            status: "pending",
          }],
        },
        ...(readText(phase.instruction) ? { instruction: readText(phase.instruction) } : {}),
      };
    }
    if (!goalRunId || !options.invocationId) {
      return undefined;
    }
    return {
      status: options.status,
      reason: options.reason,
      nextTool: "work_item.execution.start",
      workItemId,
      goalRunId,
      evidenceToRecord,
      ...(requiredToolNames.length > 0 ? { requiredToolNames } : {}),
      ...(sourceResourceUris.length > 0
        ? {
            sourceResourceUris,
            inspectionTool: "resource_read",
            inspection: "Use resource_read on sourceResourceUris when the managed handoff content is needed before recording evidence.",
          }
        : {}),
      workItemExecutionStartInputTemplate: {
        goalRunId,
        workItemId,
        managedInvocationId: options.invocationId,
      },
      workItemExecutionFinishInputTemplate: {
        goalRunId,
        workItemId,
        providedEvidence,
        skippedVerificationGates,
        verificationGateResults,
        ...(residualRisk ? { residualRisk } : {}),
        summary: options.resultHandoff?.summary ?? summary,
      },
      ...(readText(phase.instruction) ? { instruction: readText(phase.instruction) } : {}),
    };
  }
  return {
    status: options.status,
    reason: options.reason,
    nextTool: "work_item.update",
    workItemId,
    evidenceToRecord,
    ...(requiredToolNames.length > 0 ? { requiredToolNames } : {}),
    ...(requiredReadPaths.length > 0 ? { requiredReadPaths } : {}),
    ...(sourceResourceUris.length > 0
      ? {
          sourceResourceUris,
          inspectionTool: "resource_read",
          inspection: "Use resource_read on sourceResourceUris when the managed handoff content is needed before recording evidence.",
        }
      : {}),
    ...(visualReferenceRecovery ?? {}),
    workItemUpdateInputTemplate: {
      id: workItemId,
      summary,
      providedEvidence,
      skippedVerificationGates,
      verificationGateResults,
      ...(residualRisk ? { residualRisk } : {}),
      ...(options.status === "phase_evidence_required" && visualReferenceRecovery?.verificationGateResults
        ? { verificationGateResults: visualReferenceRecovery.verificationGateResults }
        : {}),
    },
    ...(options.status === "phase_evidence_required"
      ? {
          blockedWorkItemUpdateInputTemplate: {
            id: workItemId,
            status: "blocked",
            summary: `Managed invocation recovery is blocked for ${summary}`,
            pauseRequirements: [{
              id: "managed-invocation-handoff-recovery",
              kind: "operator_input",
              summary: "Managed child completed without substantive phase evidence, and source resources did not contain qualifying governed evidence after inspection.",
              status: "pending",
            }],
          },
          blockedWhen: "Use blockedWorkItemUpdateInputTemplate if sourceResourceUris and local recovery cannot produce qualifying evidence. Do not record providedEvidence or continue execution in that case.",
        }
      : {}),
    thenTool: "work_item.execution.start",
    then: "Attached runtime surfaces record this transition and request the next phase automatically. Tool surfaces without mutation capability must expose this transition as a pause.",
    ...(readText(phase.instruction) ? { instruction: readText(phase.instruction) } : {}),
  };
}

interface PhaseEvidenceDisposition {
  readonly providedEvidence: readonly string[];
  readonly skippedVerificationGates: readonly string[];
  readonly verificationGateResults: readonly {
    readonly gate: string;
    readonly status: "passed" | "failed" | "skipped";
    readonly summary?: string;
    readonly evidence?: readonly string[];
  }[];
  readonly residualRisk?: string;
}

function resolvePhaseEvidenceDisposition(
  request: Record<string, unknown> | undefined,
  resultHandoff: ManagedAgentResultHandoff | undefined,
): PhaseEvidenceDisposition | undefined {
  const phase = readRecord(request?.executionPhase);
  const completionTool = readText(phase?.completionTool);
  if (
    !request
    || !phase
    || (completionTool !== "work_item.update" && completionTool !== "work_item.execution.finish")
  ) {
    return { providedEvidence: [], skippedVerificationGates: [], verificationGateResults: [] };
  }
  const evidenceToRecord = readTextArray(phase.expectedEvidence);
  const verificationRequirementIds = readTextArray(phase.verificationRequirementIds);
  if (evidenceToRecord.length === 0 && verificationRequirementIds.length === 0) {
    return { providedEvidence: [], skippedVerificationGates: [], verificationGateResults: [] };
  }
  const summary = resultHandoff?.summary.trim() ?? "";
  const resourceUris = resultHandoff?.resourceUris ?? [];
  if (summary.length === 0 || resourceUris.length === 0) {
    return undefined;
  }
  const structuredResult = resultHandoff?.structuredResult;
  if (structuredResult) {
    if (structuredResult.status !== "completed") {
      return undefined;
    }
    if (structuredResult.approvalRequirements.some((requirement) => requirement.status !== "approved")) {
      return undefined;
    }
  } else {
    return undefined;
  }
  const normalized = summary.toLowerCase();
  if (
    normalized === "direct provider managed invocation completed."
    || normalized === "managed invocation completed."
    || normalized.startsWith("direct provider managed invocation finished without final handoff text.")
  ) {
    return undefined;
  }
  if (evidenceToRecord.includes(VISUAL_REFERENCE_PHASE_ID)) {
    if (!containsFrontendReferenceEvidence(summary)) return undefined;
  }
  const requiredResultIds = verificationRequirementIds.length > 0
    ? verificationRequirementIds
    : evidenceToRecord;
  const expectedResults = requiredResultIds.map((requirementId) => ({
    requirementId,
    results: structuredResult.verificationResults.filter((result) => result.requirementId === requirementId),
  }));
  if (expectedResults.some(({ results }) => results.length !== 1)) {
    return undefined;
  }
  const resolvedExpectedResults = expectedResults.map(({ requirementId, results }) => ({
    requirementId,
    result: results[0]!,
  }));
  if (resolvedExpectedResults.some(({ result }) => result.status === "failed" || result.status === "inconclusive")) {
    return undefined;
  }
  const skippedVerificationGates = resolvedExpectedResults
    .filter(({ result }) => result?.status === "skipped")
    .map(({ requirementId }) => requirementId);
  const residualRisk = structuredResult.residualRisks.join(" ").trim();
  if (skippedVerificationGates.length > 0 && residualRisk.length === 0) {
    return undefined;
  }
  return {
    providedEvidence: resolvedExpectedResults
      .filter(({ requirementId, result }) =>
        result?.status === "passed" && evidenceToRecord.includes(requirementId))
      .map(({ requirementId }) => requirementId),
    skippedVerificationGates,
    verificationGateResults: resolvedExpectedResults.map(({ requirementId, result }) => ({
      gate: requirementId,
      status: result!.status as "passed" | "failed" | "skipped",
      ...(result!.summary || requirementId === VISUAL_REFERENCE_PHASE_ID
        ? { summary: [requirementId === VISUAL_REFERENCE_PHASE_ID ? summary : "", result!.summary ?? ""].filter(Boolean).join(" ") }
        : {}),
      ...(result!.evidenceUris.length > 0 ? { evidence: result!.evidenceUris } : {}),
    })),
    ...(residualRisk ? { residualRisk } : {}),
  };
}

function visualReferenceRecoveryContract(requiredReadPaths: readonly string[]): {
  readonly requiredReadPaths?: readonly string[];
  readonly validEvidence: readonly string[];
  readonly invalidEvidence: readonly string[];
  readonly localRecoveryInstructions: readonly string[];
  readonly verificationGateResults: readonly Record<string, unknown>[];
} {
  return {
    ...(requiredReadPaths.length > 0 ? { requiredReadPaths } : {}),
    validEvidence: [
      "running product UI screenshot",
      "demo or video frame",
      "embedded README product image",
      "docs product image",
      "code-backed frontend implementation evidence when the reference has no public screenshots",
      "source URLs or local source paths plus relevant frontend file paths and reusable design principles",
      "comparable real technical workstation UI screenshot with source URL",
    ],
    invalidEvidence: [
      "GitHub repository chrome",
      "raw file listings without frontend implementation analysis",
      "README text without product UI imagery",
      "stars/forks/issues/navigation screenshots",
      "code browser screenshots without component/layout evidence",
    ],
    localRecoveryInstructions: [
      "Continue read-only frontend-reference research before replying.",
      "Prefer actual running-product UI captures when available; if none are available, explicitly state that and inspect frontend implementation files instead.",
      ...(requiredReadPaths.length > 0
        ? [`Inspect each required read path before recording evidence: ${requiredReadPaths.join("; ")}.`]
        : []),
      "A raw file listing or analysis of only the current project does not satisfy a reference-root visual phase.",
      "Record source URLs or local source paths, relevant frontend file paths, component/layout/navigation patterns, and extracted reusable design principles.",
      "Only call work_item.update after the frontend-reference gate has passed with qualifying UI capture or code-backed frontend implementation evidence.",
      "If sourceResourceUris and local inspection still do not produce qualifying evidence, use blockedWorkItemUpdateInputTemplate instead of recording providedEvidence.",
    ],
    verificationGateResults: [{
      gate: "visual-reference-research: frontend-reference evidence before planning; running-product UI captures when available, or code-backed frontend implementation evidence when screenshots are unavailable; repository chrome, stars/forks/issues, and raw file listings alone do not count",
      status: "passed",
      summary: "<summarize qualifying frontend-reference evidence, source URLs or local source paths, relevant frontend file paths, and reusable design principles>",
      evidence: [
        "<source URL or local source path showing product UI capture or frontend implementation source>",
        "<relevant frontend file path or kiln:// artifact URI>",
      ],
    }],
  };
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readTextArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.map(readText).filter((item): item is string => item !== undefined)
    : [];
}
