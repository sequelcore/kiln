import {
  admitDeliberationForExecution,
  defineManagedAgentWriteEvidence,
  digestManagedEconomicValue,
  type DeliberationResolution,
  type ManagedAgentResultHandoff,
  type ManagedAgentWriteEvidence,
} from "@kilnai/core";
import type { ManagedEconomicCandidateSet } from "../agents/managed-invocation/runtime-tool/index.js";
import type {
  AgentTaskDataPolicyProof,
  AgentTaskDiagnosticCode,
  AgentTaskDispatch,
  AgentTaskEconomicProfile,
  AgentTaskFailureEvidence,
  AgentTaskNativeDeliberationResolution,
  AgentTaskNativeHarnessAcknowledgement,
  AgentTaskNativeHarnessProfile,
  AgentTaskNativeHarnessRoute,
  AgentTaskRecord,
  AgentTaskResult,
  AgentTaskWriteApproval,
} from "./contracts.js";
import { AgentTaskApplicationError, AgentTaskExecutionFailure } from "./errors.js";
import {
  hasOnly,
  isBoundedOpaqueIdentity,
  isCanonicalHash,
  isCanonicalKilnDiagnosticUri,
  isDeliberationSource,
  isEconomicAttemptId,
  isIdentifier,
  isIso,
  isManagedAgentAdmissionProfile,
  isManagedAgentRouteSource,
  isManagedEconomicDispatchFenceId,
  isNativeHarnessDispatchFenceId,
  isRecord,
  isValidAgentTaskConstraints,
  sameAgentTaskConstraints,
} from "./validation-primitives.js";

export function normalizeAgentTaskExecutionFailure(error: unknown): AgentTaskFailureEvidence {
  if (error instanceof AgentTaskExecutionFailure && isValidAgentTaskFailureEvidence(error.evidence)) {
    return error.evidence;
  }
  return { version: 1, classification: "unknown_failure" };
}

export function agentTaskExecutionTerminal(error: unknown): {
  readonly state: "failed" | "timed_out";
  readonly diagnostic: AgentTaskDiagnosticCode;
  readonly failureEvidence?: AgentTaskFailureEvidence;
} {
  if (error instanceof AgentTaskApplicationError) {
    return {
      state: error.code === "provider_timeout" ? "timed_out" : "failed",
      diagnostic: error.code,
      ...(error.failureEvidence && isValidAgentTaskFailureEvidence(error.failureEvidence)
        ? { failureEvidence: error.failureEvidence }
        : {}),
    };
  }
  return {
    state: "failed",
    diagnostic: "invocation_failed",
    failureEvidence: normalizeAgentTaskExecutionFailure(error),
  };
}

export function isValidAgentTaskFailureEvidence(value: unknown): value is AgentTaskFailureEvidence {
  return isRecord(value)
    && hasOnly(value, ["version", "classification", "diagnosticUri", "transportPhase"])
    && value.version === 1
    && isAgentTaskExecutionFailureClassification(value.classification)
    && (value.diagnosticUri === undefined || isCanonicalKilnDiagnosticUri(value.diagnosticUri))
    && (value.transportPhase === undefined
      || ["headers", "first_byte", "chunk_idle", "transport"].includes(value.transportPhase as string));
}

function isAgentTaskExecutionFailureClassification(
  value: unknown,
): value is AgentTaskFailureEvidence["classification"] {
  return typeof value === "string" && [
    "harness_version_mismatch", "structured_handoff_rejected", "model_identity_mismatch",
    "private_artifact_cleanup_failed", "provider_quota_exhausted", "native_session_error",
    "write_boundary_violation", "result_handoff_missing", "provider_timeout", "unknown_failure",
  ].includes(value);
}

