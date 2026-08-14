import type {
  DeliberationResolution,
  ManagedAgentAdmissionProfile,
} from "@kilnai/core";
import type { ManagedEconomicCandidateSet } from "../agents/managed-invocation/runtime-tool/index.js";
import {
  AGENT_TASK_SCHEMA_VERSION,
  AGENT_TASK_STATES,
  type AgentTaskDiagnosticCode,
  type AgentTaskFailureEvidence,
  type AgentTaskLifecycleEntry,
  type AgentTaskRecord,
  type AgentTaskState,
} from "./contracts.js";

export type ValidationRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is ValidationRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOnly(value: ValidationRecord, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(value);
}

export function isBoundedOpaqueIdentity(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 300
    && value.trim() === value
    && !/[\u0000-\u001F\u007F]/u.test(value);
}

export function isCanonicalHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value);
}

export function isIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

export function isManagedAgentAdmissionProfile(value: unknown): value is ManagedAgentAdmissionProfile {
  return value === "foundation-readonly-plan"
    || value === "foundation-propose-writes"
    || value === "foundation-apply-approved-writes"
    || value === "foundation-memory-write-proposals";
}

export function isApprovedWriteProfile(
  value: ManagedAgentAdmissionProfile,
): value is "foundation-apply-approved-writes" {
  return value === "foundation-apply-approved-writes";
}

export function isNativeHarnessDispatchFenceId(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("native-harness-dispatch:")
    && isIdentifier(value.slice("native-harness-dispatch:".length));
}

export function isManagedEconomicDispatchFenceId(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("managed-economic-dispatch:")
    && isIdentifier(value.slice("managed-economic-dispatch:".length));
}

export function isNonterminal(state: AgentTaskState): boolean {
  return state === "awaiting_approval" || state === "queued" || state === "running";
}

export function isDiagnostic(value: unknown): value is AgentTaskDiagnosticCode {
  return typeof value === "string" && [
    "invalid_request", "project_identity_unavailable", "governance_unavailable",
    "governance_not_authoritative", "admission_denied", "profile_unavailable",
    "route_unavailable", "idempotency_conflict", "identity-revision-conflict",
    "job_persistence_unavailable", "job_persistence_corrupt", "unknown_job",
    "invalid_transition", "provider_rejected", "provider_timeout",
    "account_lease_unavailable", "economic_commitment_unavailable", "invocation_failed",
    "unauthorized_job", "result_pending", "result_unavailable", "result_persistence_failure",
    "result_corrupt", "cancelled", "replay_unavailable",
  ].includes(value);
}

export function canTransition(from: AgentTaskState, to: AgentTaskState): boolean {
  if (from === to) return false;
  if (from === "awaiting_approval") {
    return to === "queued" || to === "cancelled" || to === "interrupted" || to === "failed";
  }
  if (from === "queued") {
    return to === "running" || to === "failed" || to === "interrupted" || to === "cancelled";
  }
  return from === "running"
    && (to === "succeeded" || to === "failed" || to === "timed_out" || to === "interrupted" || to === "cancelled");
}

export function lifecycleEntry(
  sequence: number,
  state: AgentTaskState,
  observedAt: string,
  diagnostic?: AgentTaskDiagnosticCode,
  failureEvidence?: AgentTaskFailureEvidence,
): AgentTaskLifecycleEntry {
  return {
    sequence,
    state,
    observedAt,
    ...(diagnostic ? { diagnostic } : {}),
    ...(failureEvidence ? { failureEvidence } : {}),
  };
}

export function cloneAgentTask(value: AgentTaskRecord): AgentTaskRecord {
  return structuredClone(value);
}

export function isValidAgentTaskConstraints(value: unknown): boolean {
  return isRecord(value)
    && hasOnly(value, ["routeId", "providerId", "model"])
    && (value.routeId === undefined || isIdentifier(value.routeId))
    && (value.providerId === undefined || isIdentifier(value.providerId))
    && (value.model === undefined || isBoundedOpaqueIdentity(value.model));
}

export function normalizeAgentTaskConstraints(
  constraints: {
    readonly routeId?: string;
    readonly providerId?: string;
    readonly model?: string;
  } | undefined,
): { readonly routeId?: string; readonly providerId?: string; readonly model?: string } {
  return {
    ...(constraints?.routeId ? { routeId: constraints.routeId } : {}),
    ...(constraints?.providerId ? { providerId: constraints.providerId } : {}),
    ...(constraints?.model ? { model: constraints.model } : {}),
  };
}

