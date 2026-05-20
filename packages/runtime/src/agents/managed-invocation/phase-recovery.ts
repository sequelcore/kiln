export const VISUAL_REFERENCE_PHASE_ID = "visual-reference-research";

interface ManagedInvocationPhaseResultHandoff {
  readonly summary: string;
  readonly resourceUris: readonly string[];
  readonly memoryWriteProposalUris: readonly string[];
}

export function buildManagedInvocationPhaseRecovery(
  request: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_evidence_required",
    reason: "Managed child failed before recording an intermediate execution phase. If the parent completes this evidence locally, it must record the phase before replying or starting the next phase.",
    includeResultResources: false,
  });
}

export function buildManagedInvocationPhaseCompletion(
  request: Record<string, unknown> | undefined,
  resultHandoff: ManagedInvocationPhaseResultHandoff | undefined,
): Record<string, unknown> | undefined {
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_completed_by_child",
    reason: "Managed child completed an intermediate execution phase. Record the phase evidence on the same work item before replying or starting the next phase.",
    includeResultResources: true,
    resultHandoff,
  });
}

function buildManagedInvocationPhaseAction(
  request: Record<string, unknown> | undefined,
  options: {
    readonly status: "phase_evidence_required" | "phase_completed_by_child";
    readonly reason: string;
    readonly includeResultResources: boolean;
    readonly resultHandoff?: ManagedInvocationPhaseResultHandoff;
  },
): Record<string, unknown> | undefined {
  const phase = readRecord(request?.executionPhase);
  if (!request || !phase || readText(phase.completionTool) !== "work_item.update") {
    return undefined;
  }
  const workItemId = readText(request.workItemId);
  const evidenceToRecord = readTextArray(phase.expectedEvidence);
  if (!workItemId || evidenceToRecord.length === 0) {
    return undefined;
  }
  const summary = readText(request.summary)
    ?? readText(request.task)
    ?? `Record managed evidence for ${workItemId}.`;
  const phaseRequiredTools = readTextArray(phase.requiredToolNames);
  const requestRequiredTools = readTextArray(request.requiredToolNames);
  const requiredToolNames = phaseRequiredTools.length > 0 ? phaseRequiredTools : requestRequiredTools;
  const visualReferenceRecovery = evidenceToRecord.includes(VISUAL_REFERENCE_PHASE_ID)
    ? visualReferenceRecoveryContract()
    : undefined;
  const sourceResourceUris = options.includeResultResources
    ? options.resultHandoff?.resourceUris.filter((uri) => readText(uri) !== undefined) ?? []
    : [];
  return {
    status: options.status,
    reason: options.reason,
    nextTool: "work_item.update",
    workItemId,
    evidenceToRecord,
    ...(requiredToolNames.length > 0 ? { requiredToolNames } : {}),
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
      providedEvidence: evidenceToRecord,
      ...(visualReferenceRecovery?.verificationGateResults
        ? { verificationGateResults: visualReferenceRecovery.verificationGateResults }
        : {}),
    },
    thenTool: "work_item.execution.start",
    then: "After work_item.update records the phase evidence, call work_item.execution.start again for the next phase.",
    ...(readText(phase.instruction) ? { instruction: readText(phase.instruction) } : {}),
  };
}

function visualReferenceRecoveryContract(): {
  readonly validEvidence: readonly string[];
  readonly invalidEvidence: readonly string[];
  readonly localRecoveryInstructions: readonly string[];
  readonly verificationGateResults: readonly Record<string, unknown>[];
} {
  return {
    validEvidence: [
      "running product UI screenshot",
      "demo or video frame",
      "embedded README product image",
      "docs product image",
      "comparable real technical workstation UI screenshot with source URL",
    ],
    invalidEvidence: [
      "GitHub repository chrome",
      "file listings",
      "README text without product UI imagery",
      "stars/forks/issues/navigation screenshots",
      "code browser screenshots",
    ],
    localRecoveryInstructions: [
      "Continue read-only research with web/browser tools before replying.",
      "Prefer actual vLLM Studio product UI; if none is available, explicitly state that and use comparable real technical workstation UI references.",
      "Record source URLs, screenshot or artifact URIs, and extracted reusable design principles.",
      "Only call work_item.update after the visual-reference gate has passed with qualifying product UI evidence.",
    ],
    verificationGateResults: [{
      gate: "visual-reference-research: real product UI screenshots, demo/video frames, running-app captures, README images, docs images, or comparable real technical workstation UI references; repository chrome or code listings do not count",
      status: "passed",
      summary: "<summarize qualifying product UI evidence, source URLs, artifact URIs, and reusable design principles>",
      evidence: [
        "<source URL showing product UI or comparable technical workstation UI>",
        "<kiln:// artifact URI for screenshot/image evidence>",
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