export function isValidAgentTaskResult(
  value: unknown,
  job: AgentTaskRecord,
  updatedAt: string,
): value is AgentTaskResult {
  if (
    !isRecord(value)
    || !hasOnly(value, [
      "version", "jobId", "runtimeInvocationId", "configuredAgentProfileId", "admissionProfileId",
      "routeId", "providerId", "terminalState", "completedAt", "provenance", "resultHandoff",
      "writeEvidence", "dataPolicyProof",
    ])
    || value.version !== 1
    || value.jobId !== job.id
    || !isIdentifier(value.runtimeInvocationId)
    || value.configuredAgentProfileId !== job.configuredAgentProfileId
    || value.admissionProfileId !== job.admissionProfileId
    || value.terminalState !== "completed"
    || !isIso(value.completedAt)
    || Date.parse(value.completedAt) !== Date.parse(updatedAt)
    || !isRecord(value.provenance)
    || !hasOnly(value.provenance, ["source", "trust"])
    || value.provenance.source !== "runtime-managed-invocation"
    || value.provenance.trust !== "untrusted-child-output"
    || !isSafeResultHandoff(value.resultHandoff)
    || !isSafeAgentTaskWriteEvidence(value.writeEvidence, job.id)
  ) return false;
  if (job.dispatch.kind === "native-harness") {
    return job.dispatch.routeId === value.routeId
      && job.dispatch.providerId === value.providerId
      && isValidAgentTaskDataPolicyProof(value.dataPolicyProof, job);
  }
  const dataPolicyProof = value.dataPolicyProof;
  if (!isValidAgentTaskDataPolicyProof(dataPolicyProof, job)) return false;
  return job.dispatch.candidateSet.candidates.some(
    (candidate) => candidate.routeId === value.routeId
      && candidate.providerId === value.providerId
      && candidate.model === dataPolicyProof.providerModelId,
  );
}

export function isValidAgentTaskDataPolicyProof(
  value: unknown,
  job: AgentTaskRecord,
): value is AgentTaskDataPolicyProof {
  if (!isRecord(value) || !hasOnly(value, [
    "version", "jobId", "dispatchFenceId", "routeId", "providerId", "providerModelId", "decision", "evidence",
  ])) return false;
  if (
    value.version !== 1
    || value.jobId !== job.id
  ) return false;
  if (job.dispatch.kind === "native-harness") {
    if (
      value.dispatchFenceId !== job.dispatch.dispatchFenceId
      || value.routeId !== job.dispatch.routeId
      || value.providerId !== job.dispatch.providerId
      || value.providerModelId !== job.dispatch.model
    ) return false;
  } else {
    const candidate = job.dispatch.candidateSet.candidates.find((entry) =>
      entry.routeId === value.routeId
      && entry.providerId === value.providerId
      && entry.model === value.providerModelId,
    );
    if (
      !candidate
      || job.dispatch.dispatchFenceId === undefined
      || value.dispatchFenceId !== job.dispatch.dispatchFenceId
      || !isManagedEconomicDispatchFenceId(value.dispatchFenceId)
    ) return false;
  }
  const decision = value.decision;
  const evidence = value.evidence;
  return isRecord(decision)
    && hasOnly(decision, ["status", "freshness", "reason"])
    && decision.status === "admitted"
    && decision.freshness === "current"
    && decision.reason === "policy-admitted"
    && isRecord(evidence)
    && hasOnly(evidence, [
      "providerId", "providerModelId", "sourceIdentity", "sourceRevision", "sourceDigest",
      "trainingPosture", "retentionPosture", "retentionDays", "maximumClassification", "observedAt", "expiresAt",
    ])
    && evidence.providerId === value.providerId
    && evidence.providerModelId === value.providerModelId
    && isIdentifier(evidence.sourceIdentity)
    && isIdentifier(evidence.sourceRevision)
    && typeof evidence.sourceDigest === "string"
    && /^sha256:[a-f0-9]{64}$/u.test(evidence.sourceDigest)
    && (evidence.trainingPosture === "prohibited" || evidence.trainingPosture === "permitted")
    && (evidence.retentionPosture === "zero" || evidence.retentionPosture === "bounded")
    && Number.isSafeInteger(evidence.retentionDays)
    && Number(evidence.retentionDays) >= 0
    && (evidence.maximumClassification === "public"
      || evidence.maximumClassification === "internal"
      || evidence.maximumClassification === "confidential"
      || evidence.maximumClassification === "restricted")
    && isIso(evidence.observedAt)
    && isIso(evidence.expiresAt);
}

