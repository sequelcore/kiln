import {
  type ManagedAgentCallerAttachmentIdentity,
  type ManagedAgentInvocationCapabilityAdapterEvidence,
  type ManagedAgentInvocationCapabilityEvidence,
  supportsManagedAgentCrossHarnessProvider,
} from "@kilnai/core";

export interface ManagedInvocationCallerCapabilityInput {
  readonly callerIdentity: ManagedAgentCallerAttachmentIdentity;
  readonly providerId: string;
  readonly model?: string;
  readonly adapterEvidence: ManagedAgentInvocationCapabilityAdapterEvidence;
}

export function evaluateManagedInvocationCallerCapability(
  input: ManagedInvocationCallerCapabilityInput,
): ManagedAgentInvocationCapabilityEvidence {
  if (input.callerIdentity.kind === "kiln-runtime") {
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
