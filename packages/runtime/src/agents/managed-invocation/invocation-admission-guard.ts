import {
  defineManagedAgentAdapterWriteAuthorityDescriptor,
  defineManagedAgentCapabilitySnapshot,
  evaluateManagedAgentAdmission,
} from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentCapabilitySnapshot,
  ManagedAgentCapabilitySnapshotInput,
  ManagedAgentAdapterDescriptor,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
  ManagedAgentWorktreeConflictEvidence,
  ManagedAgentResourceLeaseEvidence,
} from "@kilnai/core";
import { ManagedAgentRuntimeAdmissionError } from "./errors.js";
import { samePath, pathsOverlap } from "./lease-path-support.js";
import { sameJson, uniqueStrings } from "./runtime-primitives.js";
import type { ManagedAgentRuntimeAdapter, ManagedAgentRuntimeInvocationEntry } from "./invocation-service.js";
import { isTerminalLifecycleState } from "./invocation-lifecycle-events.js";

export function requireRuntimeAdmission(input: {
  readonly request: ManagedAgentInvocationRequest;
  readonly adapter: ManagedAgentRuntimeAdapter;
  readonly admission: ManagedAgentAdmissionDecision;
}, now: () => Date): Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }> {
  if (input.admission.status !== "admitted") {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime invocation requires an admitted decision");
  }
  if (input.admission.adapterDescriptorId !== input.adapter.descriptor.adapterDescriptorId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent admission adapter descriptor does not match runtime adapter");
  }
  if (input.admission.invocationId !== input.request.invocationId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent admission invocation id does not match request");
  }
  if (input.admission.access !== input.request.access) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent access does not match request");
  }

  const runtimeDecision = evaluateManagedAgentAdmission(
    input.request,
    input.adapter.descriptor,
    snapshotInputFromAdmission(input.admission.capabilitySnapshot),
    { evaluatedAt: now().toISOString() },
  );
  if (runtimeDecision.status !== "admitted") {
    throw new ManagedAgentRuntimeAdmissionError(`Managed agent runtime admission no longer satisfies adapter policy: ${runtimeDecision.reason}`);
  }
  if (!sameJson(runtimeDecision, input.admission)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime admission must match the current core admission decision");
  }

  assertWriteAdmissionSupported(input.request, input.adapter.descriptor, input.admission);
  return input.admission;
}

export function assertWriteAdmissionSupported(
  request: ManagedAgentInvocationRequest,
  descriptor: ManagedAgentAdapterDescriptor,
  admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
): void {
  if (request.access === "read-only") {
    if (request.authority.writeAuthority !== undefined || admission.writeAuthority !== undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent read-only runtime invocation cannot carry write authority");
    }
    return;
  }

  if (request.authority.writeAuthority === undefined || admission.writeAuthority === undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent write runtime invocation requires admitted write authority");
  }
  if (!sameJson(request.authority.writeAuthority, admission.writeAuthority)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent admitted write authority does not match request authority");
  }

  const writeCapabilities = defineManagedAgentAdapterWriteAuthorityDescriptor(descriptor.writeAuthority);
  if (!writeCapabilities.proposalSupported || !writeCapabilities.scopeReduction) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce write proposal scope");
  }
  if (request.access === "approved-write") {
    if (!writeCapabilities.approvedApplySupported || !writeCapabilities.cleanupEvidence || !writeCapabilities.rollbackEvidence) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce approved-write authority");
    }
  }
  if (request.authority.memoryScope.access === "write-proposals" && !writeCapabilities.memoryProposalSupported) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent runtime adapter cannot enforce memory write proposals");
  }
}

export function detectActiveWriteLeaseConflict(
  invocations: ReadonlyMap<string, ManagedAgentRuntimeInvocationEntry>,
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
): Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }> | undefined {
  if (!isSameCheckoutWriteInvocation(request) && !isIsolatedWorktreeInvocation(request)) {
    return undefined;
  }

  for (const entry of invocations.values()) {
    if (isTerminalLifecycleState(entry.lifecycleState)) {
      continue;
    }
    if (isIsolatedWorktreeInvocation(request) && isIsolatedWorktreeInvocation(entry.request)) {
      if (samePath(entry.request.authority.workingDirectory.path, request.authority.workingDirectory.path)) {
        return deniedWriteLeaseConflictDecision({
          request,
          decision,
          active: entry,
          reason: "isolated-worktree-path-conflict",
        });
      }
      continue;
    }
    if (!isSameCheckoutWriteInvocation(request) || !isSameCheckoutWriteInvocation(entry.request)) {
      continue;
    }
    if (!samePath(entry.request.authority.workingDirectory.path, request.authority.workingDirectory.path)) {
      continue;
    }
    if (hasDisjointApprovedWorkspaceScope(entry.request, request)) {
      continue;
    }
    return deniedWriteLeaseConflictDecision({
      request,
      decision,
      active: entry,
      reason: "same-checkout-write-conflict",
    });
  }
  return undefined;
}