export function isValidAgentTaskWriteApproval(value: unknown): value is AgentTaskWriteApproval {
  return isRecord(value)
    && hasOnly(value, ["approvalId", "state", "issuedAt", "expiresAt", "approverId", "consumedAt", "consumedBy"])
    && isIdentifier(value.approvalId)
    && (value.state === "issued" || value.state === "revoked" || value.state === "consumed")
    && isIso(value.issuedAt)
    && isIso(value.expiresAt)
    && Date.parse(value.issuedAt) <= Date.parse(value.expiresAt)
    && isIdentifier(value.approverId)
    && (value.consumedAt === undefined || isIso(value.consumedAt))
    && (value.consumedBy === undefined || isIdentifier(value.consumedBy))
    && (value.state === "consumed"
      ? value.consumedAt !== undefined && value.consumedBy !== undefined
      : value.consumedAt === undefined && value.consumedBy === undefined);
}

function isSafeResultHandoffProvenance(value: unknown): boolean {
  if (!isRecord(value) || !hasOnly(value, ["delivery", "configuredModelId", "primaryObservedModelId", "observedModelIds", "harness"])) {
    return false;
  }
  if (
    value.delivery !== "native-structured-output"
    && value.delivery !== "assistant-text"
    && value.delivery !== "submission-tool"
    && value.delivery !== "remote-harness"
    && value.delivery !== "runtime-generated"
  ) return false;
  if (
    typeof value.configuredModelId !== "string"
    || value.configuredModelId.trim().length === 0
    || (value.primaryObservedModelId !== undefined
      && (typeof value.primaryObservedModelId !== "string" || value.primaryObservedModelId.trim().length === 0))
    || !Array.isArray(value.observedModelIds)
    || !value.observedModelIds.every((modelId) => typeof modelId === "string" && modelId.trim().length > 0)
    || (value.primaryObservedModelId !== undefined && !value.observedModelIds.includes(value.primaryObservedModelId))
  ) return false;
  if (value.harness === undefined) return true;
  return isRecord(value.harness)
    && hasOnly(value.harness, ["id", "executable", "version"])
    && typeof value.harness.id === "string"
    && value.harness.id.trim().length > 0
    && typeof value.harness.executable === "string"
    && value.harness.executable.trim().length > 0
    && !/^(?:[A-Za-z]:[\\/]|[\\/]{1,2})/u.test(value.harness.executable)
    && typeof value.harness.version === "string"
    && value.harness.version.trim().length > 0;
}

function isSafeResultHandoff(value: unknown): value is ManagedAgentResultHandoff {
  return isRecord(value)
    && hasOnly(value, ["provenance", "summary", "resourceUris", "memoryWriteProposalUris"])
    && isSafeResultHandoffProvenance(value.provenance)
    && typeof value.summary === "string"
    && value.summary.trim().length > 0
    && value.summary.length <= AGENT_TASK_INLINE_RESULT_LIMIT
    && Array.isArray(value.resourceUris)
    && Array.isArray(value.memoryWriteProposalUris)
    && value.resourceUris.length === 0
    && value.memoryWriteProposalUris.length === 0
    && redactAgentTaskResultText(value.summary) === value.summary;
}

export function normalizeAgentTaskWriteEvidence(
  value: readonly ManagedAgentWriteEvidence[],
  jobId: string,
): readonly ManagedAgentWriteEvidence[] {
  const normalized = value.map((candidate) => {
    const canonical = defineManagedAgentWriteEvidence(candidate);
    return defineManagedAgentWriteEvidence({
      ...canonical,
      summary: normalizeAgentTaskInlineText(canonical.summary),
    });
  });
  if (!isSafeAgentTaskWriteEvidence(normalized, jobId)) {
    throw new AgentTaskApplicationError("result_corrupt", "Persist only canonical managed write evidence.");
  }
  return normalized;
}

function isSafeAgentTaskWriteEvidence(value: unknown, jobId: string): value is readonly ManagedAgentWriteEvidence[] {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length === 0 || value.length > 64) return false;
  return value.every((candidate) => {
    if (!isRecord(candidate)) return false;
    let canonical: ManagedAgentWriteEvidence;
    try {
      canonical = defineManagedAgentWriteEvidence(candidate as unknown as ManagedAgentWriteEvidence);
    } catch {
      return false;
    }
    return JSON.stringify(canonical) === JSON.stringify(candidate)
      && canonical.invocationId === `agent-task:${jobId}`
      && isIdentifier(canonical.evidenceId)
      && canonical.summary.length <= AGENT_TASK_INLINE_RESULT_LIMIT
      && redactAgentTaskResultText(canonical.summary) === canonical.summary
      && isIso(canonical.recordedAt)
      && canonical.resourceUris.length <= 32
      && canonical.resourceUris.every(isSafeAgentTaskResourceUri);
  });
}

