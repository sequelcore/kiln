import type { ManagedAgentAdmissionProfile } from "@kilnai/core";
import {
  AGENT_TASK_SCHEMA_VERSION,
  AGENT_TASK_STATES,
  type AgentTaskDispatch,
  type AgentTaskFailureEvidence,
  type AgentTaskLifecycleEntry,
  type AgentTaskRecord,
  type AgentTaskResult,
  type AgentTaskState,
  type AgentTaskWriteApproval,
} from "./contracts.js";
import { AgentTaskApplicationError } from "./errors.js";
import {
  hasOnly,
  isApprovedWriteProfile,
  isCanonicalHash,
  isDiagnostic,
  isIdentifier,
  isIso,
  isManagedAgentAdmissionProfile,
  isNativeHarnessDispatchFenceId,
  isRecord,
  isValidLifecycle,
  sameAgentTaskConstraints,
} from "./validation-primitives.js";
import {
  isValidAgentTaskDispatch,
  isValidAgentTaskFailureEvidence,
  isValidAgentTaskResult,
  isValidAgentTaskWriteApproval,
} from "./agent-run-validation.js";

export interface StoredAgentTaskValidators {
  readonly record: (value: unknown) => value is Record<string, unknown>;
  readonly hasOnly: (value: Record<string, unknown>, keys: readonly string[]) => boolean;
  readonly identifier: (value: unknown) => value is string;
  readonly iso: (value: unknown) => value is string;
  readonly canonicalHash: (value: unknown) => value is string;
  readonly admissionProfile: (value: unknown) => value is ManagedAgentAdmissionProfile;
  readonly dispatch: (value: unknown) => value is AgentTaskDispatch;
  readonly diagnostic: (value: unknown) => boolean;
  readonly failureEvidence: (value: unknown) => value is AgentTaskFailureEvidence;
  readonly writeApproval: (value: unknown) => value is AgentTaskWriteApproval;
  readonly lifecycle: (
    value: unknown,
    state: AgentTaskState,
    profile: ManagedAgentAdmissionProfile,
    createdAt: string,
    updatedAt: string,
  ) => value is readonly AgentTaskLifecycleEntry[];
  readonly sameConstraints: (
    left: Extract<AgentTaskDispatch, { readonly kind: "economic" }>["candidateSet"]["constraints"],
    right: Extract<AgentTaskDispatch, { readonly kind: "economic" }>["constraints"],
  ) => boolean;
  readonly nativeFenceId: (value: unknown) => boolean;
  readonly approvedWriteProfile: (value: ManagedAgentAdmissionProfile) => boolean;
  readonly result: (value: unknown, task: AgentTaskRecord, updatedAt: string) => value is AgentTaskResult;
}

