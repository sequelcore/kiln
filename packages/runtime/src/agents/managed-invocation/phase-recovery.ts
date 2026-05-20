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
  if (!hasSubstantivePhaseHandoff(request, resultHandoff)) {
    return undefined;
  }
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_completed_by_child",
    reason: "Managed child completed an intermediate execution phase. Record the phase evidence on the same work item before replying or starting the next phase.",
    includeResultResources: true,
    resultHandoff,
  });
}

export function buildManagedInvocationPhaseHandoffRecovery(
  request: Record<string, unknown> | undefined,
  resultHandoff: ManagedInvocationPhaseResultHandoff | undefined,
): Record<string, unknown> | undefined {
  if (hasSubstantivePhaseHandoff(request, resultHandoff)) {
    return undefined;
  }
  return buildManagedInvocationPhaseAction(request, {
    status: "phase_evidence_required",
    reason: "Managed child completed without substantive phase evidence. Treat this as a no-handoff result: inspect the transcript, continue recovery with admitted tools, and record the phase only after real frontend-reference evidence exists.",
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

function hasSubstantivePhaseHandoff(
  request: Record<string, unknown> | undefined,
  resultHandoff: ManagedInvocationPhaseResultHandoff | undefined,
): boolean {
  const phase = readRecord(request?.executionPhase);
  if (!request || !phase || readText(phase.completionTool) !== "work_item.update") {
    return true;
  }
  const evidenceToRecord = readTextArray(phase.expectedEvidence);
  if (evidenceToRecord.length === 0) {
    return true;
  }
  const summary = resultHandoff?.summary.trim() ?? "";
  const resourceUris = resultHandoff?.resourceUris ?? [];
  if (summary.length === 0 || resourceUris.length === 0) {
    return false;
  }
  const normalized = summary.toLowerCase();
  if (normalized === "direct provider managed invocation completed." || normalized === "managed invocation completed.") {
    return false;
  }
  if (evidenceToRecord.includes(VISUAL_REFERENCE_PHASE_ID)) {
    return hasFrontendReferenceEvidence(summary);
  }
  return true;
}

function hasFrontendReferenceEvidence(summary: string): boolean {
  return hasVisualReferenceEvidence(summary) || hasCodeBackedFrontendReferenceEvidence(summary);
}

function hasVisualReferenceEvidence(summary: string): boolean {
  const normalized = summary.toLowerCase();
  const hasVisualArtifact = /\b(screenshot|capture|demo|video frame|image|artifact|browser_observe|running app|docs image|readme image)\b/i.test(summary);
  const hasSource = /\bhttps?:\/\/|\bkiln:\/\//i.test(summary);
  const rejectsPlaceholder = normalized.includes("<source url") || normalized.includes("<kiln://");
  return hasVisualArtifact && hasSource && !rejectsPlaceholder;
}

function hasCodeBackedFrontendReferenceEvidence(summary: string): boolean {
  const normalized = summary.toLowerCase();
  const hasSource = /\bhttps?:\/\/|\bkiln:\/\//i.test(summary);
  const rejectsPlaceholder = normalized.includes("<source url") || normalized.includes("<kiln://");
  if (!hasSource || rejectsPlaceholder) {
    return false;
  }
  const hasFrontendPathOrPattern = /\b(frontend\/|src\/app|src\/components|\.tsx|\.jsx|\.css|component|layout|navigation|panel|work surface|composer|status area|typography|spacing|density)\b/i.test(summary);
  const declaresCodeBackedEvidence = /\b(frontend implementation|code-backed|component structure|layout pattern|navigation model|product ergonomics)\b/i.test(summary);
  return hasFrontendPathOrPattern && declaresCodeBackedEvidence;
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
      "code-backed frontend implementation evidence when the reference has no public screenshots",
      "source URLs plus relevant frontend file paths and reusable design principles",
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
      "Prefer actual vLLM Studio product UI captures if available; if none are available, explicitly state that and inspect frontend implementation files instead.",
      "Record source URLs, relevant frontend file paths, component/layout/navigation patterns, and extracted reusable design principles.",
      "Only call work_item.update after the frontend-reference gate has passed with qualifying UI capture or code-backed frontend implementation evidence.",
    ],
    verificationGateResults: [{
      gate: "visual-reference-research: frontend-reference evidence before planning; running-product UI captures when available, or code-backed frontend implementation evidence when screenshots are unavailable; repository chrome, stars/forks/issues, and raw file listings alone do not count",
      status: "passed",
      summary: "<summarize qualifying frontend-reference evidence, source URLs, relevant frontend file paths, and reusable design principles>",
      evidence: [
        "<source URL showing product UI capture or frontend implementation source>",
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