function isSafeAgentTaskResourceUri(value: string): boolean {
  if (value.length === 0 || value.length > 500 || !value.startsWith("kiln://")) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "kiln:" && parsed.username === "" && parsed.password === "";
  } catch {
    return false;
  }
}

export interface AgentTaskResultHandoffValidationOptions {
  readonly objective?: string;
}

const AGENT_TASK_INLINE_RESULT_LIMIT = 2000;
const AGENT_TASK_TRUNCATION_NOTICE = "[TRUNCATED: safe inline result limit reached]";

export function normalizeAgentTaskResultHandoff(
  value: ManagedAgentResultHandoff,
  objective?: string,
): ManagedAgentResultHandoff {
  const summary = normalizeAgentTaskInlineText(value.summary, objective);
  return {
    provenance: value.provenance,
    summary,
    resourceUris: [],
    memoryWriteProposalUris: [],
  };
}

function normalizeAgentTaskInlineText(value: string, objective?: string): string {
  let summary = redactAgentTaskResultText(value, objective).trim();
  if (summary.length === 0) summary = "[REDACTED: no safe canonical result content remained]";
  if (summary.length > AGENT_TASK_INLINE_RESULT_LIMIT) {
    const prefixLength = AGENT_TASK_INLINE_RESULT_LIMIT - AGENT_TASK_TRUNCATION_NOTICE.length - 1;
    summary = `${summary.slice(0, Math.max(0, prefixLength)).trimEnd()} ${AGENT_TASK_TRUNCATION_NOTICE}`;
  }
  return summary;
}

