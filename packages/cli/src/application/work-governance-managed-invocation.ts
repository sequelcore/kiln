import type {
  DeliberationIntent,
  ManagedAgentResultField,
  ModelTaskSuitabilityTask,
  VerificationGateResult,
} from "@kilnai/core";
import {
  accountedWorkItemEvidence,
  containsFrontendReferenceEvidence,
  defineDeliberationLevelId,
  isCanonicalArtifactContentUri,
  isKilnWorkGovernanceEvidence,
} from "@kilnai/core";
import type { GoalExecutionStep, GoalRun } from "@kilnai/core";
import type { KilnWorkGovernanceEvidence } from "../kiln-yaml-types.js";
import {
  readText,
  readTextArray,
  requireInputRecord,
  uniqueText,
} from "./work-governance-tool-input.js";

export const VISUAL_REFERENCE_PHASE_ROUTE = "visual-reference-research";
export const VISUAL_REFERENCE_PHASE_ROUTE_PLACEHOLDER =
  "<read-only web/frontend-reference capable route id>";

export const MANAGED_INVOCATION_PROFILES = [
  "foundation-readonly-plan",
  "foundation-propose-writes",
  "foundation-apply-approved-writes",
  "foundation-memory-write-proposals",
] as const;
export const MANAGED_INVOCATION_AUTHORITIES = ["auto", "read_only", "audited", "destructive"] as const;

type ManagedInvocationProfile = typeof MANAGED_INVOCATION_PROFILES[number];
type ManagedInvocationAuthority = typeof MANAGED_INVOCATION_AUTHORITIES[number];
type ReadyGoalExecutionStep = Extract<GoalExecutionStep, { readonly status: "ready" }>;
type ManagedInvocationPhaseId =
  | "visual-reference-research"
  | "surface-diagnosis"
  | "planning"
  | "implementation-verification"
  | "managed-review-closeout";

interface ManagedInvocationPhase {
  readonly id: ManagedInvocationPhaseId;
  readonly expectedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly verificationRequirementIds: readonly string[];
  readonly requiredToolNames: readonly string[];
  readonly taskAffinity: readonly ModelTaskSuitabilityTask[];
  readonly remainingEvidenceAfterPhase: readonly KilnWorkGovernanceEvidence[];
  readonly finalPhase: boolean;
  readonly completionTool: "work_item.update" | "work_item.execution.finish";
  readonly instruction: string;
}

