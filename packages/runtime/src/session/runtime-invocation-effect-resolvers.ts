import {
  buildBuiltinInvocationEffectResolvers,
  type ActionEffectEnvelope,
  type InvocationEffectResolver,
  type InvocationEffectResolverRegistry,
} from "@kilnai/core";
import {
  MANAGED_AGENT_INVOKE_TOOL_NAME,
  MANAGED_AGENT_START_TOOL_NAME,
} from "../agents/managed-invocation/tool-names.js";

const MANAGED_READ_ONLY_INVOCATION_EFFECT: ActionEffectEnvelope = {
  operation: "mutate",
  boundaries: ["process", "workspace", "network"],
  reversibility: "compensatable",
  dataEgress: "project-data",
  identityUse: "authenticated",
  consequences: ["local-state", "external-state"],
  idempotency: "non-idempotent",
};

const managedInvocationResolver: InvocationEffectResolver = (_toolName, input, envelope) => {
  const profile = input.profile;
  const requestedAuthority = input.requestedAuthority;
  const isReadOnlyInvocation = profile === "foundation-readonly-plan"
    && (requestedAuthority === undefined || requestedAuthority === "auto" || requestedAuthority === "read_only");
  return isReadOnlyInvocation ? MANAGED_READ_ONLY_INVOCATION_EFFECT : envelope;
};

export function buildRuntimeInvocationEffectResolvers(): InvocationEffectResolverRegistry {
  return new Map<string, InvocationEffectResolver>([
    ...buildBuiltinInvocationEffectResolvers(),
    [MANAGED_AGENT_INVOKE_TOOL_NAME, managedInvocationResolver],
    [MANAGED_AGENT_START_TOOL_NAME, managedInvocationResolver],
  ]);
}