export function validateStoredAgentTask(value: unknown, v: StoredAgentTaskValidators): AgentTaskRecord {
  const allowed = [
    "version", "id", "adoptedDecisionAt", "state", "objective", "projectId", "callerId",
    "configuredAgentProfileId", "admissionProfileId", "dispatch", "governanceSource", "admissionId",
    "requestFingerprint", "idempotencyKeyHash", "createdAt", "updatedAt", "parent", "diagnostic",
    "failureEvidence", "result", "writeApproval", "lifecycle", "run",
  ];
  if (
    !v.record(value)
    || value.version !== AGENT_TASK_SCHEMA_VERSION
    || !v.hasOnly(value, allowed)
    || !v.identifier(value.id)
    || !v.iso(value.adoptedDecisionAt)
    || !AGENT_TASK_STATES.includes(value.state as AgentTaskState)
    || typeof value.objective !== "string"
    || value.objective.trim().length === 0
    || value.objective.length > 12000
    || !v.identifier(value.projectId)
    || !v.identifier(value.callerId)
    || !v.identifier(value.configuredAgentProfileId)
    || !v.admissionProfile(value.admissionProfileId)
    || !v.dispatch(value.dispatch)
    || !v.record(value.run)
    || !v.hasOnly(value.run, ["runId", "state", "dispatch", "result", "failureEvidence", "dataPolicyProof"])
    || !v.identifier(value.run.runId)
    || value.run.runId !== `agent-run:${value.id}`
    || value.run.state !== value.state
    || !v.dispatch(value.run.dispatch)
    || JSON.stringify(value.run.dispatch) !== JSON.stringify(value.dispatch)
    || !v.identifier(value.governanceSource)
    || !v.identifier(value.admissionId)
    || !v.canonicalHash(value.requestFingerprint)
    || !v.canonicalHash(value.idempotencyKeyHash)
    || !v.iso(value.createdAt)
    || !v.iso(value.updatedAt)
    || Date.parse(value.adoptedDecisionAt) !== Date.parse(value.createdAt)
    || Date.parse(value.createdAt) > Date.parse(value.updatedAt)
    || (value.diagnostic !== undefined && !v.diagnostic(value.diagnostic))
    || (value.failureEvidence !== undefined && !v.failureEvidence(value.failureEvidence))
    || (value.writeApproval !== undefined && !v.writeApproval(value.writeApproval))
    || !validParent(value.parent, v)
    || !v.lifecycle(value.lifecycle, value.state as AgentTaskState, value.admissionProfileId, value.createdAt, value.updatedAt)
  ) throw new Error("invalid_stored_agent_task");

  const task = value as unknown as AgentTaskRecord;
  if (
    task.dispatch.kind === "economic" ? (
      task.dispatch.candidateSet.economicPolicyId !== task.dispatch.economicPolicyId
      || task.dispatch.candidateSet.economicPolicyRevision !== task.dispatch.economicPolicyRevision
      || task.dispatch.candidateSet.admissionProfileId !== task.admissionProfileId
      || !v.sameConstraints(task.dispatch.candidateSet.constraints, task.dispatch.constraints)
      || (task.state === "queued" && task.dispatch.dispatchFenceId !== undefined)
      || (task.state === "running" && task.dispatch.dispatchFenceId === undefined)
    ) : (
      task.dispatch.admissionProfileId !== task.admissionProfileId
      || (task.dispatch.dispatchFenceId !== undefined && !v.nativeFenceId(task.dispatch.dispatchFenceId))
      || (task.state === "queued" && task.dispatch.dispatchFenceId !== undefined)
      || (task.state === "running" && task.dispatch.dispatchFenceId === undefined)
    )
    || (task.state === "succeeded" && !task.result)
    || (task.state !== "succeeded" && task.result !== undefined)
    || (v.approvedWriteProfile(task.admissionProfileId) && task.state !== "awaiting_approval" && task.writeApproval === undefined)
    || (!v.approvedWriteProfile(task.admissionProfileId) && task.writeApproval !== undefined)
    || (task.state !== "failed" && task.state !== "timed_out" && task.failureEvidence !== undefined)
    || (task.failureEvidence === undefined && task.lifecycle.some((entry) => entry.failureEvidence !== undefined))
    || (task.failureEvidence !== undefined && JSON.stringify(task.lifecycle.at(-1)?.failureEvidence) !== JSON.stringify(task.failureEvidence))
    || (task.result !== undefined && !v.result(task.result, task, task.updatedAt))
    || (task.state === "succeeded"
      ? task.run.result === undefined || JSON.stringify(task.run.result) !== JSON.stringify(task.result)
      : task.run.result !== undefined)
    || (task.state === "failed" || task.state === "timed_out"
      ? task.failureEvidence === undefined
        ? task.run.failureEvidence !== undefined
        : JSON.stringify(task.run.failureEvidence) !== JSON.stringify(task.failureEvidence)
      : task.run.failureEvidence !== undefined)
    || (task.run.result !== undefined && JSON.stringify(task.run.result) !== JSON.stringify(task.result))
    || (task.run.failureEvidence !== undefined && JSON.stringify(task.run.failureEvidence) !== JSON.stringify(task.failureEvidence))
    || JSON.stringify(task.run.dataPolicyProof) !== JSON.stringify(task.result?.dataPolicyProof)
  ) throw new Error("invalid_stored_agent_task");
  return task;
}

function validParent(value: unknown, v: StoredAgentTaskValidators): boolean {
  return value === undefined || (
    v.record(value)
    && v.hasOnly(value, ["invocationId", "turnId"])
    && v.identifier(value.invocationId)
    && v.identifier(value.turnId)
  );
}

export function validateStoredJob(value: unknown): AgentTaskRecord {
  try {
    return validateStoredAgentTask(value, {
      record: isRecord,
      hasOnly,
      identifier: isIdentifier,
      iso: isIso,
      canonicalHash: isCanonicalHash,
      admissionProfile: isManagedAgentAdmissionProfile,
      dispatch: isValidAgentTaskDispatch,
      diagnostic: isDiagnostic,
      failureEvidence: isValidAgentTaskFailureEvidence,
      writeApproval: isValidAgentTaskWriteApproval,
      lifecycle: isValidLifecycle,
      sameConstraints: sameAgentTaskConstraints,
      nativeFenceId: isNativeHarnessDispatchFenceId,
      approvedWriteProfile: isApprovedWriteProfile,
      result: isValidAgentTaskResult,
    });
  } catch {
    throw new AgentTaskApplicationError("job_persistence_corrupt", "Repair the agent-task store before retrying.");
  }
}