export function buildManagedInvocationRequest(
  goal: GoalRun,
  step: ReadyGoalExecutionStep,
  input: Record<string, unknown>,
): {
  readonly routeId?: string;
  readonly agentProfile?: string;
  readonly missingFields: readonly string[];
  readonly request: Record<string, unknown>;
} {
  const phase = resolveManagedInvocationPhase(step);
  const phaseRequiresReadOnlyVisualResearch = phase.id === "visual-reference-research";
  const agentProfile = phaseRequiresReadOnlyVisualResearch
    ? undefined
    : step.workItem.assignedAgentProfile
    ?? step.workItem.routingRecommendation?.agentProfile
    ?? goal.routePolicy.managedAgentProfile;
  const goalOwnedRouteId = agentProfile ? undefined : goal.routePolicy.preferredRouteId;
  const routeId = phaseRequiresReadOnlyVisualResearch
    ? step.workItem.phaseRoutes?.[phase.id] ?? readText(input.managedResearchRouteId)
    : step.workItem.routeId ?? step.workItem.routingRecommendation?.routeId ?? goalOwnedRouteId;
  const providerId = readText(input.managedProviderId);
  const model = phaseRequiresReadOnlyVisualResearch && routeId
    ? undefined
    : readText(input.managedModel);
  const deliberationIntent = input.managedDeliberationIntent === undefined
    ? step.workItem.routingRecommendation?.deliberationIntent
    : readDeliberationIntent(input.managedDeliberationIntent);
  const resourceUris = uniqueText([
    ...readTextArray(input.managedResourceUris),
    ...step.workItem.verificationGateResults
      .flatMap((result) => result.evidence ?? [])
      .filter(isCanonicalArtifactContentUri),
  ]);
  if (resourceUris.some((uri) => !isCanonicalArtifactContentUri(uri))) {
    throw new Error("managedResourceUris must contain only canonical kiln://artifacts/<namespace>/<id>/content URIs.");
  }
  const expectedEvidence = phase.expectedEvidence;
  const residualRiskRequired = expectedEvidence.includes("residual-risk");
  const configuredProfile = phaseRequiresReadOnlyVisualResearch
    ? "foundation-readonly-plan"
    : readManagedInvocationProfile(step.workItem.authorityProfile)
    ?? readManagedInvocationProfile(input.managedProfile)
    ?? "foundation-readonly-plan";
  const profile = goal.authorityEnvelope.maximumAuthority === "read_only"
    ? "foundation-readonly-plan"
    : configuredProfile;
  const request: Record<string, unknown> = {
    profile,
    ...(routeId ? { routeId } : {}),
    ...(phaseRequiresReadOnlyVisualResearch ? { forbiddenInputFields: ["agentProfile"] } : {}),
    ...(providerId
      ? {
        providerRoute: {
          providerId,
          ...(model ? { model } : {}),
          ...(deliberationIntent ? { deliberationIntent } : {}),
        },
      }
      : {}),
    requestedAuthority: resolveManagedInvocationAuthority(profile, input, goal),
    task: formatManagedInvocationTask(goal, step, phase),
    summary: step.workItem.summary,
    contextMode: resourceUris.length > 0 ? "resources" : "isolated",
    ...(resourceUris.length > 0 ? { resourceUris } : {}),
    goalRunId: goal.id,
    workItemId: step.workItemId,
    boundedWorkEffects: goal.boundedWorkContractRevision.contract.scope.permittedEffects.filter((effect) =>
      effect !== "invoke_managed_agent"),
    ...(step.workItem.workClassification ? { workClassification: step.workItem.workClassification } : {}),
    ...(agentProfile ? { agentProfile } : {}),
    roleIntent: `Execute governed work item ${step.workItemId} for goal ${goal.id}.`,
    executionPhase: {
      id: phase.id,
      expectedEvidence: phase.expectedEvidence,
      verificationRequirementIds: phase.verificationRequirementIds,
      requiredToolNames: phase.requiredToolNames,
      taskAffinity: phase.taskAffinity,
      remainingEvidenceAfterPhase: phase.remainingEvidenceAfterPhase,
      finalPhase: phase.finalPhase,
      completionTool: phase.completionTool,
      autoStartAllowed: phase.completionTool === "work_item.execution.finish",
      instruction: phase.instruction,
    },
    expectedEvidence,
    ...(phase.requiredToolNames.length > 0 ? { requiredToolNames: phase.requiredToolNames } : {}),
    ...(phaseRequiresReadOnlyVisualResearch && step.workItem.referenceRoots
      ? { requiredReadPaths: step.workItem.referenceRoots }
      : {}),
    requiredResultFields: managedInvocationResultFields(expectedEvidence),
    doneCriteria: managedInvocationDoneCriteria(phase),
    residualRiskRequired,
    outputVerbosity: "concise",
  };

  return {
    routeId,
    agentProfile,
    missingFields: providerId || routeId
      ? []
      : phaseRequiresReadOnlyVisualResearch
        ? ["providerRoute.providerId or managedResearchRouteId for read-only frontend-reference route"]
        : ["providerRoute.providerId"],
    request,
  };
}