export function assertRecordWithinAdmission(
  record: ManagedAgentInvocationRecord,
  request: ManagedAgentInvocationRequest,
  admission: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
): void {
  if (record.invocationId !== request.invocationId || record.invocationId !== admission.invocationId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record invocation id does not match admitted request");
  }
  if (record.parentSessionId !== request.parentSessionId || record.parentTurnId !== request.parentTurnId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record parent lineage does not match request");
  }
  if (record.agentId !== request.agentId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record agent id does not match admitted request");
  }
  if (record.access !== request.access || record.access !== admission.access) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record profile does not match admitted request");
  }
  if (!sameJson(record.providerRoute, request.providerRoute)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record provider route does not match admitted request");
  }
  if (record.adapterKind !== request.adapterKind) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record adapter kind does not match admitted request");
  }
  if (record.executionMode !== request.executionMode) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record execution mode does not match admitted request");
  }
  if (record.authority.authorityProfileId !== admission.authorityProfileId) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent record authority profile does not match admission");
  }
  if (!sameJson(record.authority, request.authority)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned authority outside the admitted request");
  }
  if (!sameJson(record.capabilitySnapshot, admission.capabilitySnapshot)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned capability snapshot outside the admitted request");
  }

  if (admission.writeAuthority === undefined) {
    if (record.authority.writeAuthority !== undefined) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned write authority for a non-write admission");
    }
    const nonDeniedWriteEvidence = record.writeEvidence?.filter((evidence) => evidence.kind !== "write-authority-denied") ?? [];
    if (nonDeniedWriteEvidence.length > 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned write evidence for a non-write admission");
    }
    if ((record.resultHandoff?.memoryWriteProposalUris.length ?? 0) > 0) {
      throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter returned memory write proposals for a non-write admission");
    }
    return;
  }

  if (record.authority.writeAuthority === undefined) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter dropped admitted write authority from the record");
  }
  if (!sameJson(record.authority.writeAuthority, admission.writeAuthority)) {
    throw new ManagedAgentRuntimeAdmissionError("Managed agent adapter broadened or changed admitted write authority");
  }
}

function deniedWriteLeaseConflictDecision(input: {
  readonly request: ManagedAgentInvocationRequest;
  readonly decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>;
  readonly active: ManagedAgentRuntimeInvocationEntry;
  readonly reason: ManagedAgentWorktreeConflictEvidence["reason"];
}): Extract<ManagedAgentAdmissionDecision, { readonly status: "denied" }> {
  const activeInvocationId = input.active.request.invocationId;
  const lease = input.decision.capabilitySnapshot.resourceLease;
  const diagnosticUri = `kiln://artifacts/${input.request.invocationId}/worktree-conflict`;
  const conflict: ManagedAgentWorktreeConflictEvidence = {
    status: "blocked",
    reason: input.reason,
    requestedInvocationId: input.request.invocationId,
    conflictingInvocationId: activeInvocationId,
    workingDirectoryPath: input.request.authority.workingDirectory.path,
    workingDirectoryMode: input.request.authority.workingDirectory.mode,
    policyId: "managed-agent.worktree.single-active-writer",
    retryAfterInvocationIds: [activeInvocationId],
    resourceUris: [],
    diagnosticUris: [diagnosticUri],
  };
  const resourceLease: ManagedAgentResourceLeaseEvidence = defineManagedAgentCapabilitySnapshot({
    ...input.decision.capabilitySnapshot,
    resourceLease: {
      ...lease,
      healthStatus: "stale",
      cleanupStatus: "not-required",
      diagnosticUris: uniqueStrings([...lease.diagnosticUris, diagnosticUri]),
      worktreeConflict: conflict,
    },
  }).resourceLease;
  return {
    status: "denied",
    invocationId: input.request.invocationId,
    access: input.request.access,
    routeId: input.decision.capabilitySnapshot.routeId,
    routeSource: input.decision.capabilitySnapshot.routeSource,
    reason: `Managed agent ${input.reason}: ${activeInvocationId} already holds ${input.request.authority.workingDirectory.path}`,
    missingCapabilities: ["resourceLease.worktreeConflict"],
    resourceLease,
  };
}

function isSameCheckoutWriteInvocation(request: ManagedAgentInvocationRequest): boolean {
  return request.authority.toolAuthority.writeAllowed === true &&
    (request.authority.workingDirectory.mode === "workspace-write" ||
      request.authority.workingDirectory.mode === "sandbox");
}

function isIsolatedWorktreeInvocation(request: ManagedAgentInvocationRequest): boolean {
  return request.authority.toolAuthority.writeAllowed === true &&
    request.authority.workingDirectory.mode === "isolated-worktree";
}

function hasDisjointApprovedWorkspaceScope(
  active: ManagedAgentInvocationRequest,
  incoming: ManagedAgentInvocationRequest,
): boolean {
  const activeWorkspace = active.authority.writeAuthority?.scope.workspace;
  const incomingWorkspace = incoming.authority.writeAuthority?.scope.workspace;
  if (
    activeWorkspace?.mode !== "apply-approved" ||
    incomingWorkspace?.mode !== "apply-approved" ||
    activeWorkspace.allowedPaths.length === 0 ||
    incomingWorkspace.allowedPaths.length === 0
  ) {
    return false;
  }

  return activeWorkspace.allowedPaths.every((activePath) =>
    incomingWorkspace.allowedPaths.every((incomingPath) => !pathsOverlap(activePath, incomingPath))
  );
}

export function snapshotInputFromAdmission(snapshot: ManagedAgentCapabilitySnapshot): ManagedAgentCapabilitySnapshotInput {
  return {
    capturedAt: snapshot.capturedAt,
    routeId: snapshot.routeId,
    routeSource: snapshot.routeSource,
    ...(snapshot.callerIdentity ? { callerIdentity: snapshot.callerIdentity } : {}),
    ...(snapshot.externalRuntimeAttachment ? { externalRuntimeAttachment: snapshot.externalRuntimeAttachment } : {}),
    routeHealth: snapshot.routeHealth,
    providerModelProof: snapshot.providerModelProof,
    authorityEvidence: snapshot.authorityEvidence,
    resourcePlane: snapshot.resourcePlane,
    resourceLease: snapshot.resourceLease,
    childIdentity: snapshot.childIdentity,
  };
}
