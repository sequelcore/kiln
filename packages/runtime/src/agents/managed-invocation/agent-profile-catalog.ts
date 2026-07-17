import type {
  ManagedInvocationAgentCatalogEntry,
  ManagedInvocationToolOptions,
} from "./runtime-tool.js";

export function resolveManagedInvocationAgentProfile(
  options: ManagedInvocationToolOptions,
  profile: string | undefined,
): ManagedInvocationAgentCatalogEntry | undefined {
  if (!profile) return undefined;
  return (options.agentCatalog ?? []).find((agent) =>
    agent.name === profile
    || agent.displayName === profile
    || (agent.nicknameCandidates ?? []).includes(profile)
  );
}