export function validateVisualReferenceEvidence(input: {
  readonly providedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly verificationGateResults: readonly VerificationGateResult[];
}): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  if (!input.providedEvidence.includes("visual-reference-research")) {
    return { ok: true };
  }
  const passedVisualResults = input.verificationGateResults.filter((result) =>
    result.status === "passed" && isVisualReferenceGate(result.gate));
  if (passedVisualResults.length === 0) {
    return {
      ok: false,
      code: "visual_reference_product_ui_required",
      message: "visual-reference-research requires a passed frontend-reference verification gate with running-product UI capture evidence when available, or code-backed frontend implementation evidence when screenshots are unavailable.",
    };
  }
  const evidenceText = passedVisualResults
    .flatMap((result) => [result.summary ?? "", ...(result.evidence ?? [])])
    .join("\n");
  if (
    containsPlaceholderVisualEvidence(evidenceText)
    || isRepositoryChromeOnlyEvidence(evidenceText)
    || !containsFrontendReferenceEvidence(evidenceText)
  ) {
    return {
      ok: false,
      code: "visual_reference_product_ui_required",
      message: "repository chrome, stars, forks, issues, README text, or raw file listings alone do not satisfy visual-reference-research; provide product UI capture evidence or code-backed frontend implementation evidence with source URLs or local source paths and relevant frontend file paths.",
    };
  }
  return { ok: true };
}

export function validatePhaseRouteContract(input: {
  readonly expectedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly providedEvidence: readonly KilnWorkGovernanceEvidence[];
  readonly routeId?: string;
  readonly authorityProfile?: string;
  readonly phaseRoutes?: Readonly<Record<string, string>>;
}): { readonly ok: true } | { readonly ok: false; readonly code: string; readonly message: string } {
  const requiresVisualReference = input.expectedEvidence.includes(VISUAL_REFERENCE_PHASE_ROUTE)
    && !input.providedEvidence.includes(VISUAL_REFERENCE_PHASE_ROUTE);
  if (!requiresVisualReference || !input.routeId || input.authorityProfile !== "foundation-apply-approved-writes") {
    return { ok: true };
  }
  if (readText(input.phaseRoutes?.[VISUAL_REFERENCE_PHASE_ROUTE])) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "visual_reference_phase_route_required",
    message: "UI work assigned to an approved-write route must declare phaseRoutes.visual-reference-research with a read-only web/frontend-reference capable route before visual-reference-research is accepted. Do not use the write route for frontend-reference research.",
  };
}

function resolveManagedInvocationAuthority(
  profile: ManagedInvocationProfile,
  input: Record<string, unknown>,
  goal: GoalRun,
): ManagedInvocationAuthority {
  if (goal.authorityEnvelope.maximumAuthority === "read_only" || profile === "foundation-readonly-plan") {
    return "read_only";
  }
  const requestedAuthority = readManagedInvocationAuthority(input.requestedAuthority);
  if (requestedAuthority === "audited" && goal.authorityEnvelope.maximumAuthority === "destructive") {
    return "audited";
  }
  return goal.authorityEnvelope.maximumAuthority;
}

function resolveManagedInvocationPhase(step: ReadyGoalExecutionStep): ManagedInvocationPhase {
  const accountedEvidence = new Set(accountedWorkItemEvidence(step.workItem));
  const missingEvidence = step.requiredEvidence
    .filter((evidence): evidence is KilnWorkGovernanceEvidence => isKilnWorkGovernanceEvidence(evidence))
    .filter((evidence) => !accountedEvidence.has(evidence));
  const targetEvidence = firstMatchingPhaseEvidence(missingEvidence);
  const phaseId = phaseIdForEvidence(targetEvidence);
  const remainingEvidenceAfterPhase = missingEvidence.filter((evidence) => !targetEvidence.includes(evidence));
  const finalPhase = remainingEvidenceAfterPhase.length === 0;
  const accountedGates = new Set([
    ...step.workItem.skippedVerificationGates,
    ...step.workItem.verificationGateResults
      .filter((result) => result.status === "passed" || result.status === "skipped")
      .map((result) => result.gate),
  ]);
  const remainingVerificationGates = finalPhase
    ? step.workItem.verificationGates.filter((gate) => !accountedGates.has(gate))
    : [];
  return {
    id: phaseId,
    expectedEvidence: targetEvidence,
    verificationRequirementIds: uniqueText([...targetEvidence, ...remainingVerificationGates]),
    requiredToolNames: requiredToolNamesForPhaseEvidence(targetEvidence),
    taskAffinity: taskAffinityForPhase(phaseId),
    remainingEvidenceAfterPhase,
    finalPhase,
    completionTool: finalPhase ? "work_item.execution.finish" : "work_item.update",
    instruction: finalPhase
      ? "This is the final evidence phase. Kiln will attach invocation provenance and close the execution attempt after validating the structured handoff."
      : "This is an intermediate evidence phase. Kiln will record the validated phase result and advance the same work item automatically.",
  };
}

