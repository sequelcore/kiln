import { defineManagedAgentCapabilitySnapshot, defineManagedAgentInvocationRecord } from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentResourceLeaseEvidence,
  ManagedAgentWorktreeReviewEvidence,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { ManagedAgentLeaseAcquireError, ManagedAgentWorktreeReviewRequiredError } from "./lease-errors.js";
import { samePath } from "./lease-path-support.js";
import { projectManagedInvocationRecordResources } from "./resource-projection.js";
import type { ManagedAgentRuntimeRecoveryLeaseStage } from "./recovery-store.js";
import { cloneJson, uniqueStrings } from "./runtime-primitives.js";
import {
  assertEnvironmentLeaseUrisDoNotContainValues,
  environmentLeaseUrisContainingValues,
  mergeManagedEnvironment,
  sanitizeEnvironmentDiagnostics,
  sanitizeEnvironmentLeaseEvidence,
  validateManagedEnvironment,
} from "./invocation-environment.js";
import {
  isRuntimeRecoveryCleanupResolved,
  recoveryCheckpointFromInvocationEntry,
} from "./invocation-recovery-checkpoint.js";
import type { ManagedAgentRuntimeInvocationEntry, RuntimeManagedAgentInvocationServiceOptions } from "./invocation-service.js";

export function isSideEffectedLeaseAcquireError(error: unknown): boolean {
  return error instanceof ManagedAgentLeaseAcquireError && error.sideEffected;
}

export function markLeaseStageAcquired(
  entry: ManagedAgentRuntimeInvocationEntry,
  stage: ManagedAgentRuntimeRecoveryLeaseStage,
): void {
  if (!entry.acquiredLeaseStages.includes(stage)) {
    entry.acquiredLeaseStages.push(stage);
  }
}

export function shouldCompensateAcquireFailure(error: unknown, entry: ManagedAgentRuntimeInvocationEntry): boolean {
  if (entry.acquiredLeaseStages.length > 0) {
    return true;
  }
  if (error instanceof ManagedAgentRuntimeAdmissionError) {
    return false;
  }
  return false;
}

export async function saveRuntimeRecoveryCheckpoint(
  options: RuntimeManagedAgentInvocationServiceOptions,
  entry: ManagedAgentRuntimeInvocationEntry,
): Promise<void> {
  if (!options.recoveryStore || entry.acquiredLeaseStages.length === 0) {
    return;
  }
  await options.recoveryStore.save(recoveryCheckpointFromInvocationEntry(entry));
}

export async function saveOrDeleteRuntimeRecoveryCheckpoint(
  options: RuntimeManagedAgentInvocationServiceOptions,
  entry: ManagedAgentRuntimeInvocationEntry,
  record: ManagedAgentInvocationRecord,
): Promise<void> {
  if (!options.recoveryStore || entry.acquiredLeaseStages.length === 0) {
    return;
  }
  const accountLeaseResolved = record.accountLease === undefined
    || record.accountLease.lifecycleState === "released";
  if (isRuntimeRecoveryCleanupResolved(record.resourceLease?.cleanupStatus) && accountLeaseResolved) {
    await options.recoveryStore.delete(entry.request.invocationId);
    return;
  }
  await options.recoveryStore.save(recoveryCheckpointFromInvocationEntry({
    ...entry,
    ...(record.resourceLease !== undefined ? { runtimeLease: record.resourceLease } : {}),
    record,
  }));
}

