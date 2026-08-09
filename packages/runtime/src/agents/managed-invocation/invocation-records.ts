import { defineManagedAgentInvocationRecord } from "@kilnai/core";
import type {
  ManagedAgentAdmissionDecision,
  ManagedAgentInvocationRecord,
  ManagedAgentInvocationRequest,
} from "@kilnai/core";

export function runtimeGeneratedHandoffProvenance(model: string | undefined) {
  return {
    delivery: "runtime-generated" as const,
    configuredModelId: model ?? "provider-default",
    observedModelIds: [],
  };
}

function baseTerminalRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  lifecycleState: "cancelled" | "failed" | "stale" | "recovered",
  reason: string,
): ManagedAgentInvocationRecord {
  return defineManagedAgentInvocationRecord({
    invocationId: request.invocationId,
    agentId: request.agentId,
    parentSessionId: request.parentSessionId,
    parentTurnId: request.parentTurnId,
    profile: request.profile,
    lifecycleState,
    providerRoute: request.providerRoute,
    adapterKind: request.adapterKind,
    executionMode: request.executionMode,
    authority: request.authority,
    capabilitySnapshot: decision.capabilitySnapshot,
    resultHandoff: {
      provenance: runtimeGeneratedHandoffProvenance(request.providerRoute.model),
      summary: reason,
      resourceUris: [],
      memoryWriteProposalUris: [],
    },
  });
}

export function createCancelledRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  reason: string,
): ManagedAgentInvocationRecord {
  return baseTerminalRecord(request, decision, "cancelled", reason);
}

export function createFailedRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  reason: string,
): ManagedAgentInvocationRecord {
  return baseTerminalRecord(request, decision, "failed", reason);
}

export function createStaleRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  reason: string,
): ManagedAgentInvocationRecord {
  return baseTerminalRecord(request, decision, "stale", reason);
}

export function createRecoveredRecord(
  request: ManagedAgentInvocationRequest,
  decision: Extract<ManagedAgentAdmissionDecision, { readonly status: "admitted" }>,
  reason: string,
): ManagedAgentInvocationRecord {
  return baseTerminalRecord(request, decision, "recovered", reason);
}

export function mergeCancelledRecords(
  runtimeRecord: ManagedAgentInvocationRecord,
  adapterRecord: ManagedAgentInvocationRecord,
): ManagedAgentInvocationRecord {
  const runtimeHandoff = runtimeRecord.resultHandoff;
  const adapterHandoff = adapterRecord.resultHandoff;
  return defineManagedAgentInvocationRecord({
    ...adapterRecord,
    lifecycleState: "cancelled",
    ...(runtimeRecord.resourceLease !== undefined
      ? { resourceLease: runtimeRecord.resourceLease }
      : adapterRecord.resourceLease !== undefined
        ? { resourceLease: adapterRecord.resourceLease }
        : {}),
    resultHandoff: {
      provenance: runtimeHandoff?.provenance
        ?? adapterHandoff?.provenance
        ?? runtimeGeneratedHandoffProvenance(adapterRecord.providerRoute.model),
      summary: runtimeHandoff?.summary ?? adapterHandoff?.summary ?? "Managed invocation cancelled.",
      ...(runtimeHandoff?.summaryAuthority !== undefined
        ? { summaryAuthority: runtimeHandoff.summaryAuthority }
        : adapterHandoff?.summaryAuthority !== undefined
          ? { summaryAuthority: adapterHandoff.summaryAuthority }
          : {}),
      resourceUris: adapterHandoff?.resourceUris ?? runtimeHandoff?.resourceUris ?? [],
      memoryWriteProposalUris: adapterHandoff?.memoryWriteProposalUris ?? runtimeHandoff?.memoryWriteProposalUris ?? [],
      ...(adapterHandoff?.ephemeralHarnessState !== undefined
        ? { ephemeralHarnessState: adapterHandoff.ephemeralHarnessState }
        : runtimeHandoff?.ephemeralHarnessState !== undefined
          ? { ephemeralHarnessState: runtimeHandoff.ephemeralHarnessState }
          : {}),
    },
  });
}