function firstMatchingPhaseEvidence(
  missingEvidence: readonly KilnWorkGovernanceEvidence[],
): readonly KilnWorkGovernanceEvidence[] {
  const uiReference = pickEvidence(missingEvidence, ["visual-reference-research"]);
  if (uiReference.length > 0) return uiReference;
  const diagnosis = pickEvidence(missingEvidence, ["surface-map", "risk-hypothesis"]);
  if (diagnosis.length > 0) return diagnosis;
  const planning = pickEvidence(missingEvidence, ["spec", "plan", "formal-proof"]);
  if (planning.length > 0) return planning;
  const verification = pickEvidence(missingEvidence, ["tests", "typecheck", "browser-qa"]);
  if (verification.length > 0) return verification;
  const closeout = pickEvidence(missingEvidence, ["managed-agent-review", "residual-risk"]);
  if (closeout.length > 0) return closeout;
  return missingEvidence;
}

function pickEvidence(
  missingEvidence: readonly KilnWorkGovernanceEvidence[],
  candidates: readonly KilnWorkGovernanceEvidence[],
): readonly KilnWorkGovernanceEvidence[] {
  return candidates.filter((evidence) => missingEvidence.includes(evidence));
}

function phaseIdForEvidence(evidence: readonly KilnWorkGovernanceEvidence[]): ManagedInvocationPhaseId {
  if (evidence.includes("visual-reference-research")) return "visual-reference-research";
  if (evidence.some((candidate) => candidate === "surface-map" || candidate === "risk-hypothesis")) {
    return "surface-diagnosis";
  }
  if (evidence.some((candidate) => candidate === "spec" || candidate === "plan" || candidate === "formal-proof")) {
    return "planning";
  }
  if (evidence.some((candidate) => candidate === "tests" || candidate === "typecheck" || candidate === "browser-qa")) {
    return "implementation-verification";
  }
  return "managed-review-closeout";
}

function requiredToolNamesForPhaseEvidence(evidence: readonly KilnWorkGovernanceEvidence[]): readonly string[] {
  return uniqueText([
    ...(evidence.some((candidate) =>
      candidate === "surface-map"
      || candidate === "risk-hypothesis"
      || candidate === "spec"
      || candidate === "plan"
      || candidate === "formal-proof")
      ? ["read", "tree", "grep", "glob"]
      : []),
    ...(evidence.some((candidate) => candidate === "tests" || candidate === "typecheck") ? ["bash"] : []),
    ...(evidence.includes("visual-reference-research") ? ["read", "glob", "grep"] : []),
    ...(evidence.includes("browser-qa")
      ? ["browser_session_start", "browser_navigate", "browser_observe"]
      : []),
  ]);
}