export async function acquireRuntimeResourceLeases(
  options: RuntimeManagedAgentInvocationServiceOptions,
  entry: ManagedAgentRuntimeInvocationEntry,
): Promise<void> {
  let lease = entry.decision.capabilitySnapshot.resourceLease;
  if (entry.request.authority.workingDirectory.mode === "isolated-worktree") {
    if (!options.worktreeLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent isolated worktree lease manager is required");
    }
    try {
      lease = validateResourceLease(entry.request, entry.decision, await options.worktreeLeaseManager.acquire({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        abortSignal: entry.abortController.signal,
      }));
    } catch (error) {
      if (isSideEffectedLeaseAcquireError(error)) {
        markLeaseStageAcquired(entry, "worktree");
        await saveRuntimeRecoveryCheckpoint(options, entry);
      }
      throw error;
    }
    markLeaseStageAcquired(entry, "worktree");
    entry.runtimeLease = lease;
    entry.runtimeLeaseForRelease = lease;
    await saveRuntimeRecoveryCheckpoint(options, entry);
  }
  if (entry.request.authority.workingDirectory.mode === "sandbox") {
    if (!options.sandboxLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent sandbox lease manager is required");
    }
    try {
      lease = validateResourceLease(entry.request, entry.decision, await options.sandboxLeaseManager.acquire({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        abortSignal: entry.abortController.signal,
      }));
    } catch (error) {
      if (isSideEffectedLeaseAcquireError(error)) {
        markLeaseStageAcquired(entry, "sandbox");
        await saveRuntimeRecoveryCheckpoint(options, entry);
      }
      throw error;
    }
    markLeaseStageAcquired(entry, "sandbox");
    entry.runtimeLease = lease;
    entry.runtimeLeaseForRelease = lease;
    await saveRuntimeRecoveryCheckpoint(options, entry);
  }
  if (options.artifactDirectoryLeaseManager) {
    try {
      lease = validateResourceLease(entry.request, entry.decision, await options.artifactDirectoryLeaseManager.acquire({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        abortSignal: entry.abortController.signal,
      }));
    } catch (error) {
      if (isSideEffectedLeaseAcquireError(error)) {
        markLeaseStageAcquired(entry, "artifact-directory");
        await saveRuntimeRecoveryCheckpoint(options, entry);
      }
      throw error;
    }
    markLeaseStageAcquired(entry, "artifact-directory");
    entry.runtimeLease = lease;
    entry.runtimeLeaseForRelease = lease;
    await saveRuntimeRecoveryCheckpoint(options, entry);
  }
  if (options.devServerPortLeaseManager) {
    try {
      lease = validateResourceLease(entry.request, entry.decision, await options.devServerPortLeaseManager.acquire({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        abortSignal: entry.abortController.signal,
      }));
    } catch (error) {
      if (isSideEffectedLeaseAcquireError(error)) {
        markLeaseStageAcquired(entry, "dev-server-port");
        await saveRuntimeRecoveryCheckpoint(options, entry);
      }
      throw error;
    }
    markLeaseStageAcquired(entry, "dev-server-port");
    entry.runtimeLease = lease;
    entry.runtimeLeaseForRelease = lease;
    await saveRuntimeRecoveryCheckpoint(options, entry);
  }
  if (options.environmentLeaseManager) {
    try {
      const previousLease = lease;
      const environmentLease = await options.environmentLeaseManager.acquire({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        abortSignal: entry.abortController.signal,
      });
      markLeaseStageAcquired(entry, "environment");
      lease = validateResourceLease(entry.request, entry.decision, environmentLease.lease);
      entry.runtimeLeaseForRelease = lease;
      await saveRuntimeRecoveryCheckpoint(options, entry);
      let environment: ReturnType<typeof validateManagedEnvironment>;
      try {
        environment = validateManagedEnvironment(environmentLease.environment);
      } catch (error) {
        entry.runtimeLease = lease;
        throw error;
      }
      entry.runtimeEnvironment = mergeManagedEnvironment(
        entry.runtimeEnvironment,
        environment,
      );
      const leakingUris = environmentLeaseUrisContainingValues(previousLease, lease, environment);
      if (leakingUris.length > 0) {
        entry.environmentValueLeakingUris = uniqueStrings([
          ...(entry.environmentValueLeakingUris ?? []),
          ...leakingUris,
        ]);
        throw new ManagedAgentRuntimeAdmissionError("Managed environment lease URI must not contain environment binding values");
      }
      entry.runtimeLease = lease;
    } catch (error) {
      if (isSideEffectedLeaseAcquireError(error)) {
        markLeaseStageAcquired(entry, "environment");
        await saveRuntimeRecoveryCheckpoint(options, entry);
      }
      throw error;
    }
  }
  if (entry.request.authority.credentialRoute.mode !== "credentialless") {
    if (!options.credentialRouteLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent credential-route lease manager is required");
    }
    try {
      lease = validateResourceLease(entry.request, entry.decision, await options.credentialRouteLeaseManager.acquire({
        request: cloneJson(entry.request),
        decision: cloneJson(entry.decision),
        lease: cloneJson(lease),
        abortSignal: entry.abortController.signal,
      }));
    } catch (error) {
      if (isSideEffectedLeaseAcquireError(error)) {
        markLeaseStageAcquired(entry, "credential-route");
        await saveRuntimeRecoveryCheckpoint(options, entry);
      }
      throw error;
    }
    markLeaseStageAcquired(entry, "credential-route");
    entry.runtimeLease = lease;
    entry.runtimeLeaseForRelease = lease;
    await saveRuntimeRecoveryCheckpoint(options, entry);
  }
}

