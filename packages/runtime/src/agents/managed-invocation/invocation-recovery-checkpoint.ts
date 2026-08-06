import type { ManagedAccountLeaseEvidence, ManagedAgentResourceLeaseEvidence } from "@kilnai/core";
import { validateManagedAgentRuntimeRecoveryCheckpoint } from "./recovery-store.js";
import type {
  ManagedAgentRuntimeEconomicDispatchCheckpoint,
  ManagedAgentRuntimeRecoveryCheckpoint,
} from "./recovery-store.js";
import { cloneJson } from "./runtime-primitives.js";
import { deferredTerminal } from "./invocation-lifecycle-events.js";
import type {
  ManagedAgentRuntimeInvocationEntry,
  ManagedAgentRuntimeInvocationLifecycleOptions,
  ManagedAgentRuntimeInvocationSnapshot,
} from "./invocation-service.js";

export function isRuntimeRecoveryCleanupResolved(
  cleanupStatus: ManagedAgentResourceLeaseEvidence["cleanupStatus"] | undefined,
): boolean {
  return cleanupStatus === "completed" || cleanupStatus === "not-required";
}

export function economicDispatchCheckpoint(
  dispatch: NonNullable<ManagedAgentRuntimeInvocationLifecycleOptions["economicDispatch"]>,
): ManagedAgentRuntimeEconomicDispatchCheckpoint {
  return {
    commitmentId: dispatch.commitment.commitmentId,
    jobId: dispatch.commitment.reservation.jobId,
    economicAttemptId: dispatch.commitment.reservation.economicAttemptId,
    dispatchFenceId: dispatch.dispatchFenceId,
  };
}

export function invocationEntryFromRecoveryCheckpoint(
  checkpoint: ManagedAgentRuntimeRecoveryCheckpoint,
): ManagedAgentRuntimeInvocationEntry {
  const validated = validateManagedAgentRuntimeRecoveryCheckpoint(checkpoint);
  const terminal = deferredTerminal();
  terminal.promise.catch(() => undefined);
  return {
    request: cloneJson(validated.request),
    decision: cloneJson(validated.decision),
    lifecycleState: validated.lifecycleState,
    startedAt: new Date(validated.startedAt),
    abortController: new AbortController(),
    runtimeLease: cloneJson(validated.runtimeLease),
    runtimeLeaseForRelease: cloneJson(validated.runtimeLeaseForRelease),
    acquiredLeaseStages: [...validated.acquiredLeaseStages],
    releasedLeaseStages: [...validated.releasedLeaseStages],
    promptInbox: [],
    progressEvents: [],
    adapterStarted: validated.adapterStarted,
    ...(validated.economicDispatch !== undefined
      ? { economicDispatch: cloneJson(validated.economicDispatch) }
      : {}),
    ...(validated.finishedAt !== undefined ? { finishedAt: new Date(validated.finishedAt) } : {}),
    ...(validated.record !== undefined ? { record: cloneJson(validated.record) } : {}),
    ...(validated.error !== undefined ? { error: new Error(validated.error.message) } : {}),
    terminal,
  };
}

export function recoveryCheckpointFromInvocationEntry(
  entry: ManagedAgentRuntimeInvocationEntry,
): ManagedAgentRuntimeRecoveryCheckpoint {
  const runtimeLease = entry.runtimeLease ?? entry.decision.capabilitySnapshot.resourceLease;
  const runtimeLeaseForRelease = entry.runtimeLeaseForRelease ?? runtimeLease;
  return validateManagedAgentRuntimeRecoveryCheckpoint({
    version: 2,
    lifecycleState: entry.lifecycleState,
    request: cloneJson(entry.request),
    decision: cloneJson(entry.decision),
    startedAt: entry.startedAt.toISOString(),
    ...(entry.finishedAt !== undefined ? { finishedAt: entry.finishedAt.toISOString() } : {}),
    runtimeLease: cloneJson(runtimeLease),
    runtimeLeaseForRelease: cloneJson(runtimeLeaseForRelease),
    acquiredLeaseStages: [...entry.acquiredLeaseStages],
    releasedLeaseStages: [...entry.releasedLeaseStages],
    adapterStarted: entry.adapterStarted,
    ...(entry.economicDispatch !== undefined
      ? { economicDispatch: cloneJson(entry.economicDispatch) }
      : {}),
    ...(entry.record !== undefined ? { record: cloneJson(entry.record) } : {}),
    ...(entry.error !== undefined ? { error: { message: entry.error.message } } : {}),
    updatedAt: new Date().toISOString(),
  });
}

export function staleRecoveryReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Managed invocation marked stale by runtime recovery.";
}

export function persistedRecoveryReason(reason: string | undefined): string {
  const trimmed = reason?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : "Managed invocation recovered after runtime restart.";
}

export function mergeRecoveredAccountLeases(
  classified: readonly ManagedAccountLeaseEvidence[],
  recovered: readonly ManagedAgentRuntimeInvocationSnapshot[],
): readonly ManagedAccountLeaseEvidence[] {
  const leases = new Map(classified.map((lease) => [lease.runtimeInvocationId, lease]));
  for (const snapshot of recovered) {
    if (snapshot.record?.accountLease !== undefined) {
      leases.set(snapshot.request.invocationId, snapshot.record.accountLease);
    }
  }
  return [...leases.values()].sort((left, right) =>
    left.runtimeInvocationId.localeCompare(right.runtimeInvocationId));
}
