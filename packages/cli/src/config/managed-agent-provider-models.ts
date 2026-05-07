import {
  discoverCodexCliModelDiscovery,
  discoverOpencodeCliModelDiscovery,
} from "@kilnai/runtime";

export type ManagedAgentProviderModels = Readonly<Record<string, readonly string[]>>;

export async function discoverManagedAgentProviderModels(): Promise<ManagedAgentProviderModels> {
  const [codex, opencode] = await Promise.all([
    discoverCodexCliModelDiscovery(),
    discoverOpencodeCliModelDiscovery(),
  ]);
  return {
    codex: codex.status === "available" ? codex.models : [],
    opencode: opencode.status === "available" ? opencode.models : [],
  };
}