export async function finalizeTerminalLeaseStages(
  options: RuntimeManagedAgentInvocationServiceOptions,
  entry: ManagedAgentRuntimeInvocationEntry,
  record: ManagedAgentInvocationRecord,
): Promise<ManagedAgentInvocationRecord> {
  const recordWasCurrent = record === entry.record;
  const finalize = async (): Promise<ManagedAgentInvocationRecord> => {
    const recordForFinalization = recordWasCurrent ? (entry.record ?? record) : record;
    const finalizedRecord = await finalizeTerminalLease(options, entry, recordForFinalization);
    entry.record = finalizedRecord;
    return finalizedRecord;
  };
  const previousFinalization = entry.leaseFinalization;
  const nextFinalization = previousFinalization
    ? previousFinalization.then(finalize, finalize)
    : finalize();
  entry.leaseFinalization = nextFinalization;
  try {
    return await nextFinalization;
  } finally {
    if (entry.leaseFinalization === nextFinalization) {
      entry.leaseFinalization = undefined;
    }
  }
}

export async function currentTerminalRecord(entry: ManagedAgentRuntimeInvocationEntry): Promise<ManagedAgentInvocationRecord> {
  if (entry.leaseFinalization) {
    return entry.leaseFinalization;
  }
  if (entry.record) {
    return defineManagedAgentInvocationRecord(entry.record);
  }
  throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation has no terminal record");
}

async function finalizeTerminalLease(
  options: RuntimeManagedAgentInvocationServiceOptions,
  entry: ManagedAgentRuntimeInvocationEntry,
  record: ManagedAgentInvocationRecord,
): Promise<ManagedAgentInvocationRecord> {
  const resourceLeaseForRelease = runtimeLeaseForTerminalRelease(entry, record);
  const leaseStagesToRelease = [...entry.acquiredLeaseStages]
    .reverse()
    .filter((stage) => !entry.releasedLeaseStages.includes(stage));
  if (!resourceLeaseForRelease || entry.acquiredLeaseStages.length === 0) {
    const finalizedRecord = projectManagedInvocationRecordResources(defineManagedAgentInvocationRecord(record));
    await saveOrDeleteRuntimeRecoveryCheckpoint(options, entry, finalizedRecord);
    return finalizedRecord;
  }
  let resourceLease = resourceLeaseForRelease;
  const diagnostics: Array<NonNullable<ManagedAgentInvocationRecord["diagnostics"]>[number]> = [...(record.diagnostics ?? [])];
  const cleanupFailureUris: string[] = [];
  for (const stage of leaseStagesToRelease) {
    entry.releasedLeaseStages.push(stage);
    try {
      const previousLease = resourceLease;
      resourceLease = mergeRuntimeLeaseRelease(
        previousLease,
        await releaseRuntimeResourceLeaseStage(options, stage, entry, record, resourceLease),
      );
      if (resourceLease.cleanupStatus === "failed") {
        const newDiagnosticUris = resourceLease.diagnosticUris.filter((uri) => !previousLease.diagnosticUris.includes(uri));
        diagnostics.push(
          ...newDiagnosticUris.map((uri) => ({
            uri,
            kind: "cleanup" as const,
          })),
        );
      }
    } catch (error) {
      const cleanupDiagnosticUri = `kiln://artifacts/${entry.request.invocationId}/${cleanupFailureResourceName(stage)}-cleanup-failed`;
      const worktreeReview = worktreeReviewEvidenceForCleanupFailure(stage, entry.request.invocationId, error);
      const worktreeReviewDiagnosticUris = worktreeReview?.diagnosticUris ?? [];
      cleanupFailureUris.push(cleanupDiagnosticUri);
      resourceLease = {
        ...resourceLease,
        healthStatus: "leaked",
        cleanupStatus: "failed",
        diagnosticUris: uniqueStrings([
          ...resourceLease.diagnosticUris,
          cleanupDiagnosticUri,
          ...worktreeReviewDiagnosticUris,
        ]),
        ...(worktreeReview !== undefined ? { worktreeReview } : {}),
      };
      diagnostics.push(
        {
          uri: cleanupDiagnosticUri,
          kind: "cleanup",
        },
        ...worktreeReviewDiagnosticUris.map((uri) => ({
          uri,
          kind: "cleanup" as const,
        })),
      );
    }
  }
  const terminalResourceLease = sanitizeEnvironmentLeaseEvidence(resourceLease, entry.environmentValueLeakingUris);
  const terminalDiagnostics = sanitizeEnvironmentDiagnostics(diagnostics, entry.environmentValueLeakingUris);
  const finalizedRecord = projectManagedInvocationRecordResources(
    defineManagedAgentInvocationRecord({
      ...record,
      resourceLease: {
        ...terminalResourceLease,
        ...(cleanupFailureUris.length > 0
          ? {
              healthStatus: "leaked" as const,
              cleanupStatus: "failed" as const,
              diagnosticUris: uniqueStrings([...terminalResourceLease.diagnosticUris, ...cleanupFailureUris]),
            }
          : {}),
      },
      ...(terminalDiagnostics.length > 0 ? { diagnostics: terminalDiagnostics } : {}),
    }),
  );
  await saveOrDeleteRuntimeRecoveryCheckpoint(options, entry, finalizedRecord);
  return finalizedRecord;
}