function formatManagedInvocationTask(
  goal: GoalRun,
  step: ReadyGoalExecutionStep,
  phase = resolveManagedInvocationPhase(step),
): string {
  const remainingVerificationGates = phase.verificationRequirementIds
    .filter((requirementId) => !phase.expectedEvidence.some((evidence) => evidence === requirementId));
  const lines = [
    step.workItem.summary,
    `Goal: ${goal.objective}`,
    `Work item id: ${step.workItemId}`,
    `Execution phase: ${phase.id}.`,
  ];
  if (phase.expectedEvidence.length > 0) {
    lines.push(`Produce only this phase evidence: ${phase.expectedEvidence.join(", ")}.`);
  }
  if (phase.verificationRequirementIds.length > 0) {
    lines.push(`verificationResults must contain exactly one result for every required evidence or closeout gate, using these exact requirementId values: ${phase.verificationRequirementIds.join(", ")}. Mark genuinely unexecuted checks skipped, never passed, and describe every skip in residualRisks.`);
  }
  if (phase.id === "visual-reference-research") {
    lines.push("Use read-only frontend-reference research authority. Prefer running-product UI captures when available. If the reference repository has no public screenshots, inspect the frontend implementation itself and produce code-backed evidence: component structure, layout/navigation model, spacing/typography/density, panels, work surfaces, composer-like interactions, status areas, and relevant frontend file paths. Local reference repositories are valid only when evidence cites concrete source paths and extracted UI principles. Repository chrome, stars/forks/issues, and raw file listings alone do not count.");
    if (step.workItem.referenceRoots && step.workItem.referenceRoots.length > 0) {
      lines.push(`Required reference roots: ${step.workItem.referenceRoots.join("; ")}.`);
      lines.push("Before recording visual-reference-research, inspect each required reference root enough to cite concrete frontend source paths or explicitly report why that root has no qualifying frontend implementation evidence. A raw file listing or analysis of only this Kiln repository does not satisfy this phase.");
    }
  }
  if (phase.requiredToolNames.length > 0) {
    lines.push(`This phase requires route tools: ${phase.requiredToolNames.join(", ")}.`);
  }
  if (phase.remainingEvidenceAfterPhase.length > 0) {
    lines.push(`Do not expand into later phases. Remaining evidence after this phase: ${phase.remainingEvidenceAfterPhase.join(", ")}.`);
  }
  if (remainingVerificationGates.length > 0) {
    lines.push(`Remaining work item verification gates for final closeout: ${remainingVerificationGates.join("; ")}.`);
  }
  lines.push(phase.instruction);
  lines.push("Return exactly one structured-execution-result-v1 JSON object with status, summary, limitations, operatorDecisions, evidence, citations, warnings, failures, approvalRequirements, residualRisks, and verificationResults. Include uncertainty when requested. Do not infer verification success from prose or include scratch notes, private planning text, or tool-output housekeeping.");
  return lines.join("\n");
}

function managedInvocationResultFields(expectedEvidence: readonly string[]): readonly ManagedAgentResultField[] {
  return [
    "summary",
    "evidence",
    "verificationResults",
    ...(expectedEvidence.includes("residual-risk") ? ["residualRisks" as const] : []),
  ];
}

function managedInvocationDoneCriteria(phase: ManagedInvocationPhase): readonly string[] {
  const remainingVerificationGates = phase.verificationRequirementIds
    .filter((requirementId) => !phase.expectedEvidence.some((evidence) => evidence === requirementId));
  return uniqueText([
    ...(phase.finalPhase ? remainingVerificationGates : []),
    ...(phase.expectedEvidence.length > 0
      ? [`Produce phase evidence: ${phase.expectedEvidence.join(", ")}.`]
      : []),
    ...(phase.remainingEvidenceAfterPhase.length > 0
      ? [`Stop after phase ${phase.id}; Kiln owns the validated transition to the next phase.`]
      : []),
    ...(phase.expectedEvidence.includes("residual-risk") ? ["Document residual risk before closeout."] : []),
  ]);
}

function containsPlaceholderVisualEvidence(value: string): boolean {
  const normalized = value.toLowerCase();
  return normalized.includes("<source url")
    || normalized.includes("<kiln://")
    || normalized.includes("<summarize")
    || normalized.includes("<artifact uri")
    || normalized.includes("placeholder");
}

function isVisualReferenceGate(gate: string): boolean {
  const normalized = gate.toLowerCase();
  return normalized.includes("visual-reference")
    || normalized.includes("visual reference")
    || normalized.includes("frontend-reference")
    || normalized.includes("frontend reference")
    || normalized.includes("frontend implementation")
    || normalized.includes("real product screenshot")
    || normalized.includes("browser visual reference")
    || normalized.includes("source urls");
}