export function sameAgentTaskConstraints(
  left: ManagedEconomicCandidateSet["constraints"],
  right: { readonly routeId?: string; readonly providerId?: string; readonly model?: string },
): boolean {
  return JSON.stringify(normalizeAgentTaskConstraints(left))
    === JSON.stringify(normalizeAgentTaskConstraints(right));
}

export function isEconomicAttemptId(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("economic-attempt:")
    && isIdentifier(value.slice("economic-attempt:".length));
}

export function isManagedAgentRouteSource(value: unknown): boolean {
  return value === "ordered-routing"
    || value === "explicit-managed-route"
    || value === "managed-default-route"
    || value === "enabled-engine-fallback";
}

export function isDeliberationSource(value: unknown): value is DeliberationResolution["source"] {
  return value === "operator"
    || value === "work-item"
    || value === "agent-profile"
    || value === "route"
    || value === "task"
    || value === "project"
    || value === "provider-default";
}

export function isCanonicalKilnDiagnosticUri(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const uri = new URL(value);
    if (
      uri.protocol !== "kiln:"
      || uri.port !== ""
      || uri.username !== ""
      || uri.password !== ""
      || uri.search !== ""
      || uri.hash !== ""
    ) return false;
    const segments = uri.pathname.split("/").filter(Boolean);
    if (uri.hostname === "diagnostics") {
      return segments.length > 0
        && segments.every((segment) => /^[a-z0-9][a-z0-9-]*$/u.test(segment));
    }
    return uri.hostname === "managed-agents"
      && segments.length >= 4
      && segments[0] === "invocations"
      && segments[2] === "resources"
      && segments.every((segment) => /^[A-Za-z0-9][A-Za-z0-9:._%-]*$/u.test(segment));
  } catch {
    return false;
  }
}

export function isFreshEvidence(
  value: { readonly issuedAt: string; readonly validUntil: string },
  now: Date,
): boolean {
  return isIso(value.issuedAt)
    && isIso(value.validUntil)
    && Date.parse(value.issuedAt) <= now.getTime()
    && now.getTime() <= Date.parse(value.validUntil);
}

export function isValidLifecycle(
  value: unknown,
  state: AgentTaskState,
  admissionProfileId: ManagedAgentAdmissionProfile,
  createdAt: string,
  updatedAt: string,
): value is readonly AgentTaskLifecycleEntry[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  let previousTime = Number.NEGATIVE_INFINITY;
  for (const [index, entry] of value.entries()) {
    if (
      !isRecord(entry)
      || !hasOnly(entry, ["sequence", "state", "observedAt", "diagnostic", "failureEvidence"])
      || entry.sequence !== index + 1
      || !AGENT_TASK_STATES.includes(entry.state as AgentTaskState)
      || !isIso(entry.observedAt)
      || (entry.diagnostic !== undefined && !isDiagnostic(entry.diagnostic))
      || (entry.failureEvidence !== undefined
        && (!isValidFailureEvidenceShape(entry.failureEvidence)
          || (entry.state !== "failed" && entry.state !== "timed_out")))
    ) return false;
    const observedAt = Date.parse(entry.observedAt);
    if (observedAt < previousTime) return false;
    previousTime = observedAt;
  }
  const first = value[0] as unknown as AgentTaskLifecycleEntry;
  const last = value[value.length - 1] as unknown as AgentTaskLifecycleEntry;
  return first.state === (isApprovedWriteProfile(admissionProfileId) ? "awaiting_approval" : "queued")
    && Date.parse(first.observedAt) === Date.parse(createdAt)
    && last.state === state
    && Date.parse(last.observedAt) <= Date.parse(updatedAt);
}

function isValidFailureEvidenceShape(value: unknown): boolean {
  if (!isRecord(value) || !hasOnly(value, ["version", "classification", "diagnosticUri", "transportPhase"])) return false;
  return value.version === 1
    && typeof value.classification === "string"
    && (value.diagnosticUri === undefined || isCanonicalKilnDiagnosticUri(value.diagnosticUri))
    && (value.transportPhase === undefined
      || ["headers", "first_byte", "chunk_idle", "transport"].includes(value.transportPhase as string));
}

export function assertSchemaVersion(value: unknown): value is typeof AGENT_TASK_SCHEMA_VERSION {
  return value === AGENT_TASK_SCHEMA_VERSION;
}

export { AGENT_TASK_STATES };