async function releaseRuntimeResourceLeaseStage(
  options: RuntimeManagedAgentInvocationServiceOptions,
  stage: ManagedAgentRuntimeRecoveryLeaseStage,
  entry: ManagedAgentRuntimeInvocationEntry,
  record: ManagedAgentInvocationRecord,
  lease: ManagedAgentResourceLeaseEvidence,
): Promise<ManagedAgentResourceLeaseEvidence> {
  if (stage === "credential-route") {
    if (!options.credentialRouteLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent credential-route lease manager is required");
    }
    return validateResourceLease(entry.request, entry.decision, await options.credentialRouteLeaseManager.release({
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      lease: cloneJson(lease),
      record: cloneJson(record),
    }));
  }
  if (stage === "environment") {
    if (!options.environmentLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent environment lease manager is required");
    }
    const releasedLease = validateResourceLease(entry.request, entry.decision, await options.environmentLeaseManager.release({
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      lease: cloneJson(lease),
      record: cloneJson(record),
    }));
    if (entry.runtimeEnvironment !== undefined) {
      assertEnvironmentLeaseUrisDoNotContainValues(lease, releasedLease, entry.runtimeEnvironment);
    }
    return releasedLease;
  }
  if (stage === "dev-server-port") {
    if (!options.devServerPortLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent dev-server port lease manager is required");
    }
    return validateResourceLease(entry.request, entry.decision, await options.devServerPortLeaseManager.release({
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      lease: cloneJson(lease),
      record: cloneJson(record),
    }));
  }
  if (stage === "artifact-directory") {
    if (!options.artifactDirectoryLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent artifact-directory lease manager is required");
    }
    return validateResourceLease(entry.request, entry.decision, await options.artifactDirectoryLeaseManager.release({
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      lease: cloneJson(lease),
      record: cloneJson(record),
    }));
  }
  if (stage === "sandbox") {
    if (!options.sandboxLeaseManager) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent sandbox lease manager is required");
    }
    return validateResourceLease(entry.request, entry.decision, await options.sandboxLeaseManager.release({
      request: cloneJson(entry.request),
      decision: cloneJson(entry.decision),
      lease: cloneJson(lease),
      record: cloneJson(record),
    }));
  }
  if (!options.worktreeLeaseManager) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent isolated worktree lease manager is required");
  }
  return validateResourceLease(entry.request, entry.decision, await options.worktreeLeaseManager.release({
    request: cloneJson(entry.request),
    decision: cloneJson(entry.decision),
    lease: cloneJson(lease),
    record: cloneJson(record),
  }));
}

function runtimeLeaseForTerminalRelease(
  entry: ManagedAgentRuntimeInvocationEntry,
  record: ManagedAgentInvocationRecord,
): ManagedAgentResourceLeaseEvidence | undefined {
  const runtimeLease = entry.runtimeLeaseForRelease ?? entry.runtimeLease;
  if (runtimeLease && record.resourceLease) {
    return mergeRuntimeLeaseRelease(runtimeLease, record.resourceLease);
  }
  return runtimeLease ?? record.resourceLease;
}

