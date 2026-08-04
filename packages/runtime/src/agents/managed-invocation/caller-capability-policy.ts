import {
  type ManagedAgentCallerAttachmentIdentity,
  type ManagedAgentInvocationCapabilityAdapterEvidence,
  type ManagedAgentInvocationCapabilityEvidence,
  type ManagedAgentRequestedAuthority,
  supportsManagedAgentCrossHarnessProvider,
} from "@kilnai/core";

export interface ManagedInvocationCallerCapabilityInput {
  readonly callerIdentity: ManagedAgentCallerAttachmentIdentity;
  readonly providerId: string;
  readonly model?: string;
  readonly childRequestedAuthority?: ManagedAgentRequestedAuthority;
  readonly adapterEvidence: ManagedAgentInvocationCapabilityAdapterEvidence;
}

const AUTHORITY_RANK: Record<ManagedAgentRequestedAuthority, number> = {
  read_only: 1,
  audited: 2,
  auto: 3,
  destructive: 4,
};

export function evaluateManagedInvocationCallerCapability(
  input: ManagedInvocationCallerCapabilityInput,
): ManagedAgentInvocationCapabilityEvidence {
  if (input.callerIdentity.kind === "kiln-runtime") {
    const parentAuthority = input.callerIdentity.parentEffectiveRequestedAuthority;
    if (
      parentAuthority !== undefined
      && parentAuthority !== "auto"
      && input.childRequestedAuthority !== undefined
    ) {
      const parentRank = AUTHORITY_RANK[parentAuthority];
      const childRank = AUTHORITY_RANK[input.childRequestedAuthority];
      if (childRank > parentRank) {
        return {
          decision: "denied",
          reason: "authority-narrowing-required",
          adapterEvidence: input.adapterEvidence,
        };
      }
    }
    return {
      decision: "admitted",
      reason: "kiln-runtime-caller",
      adapterEvidence: input.adapterEvidence,
    };
  }

  const supported = supportsManagedAgentCrossHarnessProvider(input.callerIdentity.harness, input.providerId);
  return {
    decision: supported ? "admitted" : "denied",
    reason: supported
      ? "cross-harness-managed-invocation"
      : `unsupported-external-caller-provider:${input.callerIdentity.harness}:${input.providerId}`,
    adapterEvidence: input.adapterEvidence,
  };
}
