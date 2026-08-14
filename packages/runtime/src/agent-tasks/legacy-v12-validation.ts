import type { ManagedAgentAdmissionProfile } from "@kilnai/core";
import type {
  AgentTaskDispatch,
  AgentTaskFailureEvidence,
  AgentTaskLifecycleEntry,
  AgentTaskRecord,
  AgentTaskResult,
  AgentTaskState,
  AgentTaskWriteApproval,
} from "./contracts.js";

export type LegacyV12AgentTaskRecord = Omit<AgentTaskRecord, "version" | "run"> & {
  readonly version: 12;
};

export interface LegacyV12DeepValidators {
  readonly admissionProfile: (value: unknown) => value is ManagedAgentAdmissionProfile;
  readonly dispatch: (value: unknown) => value is AgentTaskDispatch;
  readonly lifecycle: (
    value: unknown,
    state: AgentTaskState,
    admissionProfileId: ManagedAgentAdmissionProfile,
    createdAt: string,
    updatedAt: string,
  ) => value is readonly AgentTaskLifecycleEntry[];
  readonly diagnostic: (value: unknown) => boolean;
  readonly failureEvidence: (value: unknown) => value is AgentTaskFailureEvidence;
  readonly writeApproval: (value: unknown) => value is AgentTaskWriteApproval;
  readonly result: (value: unknown, task: AgentTaskRecord, updatedAt: string) => value is AgentTaskResult;
  readonly approvedWriteProfile: (value: ManagedAgentAdmissionProfile) => boolean;
  readonly sameEconomicConstraints: (
    left: Extract<AgentTaskDispatch, { readonly kind: "economic" }>["candidateSet"]["constraints"],
    right: Extract<AgentTaskDispatch, { readonly kind: "economic" }>["constraints"],
  ) => boolean;
  readonly economicDispatchFenceId: (value: unknown) => boolean;
  readonly nativeDispatchFenceId: (value: unknown) => boolean;
}

const LEGACY_V12_KEYS = [
  "version", "id", "adoptedDecisionAt", "state", "objective", "projectId", "callerId",
  "configuredAgentProfileId", "admissionProfileId", "dispatch", "governanceSource", "admissionId",
  "requestFingerprint", "idempotencyKeyHash", "createdAt", "updatedAt", "parent", "diagnostic",
  "failureEvidence", "result", "writeApproval", "lifecycle",
] as const;

/**
 * Immutable V12 boundary. Every nested authority/evidence object is checked by
 * the same exact validators that owned the V12 persistence contract. The
 * caller may transform only the returned, already-validated record.
 */
export function validateLegacyV12AgentTask(
  value: unknown,
  validators: LegacyV12DeepValidators,
): LegacyV12AgentTaskRecord {
  if (
    !isRecord(value)
    || value.version !== 12
    || !hasOnly(value, LEGACY_V12_KEYS)
    || !isIdentifier(value.id)
    || !isIso(value.adoptedDecisionAt)
    || !isState(value.state)
    || typeof value.objective !== "string"
    || value.objective.trim().length === 0
    || value.objective.length > 12000
    || !isIdentifier(value.projectId)
    || !isIdentifier(value.callerId)
    || !isIdentifier(value.configuredAgentProfileId)
    || !validators.admissionProfile(value.admissionProfileId)
    || !validators.dispatch(value.dispatch)
    || !isIdentifier(value.governanceSource)
    || !isIdentifier(value.admissionId)
    || !isCanonicalHash(value.requestFingerprint)
    || !isCanonicalHash(value.idempotencyKeyHash)
    || !isIso(value.createdAt)
    || !isIso(value.updatedAt)
    || Date.parse(value.adoptedDecisionAt) !== Date.parse(value.createdAt)
    || Date.parse(value.createdAt) > Date.parse(value.updatedAt)
    || (value.diagnostic !== undefined && !validators.diagnostic(value.diagnostic))
    || (value.failureEvidence !== undefined && !validators.failureEvidence(value.failureEvidence))
    || (value.writeApproval !== undefined && !validators.writeApproval(value.writeApproval))
    || !isParent(value.parent)
    || !validators.lifecycle(
      value.lifecycle,
      value.state,
      value.admissionProfileId,
      value.createdAt,
      value.updatedAt,
    )
  ) {
    throw new Error("invalid_legacy_v12_agent_task");
  }

  const legacy = value as unknown as LegacyV12AgentTaskRecord;
  const validationView = legacy as unknown as AgentTaskRecord;
  if (
    legacy.dispatch.kind === "economic"
      ? (
        legacy.dispatch.candidateSet.economicPolicyId !== legacy.dispatch.economicPolicyId
        || legacy.dispatch.candidateSet.economicPolicyRevision !== legacy.dispatch.economicPolicyRevision
        || legacy.dispatch.candidateSet.admissionProfileId !== legacy.admissionProfileId
        || !validators.sameEconomicConstraints(legacy.dispatch.candidateSet.constraints, legacy.dispatch.constraints)
        || (legacy.dispatch.dispatchFenceId !== undefined && !validators.economicDispatchFenceId(legacy.dispatch.dispatchFenceId))
        || (legacy.state === "queued" && legacy.dispatch.dispatchFenceId !== undefined)
        || (legacy.state === "running" && legacy.dispatch.dispatchFenceId === undefined)
      )
      : (
        legacy.dispatch.admissionProfileId !== legacy.admissionProfileId
        || (legacy.dispatch.dispatchFenceId !== undefined && !validators.nativeDispatchFenceId(legacy.dispatch.dispatchFenceId))
        || (legacy.state === "queued" && legacy.dispatch.dispatchFenceId !== undefined)
        || (legacy.state === "running" && legacy.dispatch.dispatchFenceId === undefined)
      )
    || (legacy.state === "succeeded" && legacy.result === undefined)
    || (legacy.state !== "succeeded" && legacy.result !== undefined)
    || (validators.approvedWriteProfile(legacy.admissionProfileId) && legacy.state !== "awaiting_approval" && legacy.writeApproval === undefined)
    || (!validators.approvedWriteProfile(legacy.admissionProfileId) && legacy.writeApproval !== undefined)
    || (legacy.state !== "failed" && legacy.state !== "timed_out" && legacy.failureEvidence !== undefined)
    || (legacy.failureEvidence === undefined && legacy.lifecycle.some((entry) => entry.failureEvidence !== undefined))
    || (legacy.failureEvidence !== undefined && JSON.stringify(legacy.lifecycle.at(-1)?.failureEvidence) !== JSON.stringify(legacy.failureEvidence))
    || (legacy.result !== undefined && !validators.result(legacy.result, validationView, legacy.updatedAt))
  ) {
    throw new Error("invalid_legacy_v12_agent_task");
  }
  return legacy;
}

function isParent(value: unknown): boolean {
  return value === undefined || (
    isRecord(value)
    && hasOnly(value, ["invocationId", "turnId"])
    && isIdentifier(value.invocationId)
    && isIdentifier(value.turnId)
  );
}

function isState(value: unknown): value is AgentTaskState {
  return typeof value === "string"
    && ["awaiting_approval", "queued", "running", "succeeded", "failed", "timed_out", "interrupted", "cancelled"].includes(value);
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
}

function isCanonicalHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