function redactAgentTaskResultText(value: string, objective?: string): string {
  const trimmed = value.trim();
  if (looksLikeRawProviderPayload(trimmed)) return "[REDACTED:unsafe raw provider payload]";
  return value
    .replaceAll(objective ?? "", objective ? "[REDACTED:request]" : "")
    .replace(/(?:^|\n)\s*(?:system|developer|user)\s+prompt\s*:[^\n]*/giu, "\n[REDACTED:prompt]")
    .replace(/(?:^|\n)\s*(?:hidden\s+reasoning|reasoning)\s*:[^\n]*/giu, "\n[REDACTED:reasoning]")
    .replace(/(?:^|\n)\s*(?:system|developer|user|assistant)\s*:[^\n]*/giu, "\n[REDACTED:transcript]")
    .replace(/(?:^|\n)\s*(?:[A-Za-z_][A-Za-z0-9_]*Error|Error)\s*:[^\n]*/gu, "\n[REDACTED:error]")
    .replace(/(?:^|\n)\s*at\s+[^\n]*/gu, "\n[REDACTED:stack]")
    .replace(/\b(?!(?:REDACTED|TRUNCATED)\b)[A-Z][A-Z0-9_]{2,}\s*(?:=|:)\s*[^\s,;]+/gu, "[REDACTED:environment]")
    .replace(/\b(?:api[_-]?key|token|secret|password)\s*(?:=|:)\s*[^\s,;]+/giu, "[REDACTED:environment]")
    .replace(/[A-Za-z]:\\[^\s"']+/gu, "[REDACTED:path]")
    .replace(/(?:\/home|\/Users|\/tmp|\/var)\/[^\s"']+/gu, "[REDACTED:path]")
    .replace(/\b(?:sk-(?:proj-|ant-)?|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED:credential]")
    .replace(/\bAuthorization:\s*Bearer\s+[^\s]+/giu, "Authorization: [REDACTED:credential]");
}

function looksLikeRawProviderPayload(value: string): boolean {
  return /(?:\{\s*"[^"\n]{1,200}"\s*:|\[\s*\{)/u.test(value);
}

export function isValidEconomicAgentTaskProfile(profile: AgentTaskEconomicProfile): boolean {
  return profile.kind === "economic"
    && isIdentifier(profile.id)
    && isIdentifier(profile.economicPolicyId)
    && isIdentifier(profile.economicPolicyRevision)
    && isManagedAgentAdmissionProfile(profile.admissionProfileId)
    && isValidAgentTaskConstraints(profile.constraints ?? {});
}

function isValidNativeHarnessAcknowledgement(value: unknown): value is AgentTaskNativeHarnessAcknowledgement {
  return isRecord(value)
    && hasOnly(value, [
      "version", "source", "credentialMode", "acknowledgedAt", "routeId", "routeRevision", "providerId", "model",
      "admissionProfileId", "adapterCapabilityId", "adapterCapabilityVersion", "deliberationResolution",
    ])
    && value.version === 1
    && value.source === "managed-route-admission"
    && value.credentialMode === "credentialless"
    && isIso(value.acknowledgedAt)
    && isIdentifier(value.routeId)
    && isIdentifier(value.routeRevision)
    && isIdentifier(value.providerId)
    && isBoundedOpaqueIdentity(value.model)
    && isManagedAgentAdmissionProfile(value.admissionProfileId)
    && isIdentifier(value.adapterCapabilityId)
    && isIdentifier(value.adapterCapabilityVersion)
    && (value.deliberationResolution === undefined || isValidNativeDeliberationResolution(value.deliberationResolution));
}

export function isValidNativeDeliberationResolution(value: unknown): value is AgentTaskNativeDeliberationResolution {
  if (!isRecord(value) || !isIdentifier(value.selectedLevel) || !isDeliberationSource(value.source) || !isRecord(value.capabilityEvidence)) {
    return false;
  }
  const evidence = value.capabilityEvidence;
  if (!hasOnly(evidence, ["sourceIdentity", "sourceRevision", "observedAt"])
    || !isBoundedOpaqueIdentity(evidence.sourceIdentity)
    || !isBoundedOpaqueIdentity(evidence.sourceRevision)
    || !isIso(evidence.observedAt)) return false;
  if (value.status === "exact" && hasOnly(value, ["status", "selectedLevel", "source", "capabilityEvidence"])) {
    try { return admitDeliberationForExecution(value as unknown as DeliberationResolution) !== undefined; } catch { return false; }
  }
  if (
    value.status === "clamped"
    && value.reason === "preferred-level-outside-bounds"
    && hasOnly(value, ["status", "selectedLevel", "source", "reason", "capabilityEvidence"])
  ) {
    try { return admitDeliberationForExecution(value as unknown as DeliberationResolution) !== undefined; } catch { return false; }
  }
  return false;
}

function sameNativeDeliberationResolution(
  left: AgentTaskNativeDeliberationResolution | undefined,
  right: AgentTaskNativeDeliberationResolution | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.status === right.status
    && left.selectedLevel === right.selectedLevel
    && left.source === right.source
    && left.capabilityEvidence.sourceIdentity === right.capabilityEvidence.sourceIdentity
    && left.capabilityEvidence.sourceRevision === right.capabilityEvidence.sourceRevision
    && (left.status !== "clamped" || right.status !== "clamped" || left.reason === right.reason);
}

export function isValidNativeHarnessProfile(profile: AgentTaskNativeHarnessProfile): boolean {
  return profile.kind === "native-harness"
    && isIdentifier(profile.id)
    && isManagedAgentAdmissionProfile(profile.admissionProfileId)
    && isIdentifier(profile.routeId)
    && isIdentifier(profile.routeRevision)
    && isIdentifier(profile.providerId)
    && isBoundedOpaqueIdentity(profile.model)
    && isIdentifier(profile.adapterCapabilityId)
    && isIdentifier(profile.adapterCapabilityVersion)
    && isValidNativeHarnessAcknowledgement(profile.acknowledgement)
    && (profile.deliberationResolution === undefined || isValidNativeDeliberationResolution(profile.deliberationResolution))
    && profile.acknowledgement.routeId === profile.routeId
    && profile.acknowledgement.routeRevision === profile.routeRevision
    && profile.acknowledgement.providerId === profile.providerId
    && profile.acknowledgement.model === profile.model
    && profile.acknowledgement.admissionProfileId === profile.admissionProfileId
    && profile.acknowledgement.adapterCapabilityId === profile.adapterCapabilityId
    && profile.acknowledgement.adapterCapabilityVersion === profile.adapterCapabilityVersion
    && sameNativeDeliberationResolution(profile.deliberationResolution, profile.acknowledgement.deliberationResolution);
}

export function isValidNativeHarnessRoute(value: unknown): value is AgentTaskNativeHarnessRoute {
  return isRecord(value)
    && value.kind === "native-harness"
    && hasOnly(value, [
      "kind", "admissionProfileId", "routeId", "routeRevision", "providerId", "model",
      "adapterCapabilityId", "adapterCapabilityVersion", "acknowledgement", "deliberationResolution",
    ])
    && isManagedAgentAdmissionProfile(value.admissionProfileId)
    && isIdentifier(value.routeId)
    && isIdentifier(value.routeRevision)
    && isIdentifier(value.providerId)
    && isBoundedOpaqueIdentity(value.model)
    && isIdentifier(value.adapterCapabilityId)
    && isIdentifier(value.adapterCapabilityVersion)
    && isValidNativeHarnessAcknowledgement(value.acknowledgement)
    && (value.deliberationResolution === undefined || isValidNativeDeliberationResolution(value.deliberationResolution))
    && value.acknowledgement.routeId === value.routeId
    && value.acknowledgement.routeRevision === value.routeRevision
    && value.acknowledgement.providerId === value.providerId
    && value.acknowledgement.model === value.model
    && value.acknowledgement.admissionProfileId === value.admissionProfileId
    && value.acknowledgement.adapterCapabilityId === value.adapterCapabilityId
    && value.acknowledgement.adapterCapabilityVersion === value.adapterCapabilityVersion
    && sameNativeDeliberationResolution(value.deliberationResolution, value.acknowledgement.deliberationResolution);
}

export function sameNativeHarnessRoute(
  left: AgentTaskNativeHarnessProfile,
  right: AgentTaskNativeHarnessRoute,
): boolean {
  return left.admissionProfileId === right.admissionProfileId
    && left.routeId === right.routeId
    && left.routeRevision === right.routeRevision
    && left.providerId === right.providerId
    && left.model === right.model
    && left.adapterCapabilityId === right.adapterCapabilityId
    && left.adapterCapabilityVersion === right.adapterCapabilityVersion
    && sameNativeHarnessAcknowledgement(left.acknowledgement, right.acknowledgement)
    && sameNativeDeliberationResolution(left.deliberationResolution, right.deliberationResolution);
}

function sameNativeHarnessAcknowledgement(
  left: AgentTaskNativeHarnessAcknowledgement,
  right: AgentTaskNativeHarnessAcknowledgement,
): boolean {
  return left.version === right.version
    && left.source === right.source
    && left.credentialMode === right.credentialMode
    && left.acknowledgedAt === right.acknowledgedAt
    && left.routeId === right.routeId
    && left.routeRevision === right.routeRevision
    && left.providerId === right.providerId
    && left.model === right.model
    && left.admissionProfileId === right.admissionProfileId
    && left.adapterCapabilityId === right.adapterCapabilityId
    && left.adapterCapabilityVersion === right.adapterCapabilityVersion
    && sameNativeDeliberationResolution(left.deliberationResolution, right.deliberationResolution);
}

export function sameNativeHarnessDispatchRoute(
  dispatch: Extract<AgentTaskDispatch, { readonly kind: "native-harness" }>,
  route: AgentTaskNativeHarnessRoute,
): boolean {
  return dispatch.routeId === route.routeId
    && dispatch.routeRevision === route.routeRevision
    && dispatch.providerId === route.providerId
    && dispatch.model === route.model
    && dispatch.admissionProfileId === route.admissionProfileId
    && dispatch.adapterCapabilityId === route.adapterCapabilityId
    && dispatch.adapterCapabilityVersion === route.adapterCapabilityVersion
    && sameNativeHarnessAcknowledgement(dispatch.acknowledgement, route.acknowledgement)
    && sameNativeDeliberationResolution(dispatch.deliberationResolution, route.deliberationResolution);
}

function isValidNativeHarnessDispatch(
  value: unknown,
): value is Extract<AgentTaskDispatch, { readonly kind: "native-harness" }> {
  return isRecord(value)
    && value.kind === "native-harness"
    && isIdentifier(value.routeId)
    && isIdentifier(value.routeRevision)
    && isIdentifier(value.providerId)
    && isBoundedOpaqueIdentity(value.model)
    && isManagedAgentAdmissionProfile(value.admissionProfileId)
    && isIdentifier(value.adapterCapabilityId)
    && isIdentifier(value.adapterCapabilityVersion)
    && isValidNativeHarnessAcknowledgement(value.acknowledgement)
    && (value.deliberationResolution === undefined || isValidNativeDeliberationResolution(value.deliberationResolution))
    && (value.dispatchFenceId === undefined || isNativeHarnessDispatchFenceId(value.dispatchFenceId))
    && value.acknowledgement.routeId === value.routeId
    && value.acknowledgement.routeRevision === value.routeRevision
    && value.acknowledgement.providerId === value.providerId
    && value.acknowledgement.model === value.model
    && value.acknowledgement.admissionProfileId === value.admissionProfileId
    && value.acknowledgement.adapterCapabilityId === value.adapterCapabilityId
    && value.acknowledgement.adapterCapabilityVersion === value.adapterCapabilityVersion
    && sameNativeDeliberationResolution(value.deliberationResolution, value.acknowledgement.deliberationResolution);
}

export function isValidAgentTaskDispatch(value: unknown): value is AgentTaskDispatch {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "native-harness") {
    return hasOnly(value, [
      "kind", "routeId", "routeRevision", "providerId", "model", "admissionProfileId",
      "adapterCapabilityId", "adapterCapabilityVersion", "acknowledgement", "deliberationResolution", "dispatchFenceId",
    ]) && isValidNativeHarnessDispatch(value);
  }
  if (value.kind !== "economic") return false;
  return hasOnly(value, [
    "kind", "economicAttemptId", "economicPolicyId", "economicPolicyRevision", "dispatchFenceId", "constraints", "candidateSet",
  ])
    && isEconomicAttemptId(value.economicAttemptId)
    && isIdentifier(value.economicPolicyId)
    && isIdentifier(value.economicPolicyRevision)
    && (value.dispatchFenceId === undefined || isManagedEconomicDispatchFenceId(value.dispatchFenceId))
    && isValidAgentTaskConstraints(value.constraints)
    && isManagedEconomicCandidateSet(value.candidateSet);
}

export function sameManagedEconomicCandidateSet(
  left: ManagedEconomicCandidateSet,
  right: ManagedEconomicCandidateSet,
): boolean {
  if (
    left.economicPolicyId !== right.economicPolicyId
    || left.economicPolicyRevision !== right.economicPolicyRevision
    || left.admissionProfileId !== right.admissionProfileId
    || !sameAgentTaskConstraints(left.constraints, right.constraints)
  ) return false;
  const canonicalCandidates = (value: ManagedEconomicCandidateSet): string => digestManagedEconomicValue(
    [...value.candidates].sort((a, b) => digestManagedEconomicValue(a).localeCompare(digestManagedEconomicValue(b))),
  );
  return canonicalCandidates(left) === canonicalCandidates(right);
}

export function isManagedEconomicCandidateSet(value: unknown): value is ManagedEconomicCandidateSet {
  if (
    !isRecord(value)
    || !isIdentifier(value.economicPolicyId)
    || !isIdentifier(value.economicPolicyRevision)
    || !isManagedAgentAdmissionProfile(value.admissionProfileId)
    || !isValidAgentTaskConstraints(value.constraints)
    || !Array.isArray(value.candidates)
    || !Array.isArray(value.rejections)
  ) return false;
  const candidateRouteIds = new Set<string>();
  for (const candidate of value.candidates) {
    if (
      !isRecord(candidate)
      || !hasOnly(candidate, [
        "routeId", "routeSource", "providerId", "model", "accountPolicyId", "surface",
        "adapterCapabilityId", "adapterCapabilityVersion", "profileAuthorityDigest", "deliberationResolution",
      ])
      || !isIdentifier(candidate.routeId)
      || !isManagedAgentRouteSource(candidate.routeSource)
      || !isIdentifier(candidate.providerId)
      || (candidate.model !== undefined && !isBoundedOpaqueIdentity(candidate.model))
      || (candidate.accountPolicyId !== undefined && !isIdentifier(candidate.accountPolicyId))
      || (candidate.surface !== undefined && !isIdentifier(candidate.surface))
      || !isIdentifier(candidate.adapterCapabilityId)
      || !isIdentifier(candidate.adapterCapabilityVersion)
      || !isCanonicalHash(candidate.profileAuthorityDigest)
      || (candidate.deliberationResolution !== undefined
        && !isValidManagedCandidateDeliberationResolution(candidate.deliberationResolution))
      || candidateRouteIds.has(candidate.routeId)
    ) return false;
    candidateRouteIds.add(candidate.routeId);
  }
  const rejectedRouteIds = new Set<string>();
  for (const rejection of value.rejections) {
    if (
      !isRecord(rejection)
      || !hasOnly(rejection, ["stage", "routeId", "reason"])
      || rejection.stage !== "managed-candidate-admission"
      || !isIdentifier(rejection.routeId)
      || ![
        "not-in-policy", "caller-constraint-excluded", "non-economic-admission-failed",
        "economic-capability-unverified", "deliberation-denied",
      ].includes(String(rejection.reason))
      || candidateRouteIds.has(rejection.routeId)
      || rejectedRouteIds.has(rejection.routeId)
    ) return false;
    rejectedRouteIds.add(rejection.routeId);
  }
  return true;
}

function isValidManagedCandidateDeliberationResolution(value: unknown): value is DeliberationResolution {
  if (!isRecord(value) || !hasOnly(value, ["status", "requested", "source", "capabilityEvidence", "selectedLevel", "reason"])) return false;
  if (
    !isDeliberationSource(value.source)
    || (value.requested !== undefined && !isValidManagedCandidateDeliberationIntent(value.requested))
    || (value.capabilityEvidence !== undefined && !isValidManagedCandidateDeliberationEvidence(value.capabilityEvidence))
  ) return false;
  if (value.status === "exact" || value.status === "defaulted") {
    return isBoundedOpaqueIdentity(value.selectedLevel) && value.reason === undefined;
  }
  if (value.status === "clamped") {
    return isBoundedOpaqueIdentity(value.selectedLevel) && isDeliberationResolutionReason(value.reason);
  }
  if (value.status === "omitted") {
    return isDeliberationResolutionReason(value.reason) && value.selectedLevel === undefined;
  }
  return false;
}

function isValidManagedCandidateDeliberationIntent(value: unknown): boolean {
  if (!isRecord(value) || !hasOnly(value, ["mode", "preferredLevel", "target", "bounds", "onUnsupported"])) return false;
  if (value.onUnsupported !== "deny" && value.onUnsupported !== "omit" && value.onUnsupported !== "allow-clamp") return false;
  if (value.bounds !== undefined && (
    !isRecord(value.bounds)
    || !hasOnly(value.bounds, ["min", "max"])
    || (value.bounds.min !== undefined && !isBoundedOpaqueIdentity(value.bounds.min))
    || (value.bounds.max !== undefined && !isBoundedOpaqueIdentity(value.bounds.max))
  )) return false;
  if (value.mode === "provider-default") return value.preferredLevel === undefined && value.target === undefined;
  if (value.mode === "fixed") return isBoundedOpaqueIdentity(value.preferredLevel) && value.target === undefined;
  return value.mode === "adaptive"
    && (value.target === "latency-first" || value.target === "balanced" || value.target === "quality-first")
    && value.preferredLevel === undefined;
}

function isValidManagedCandidateDeliberationEvidence(value: unknown): boolean {
  return isRecord(value)
    && hasOnly(value, ["sourceIdentity", "sourceRevision", "observedAt"])
    && isBoundedOpaqueIdentity(value.sourceIdentity)
    && isBoundedOpaqueIdentity(value.sourceRevision)
    && isIso(value.observedAt);
}

function isDeliberationResolutionReason(value: unknown): boolean {
  return value === "not-requested"
    || value === "capability-unknown"
    || value === "capability-invalid"
    || value === "provider-default-unavailable"
    || value === "adaptive-unsupported"
    || value === "preferred-level-unsupported"
    || value === "preferred-level-outside-bounds"
    || value === "bound-unsupported"
    || value === "invalid-bounds"
    || value === "no-level-within-bounds";
}