function isRepositoryChromeOnlyEvidence(value: string): boolean {
  const normalized = value.toLowerCase();
  const mentionsGithubRepo = normalized.includes("github.com/")
    || normalized.includes("repository files navigation")
    || normalized.includes("github repo")
    || normalized.includes("repo page")
    || normalized.includes("stars")
    || normalized.includes("forks");
  return mentionsGithubRepo && !containsFrontendReferenceEvidence(value);
}

function readManagedInvocationProfile(value: unknown): ManagedInvocationProfile | undefined {
  return MANAGED_INVOCATION_PROFILES.includes(value as ManagedInvocationProfile)
    ? value as ManagedInvocationProfile
    : undefined;
}

function readManagedInvocationAuthority(value: unknown): ManagedInvocationAuthority | undefined {
  return MANAGED_INVOCATION_AUTHORITIES.includes(value as ManagedInvocationAuthority)
    ? value as ManagedInvocationAuthority
    : undefined;
}

function taskAffinityForPhase(phase: ManagedInvocationPhaseId): readonly ModelTaskSuitabilityTask[] {
  switch (phase) {
    case "visual-reference-research":
      return ["research", "frontend-design"];
    case "surface-diagnosis":
      return ["architecture-review", "research"];
    case "planning":
    case "managed-review-closeout":
      return ["architecture-review"];
    case "implementation-verification":
      return ["test-writing"];
  }
}

function readDeliberationIntent(value: unknown): DeliberationIntent {
  const record = requireInputRecord(value, "managedDeliberationIntent");
  const allowed = new Set(["mode", "preferredLevel", "target", "bounds", "onUnsupported"]);
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`Invalid input: managedDeliberationIntent contains unsupported field ${unknown}.`);
  const onUnsupported = readText(record.onUnsupported);
  if (onUnsupported !== "deny" && onUnsupported !== "omit" && onUnsupported !== "allow-clamp") {
    throw new Error("Invalid input: managedDeliberationIntent.onUnsupported is invalid.");
  }
  if (record.mode === "provider-default") {
    if (record.preferredLevel !== undefined || record.target !== undefined || record.bounds !== undefined) {
      throw new Error("Invalid input: provider-default deliberation cannot declare a level, target, or bounds.");
    }
    return { mode: "provider-default", onUnsupported };
  }
  const boundsRecord = record.bounds === undefined
    ? undefined
    : requireInputRecord(record.bounds, "managedDeliberationIntent.bounds");
  if (boundsRecord) {
    const unknownBound = Object.keys(boundsRecord).find((key) => key !== "min" && key !== "max");
    if (unknownBound) {
      throw new Error(`Invalid input: managedDeliberationIntent.bounds contains unsupported field ${unknownBound}.`);
    }
  }
  const min = readText(boundsRecord?.min);
  const max = readText(boundsRecord?.max);
  const bounds = boundsRecord
    ? {
      ...(min ? { min: defineDeliberationLevelId(min) } : {}),
      ...(max ? { max: defineDeliberationLevelId(max) } : {}),
    }
    : undefined;
  if (record.mode === "fixed") {
    const preferredLevel = readText(record.preferredLevel);
    if (!preferredLevel || record.target !== undefined) {
      throw new Error("Invalid input: fixed deliberation requires preferredLevel and cannot declare target.");
    }
    return {
      mode: "fixed",
      preferredLevel: defineDeliberationLevelId(preferredLevel),
      ...(bounds ? { bounds } : {}),
      onUnsupported,
    };
  }
  if (record.mode === "adaptive") {
    const target = readText(record.target);
    if (record.preferredLevel !== undefined || (target !== "latency-first" && target !== "balanced" && target !== "quality-first")) {
      throw new Error("Invalid input: adaptive deliberation requires a valid target and cannot declare preferredLevel.");
    }
    return { mode: "adaptive", target, ...(bounds ? { bounds } : {}), onUnsupported };
  }
  throw new Error("Invalid input: managedDeliberationIntent.mode is invalid.");
}
