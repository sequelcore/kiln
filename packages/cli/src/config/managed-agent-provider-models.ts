import {
  discoverCodexCliModelDiscovery,
  discoverGuiDirectProviderModelDiscovery,
  discoverOpencodeCliModelDiscovery,
} from "@kilnai/runtime";

export type ManagedAgentProviderModels = Readonly<Record<string, readonly string[]>>;

export const PENDING_MANAGED_AGENT_PROVIDER_MODELS: ManagedAgentProviderModels = {};

const MANAGED_DIRECT_PROVIDER_DISCOVERY_AVAILABILITY: Readonly<Record<string, boolean>> = {
  anthropic: true,
  "codex-oauth": true,
  deepseek: true,
  lmstudio: true,
  ollama: true,
  openai: true,
  "opencode-go": true,
  "opencode-zen": true,
  openrouter: true,
};

export async function discoverManagedAgentProviderModels(): Promise<ManagedAgentProviderModels> {
  const [codex, opencode, directProviders] = await Promise.all([
    discoverCodexCliModelDiscovery(),
    discoverOpencodeCliModelDiscovery(),
    discoverGuiDirectProviderModelDiscovery(MANAGED_DIRECT_PROVIDER_DISCOVERY_AVAILABILITY),
  ]);
  return {
    codex: codex.status === "available" ? codex.models : [],
    opencode: opencode.status === "available" ? opencode.models : [],
    ...Object.fromEntries(Object.entries(directProviders).map(([provider, discovery]) => [
      provider,
      discovery.status === "available" ? discovery.models : [],
    ])),
  };
}