function mergeRuntimeLeaseRelease(
  previousLease: ManagedAgentResourceLeaseEvidence,
  releasedLease: ManagedAgentResourceLeaseEvidence,
): ManagedAgentResourceLeaseEvidence {
  const hasFailedCleanup = previousLease.cleanupStatus === "failed" || releasedLease.cleanupStatus === "failed";
  const hasLeakedHealth = previousLease.healthStatus === "leaked" || releasedLease.healthStatus === "leaked";
  return {
    ...releasedLease,
    healthStatus: hasLeakedHealth ? "leaked" : releasedLease.healthStatus,
    cleanupStatus: hasFailedCleanup ? "failed" : releasedLease.cleanupStatus,
    resourceUris: uniqueStrings([...previousLease.resourceUris, ...releasedLease.resourceUris]),
    diagnosticUris: uniqueStrings([...previousLease.diagnosticUris, ...releasedLease.diagnosticUris]),
    ...(releasedLease.worktreeReview !== undefined || previousLease.worktreeReview !== undefined
      ? { worktreeReview: releasedLease.worktreeReview ?? previousLease.worktreeReview }
      : {}),
    ...(releasedLease.worktreeConflict !== undefined || previousLease.worktreeConflict !== undefined
      ? { worktreeConflict: releasedLease.worktreeConflict ?? previousLease.worktreeConflict }
      : {}),
  };
}

function cleanupFailureResourceName(stage: ManagedAgentRuntimeRecoveryLeaseStage): string {
  switch (stage) {
    case "worktree":
      return "worktree-lease";
    case "sandbox":
      return "sandbox-policy";
    case "artifact-directory":
      return "artifact-directory";
    case "dev-server-port":
      return "dev-server-port";
    case "environment":
      return "environment";
    case "credential-route":
      return "credential-route";
  }

  const unreachableStage: never = stage;
  return unreachableStage;
}

function worktreeReviewEvidenceForCleanupFailure(
  stage: ManagedAgentRuntimeRecoveryLeaseStage,
  invocationId: string,
  error: unknown,
): ManagedAgentWorktreeReviewEvidence | undefined {
  if (stage !== "worktree" || !(error instanceof ManagedAgentWorktreeReviewRequiredError)) {
    return undefined;
  }
  return {
    status: "required",
    reason: "dirty-worktree-preserved",
    resourceUris: [`kiln://artifacts/${invocationId}/worktree-review`],
    diagnosticUris: [`kiln://artifacts/${invocationId}/worktree-review-required`],
  };
}

export function validateResourceLease(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  lease: ManagedAgentResourceLeaseEvidence,
): ManagedAgentResourceLeaseEvidence {
  if (lease.worktreeReview !== undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent worktree review evidence is runtime-owned");
  }
  if (lease.worktreeConflict !== undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent worktree conflict evidence is runtime-owned");
  }
  const admittedLease = decision.capabilitySnapshot.resourceLease;
  if (lease.leaseId !== admittedLease.leaseId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease id does not match admission");
  }
  if (lease.createdAt !== admittedLease.createdAt) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease creation timestamp does not match admission");
  }
  if (lease.workingDirectoryMode !== admittedLease.workingDirectoryMode) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease working directory mode does not match admission");
  }
  if (!samePath(lease.workingDirectoryPath, admittedLease.workingDirectoryPath)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime lease working directory path does not match admission");
  }
  assertLeaseUrisWithinInvocation("resource", request.invocationId, admittedLease.resourceUris, lease.resourceUris);
  assertLeaseUrisWithinInvocation("diagnostic", request.invocationId, admittedLease.diagnosticUris, lease.diagnosticUris);
  return defineManagedAgentCapabilitySnapshot({
    ...decision.capabilitySnapshot,
    resourceLease: lease,
  }).resourceLease;
}

function assertLeaseUrisWithinInvocation(
  kind: string,
  invocationId: string,
  admittedUris: readonly string[],
  candidateUris: readonly string[],
): void {
  for (const uri of admittedUris) {
    if (!candidateUris.includes(uri)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime lease dropped admitted ${kind} uri`);
    }
  }
  for (const uri of candidateUris) {
    if (admittedUris.includes(uri)) {
      continue;
    }
    if (!isInvocationArtifactUri(uri, invocationId)) {
      throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime lease ${kind} uri is outside invocation artifacts`);
    }
  }
}

function isInvocationArtifactUri(uri: string, invocationId: string): boolean {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "kiln:" || parsed.hostname !== "artifacts") {
      return false;
    }
    const pathSegments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
    return pathSegments.length > 1 && pathSegments[0] === invocationId;
  } catch {
    return false;
  }
}
