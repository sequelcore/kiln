import type {
  ManagedAgentCallerAttachmentIdentity,
  ManagedAgentInvocationCapabilityAdapterEvidence,
  ManagedAgentInvocationCapabilityEvidence,
} from "@kilnai/core";

const EXTERNAL_HARNESS_PROVIDER_SUPPORT = {
  claude: new Set(["codex-oauth", "opencode-go", "opencode-zen", "openrouter"]),
  codex: new Set(["opencode-go", "opencode-zen", "openrouter"]),
  opencode: new Set(["codex-oauth"]),
} as const;

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

  const supported = EXTERNAL_HARNESS_PROVIDER_SUPPORT[input.callerIdentity.harness].has(input.providerId);
  return {
    decision: supported ? "admitted" : "denied",
    reason: supported
      ? "cross-harness-managed-invocation"
      : `unsupported-external-caller-provider:${input.callerIdentity.harness}:${input.providerId}`,
    adapterEvidence: input.adapterEvidence,
  };
}
