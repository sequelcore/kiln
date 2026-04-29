import type { ReasoningEffort } from "./index.js";
import type { ExecutionBillingMode } from "./execution-identity.js";
import { ModelCapabilityRegistry } from "./model-capability-registry.js";

export type DirectProviderId =
  | "codex-oauth"
  | "anthropic"
  | "openai"
  | "deepseek"
  | "openrouter"
  | "ollama"
  | "opencode-go"
  | "opencode-zen";

export type DirectProviderExecutionMode = "text-only" | "kiln-executable";

export interface DirectProviderExecutionProfile {
  readonly provider: DirectProviderId;
  readonly defaultExecutionMode: DirectProviderExecutionMode;
  readonly defaultBillingMode: ExecutionBillingMode;
  readonly supportsStructuredToolCalls: boolean;
}

export interface ResolvedDirectProviderExecutionProfile {
  readonly provider: DirectProviderId;
  readonly model: string;
  readonly defaultExecutionMode: DirectProviderExecutionMode;
  readonly executionMode: DirectProviderExecutionMode;
  readonly defaultBillingMode: ExecutionBillingMode;
  readonly supportsStructuredToolCalls: boolean;
  readonly modelSupportsTools: boolean;
  readonly supportsKilnExecutableTools: boolean;
}

export interface DiscoveredDirectProviderModelCapabilities {
  readonly supportsTools?: boolean;
  readonly defaultReasoningEffort?: ReasoningEffort;
  readonly supportedReasoningEfforts?: readonly ReasoningEffort[];
}

const DIRECT_PROVIDER_EXECUTION_PROFILES: ReadonlyMap<DirectProviderId, DirectProviderExecutionProfile> = new Map([
  ["codex-oauth", {
    provider: "codex-oauth",
    defaultExecutionMode: "kiln-executable",
    defaultBillingMode: "subscription",
    supportsStructuredToolCalls: true,
  }],
  ["opencode-go", {
    provider: "opencode-go",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "subscription",
    supportsStructuredToolCalls: true,
  }],
  ["opencode-zen", {
    provider: "opencode-zen",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "metered",
    supportsStructuredToolCalls: true,
  }],
  ["anthropic", {
    provider: "anthropic",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "metered",
    supportsStructuredToolCalls: true,
  }],
  ["openai", {
    provider: "openai",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "metered",
    supportsStructuredToolCalls: true,
  }],
  ["deepseek", {
    provider: "deepseek",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "metered",
    supportsStructuredToolCalls: true,
  }],
  ["openrouter", {
    provider: "openrouter",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "metered",
    supportsStructuredToolCalls: true,
  }],
  ["ollama", {
    provider: "ollama",
    defaultExecutionMode: "text-only",
    defaultBillingMode: "free",
    supportsStructuredToolCalls: true,
  }],
]);

const MODEL_CAPABILITIES = new ModelCapabilityRegistry();

function providerUsesDynamicToolCapableModels(provider: DirectProviderId): boolean {
  return provider === "codex-oauth" || provider === "opencode-go" || provider === "opencode-zen";
}

export function isDirectProviderId(provider: string | undefined): provider is DirectProviderId {
  if (!provider) return false;
  return DIRECT_PROVIDER_EXECUTION_PROFILES.has(provider as DirectProviderId);
}

export function listDirectProviderExecutionProfiles(): readonly DirectProviderExecutionProfile[] {
  return Array.from(DIRECT_PROVIDER_EXECUTION_PROFILES.values());
}

export function getDirectProviderExecutionProfile(
  provider: string | undefined,
): DirectProviderExecutionProfile | undefined {
  if (!isDirectProviderId(provider)) return undefined;
  return DIRECT_PROVIDER_EXECUTION_PROFILES.get(provider);
}

export function resolveDirectProviderExecutionProfile(options: {
  readonly provider: string | undefined;
  readonly model?: string;
  readonly requestedExecutionMode?: DirectProviderExecutionMode;
  readonly discoveredModelCapabilities?: DiscoveredDirectProviderModelCapabilities;
  readonly capabilityRegistry?: ModelCapabilityRegistry;
}): ResolvedDirectProviderExecutionProfile | undefined {
  const profile = getDirectProviderExecutionProfile(options.provider);
  if (!profile) return undefined;

  const selectedModel = options.model?.trim();
  if (!selectedModel || selectedModel.length === 0) {
    return undefined;
  }
  const model = selectedModel;
  const capabilities = options.capabilityRegistry ?? MODEL_CAPABILITIES;
  const modelSupportsTools = options.discoveredModelCapabilities?.supportsTools
    ?? (
      capabilities.supportsTools(profile.provider, model)
      || providerUsesDynamicToolCapableModels(profile.provider)
    );
  const supportsKilnExecutableTools = profile.supportsStructuredToolCalls && modelSupportsTools;
  const executionMode = resolveExecutionMode({
    requestedExecutionMode: options.requestedExecutionMode,
    supportsKilnExecutableTools,
  });

  return {
    provider: profile.provider,
    model,
    defaultExecutionMode: profile.defaultExecutionMode,
    executionMode,
    defaultBillingMode: profile.defaultBillingMode,
    supportsStructuredToolCalls: profile.supportsStructuredToolCalls,
    modelSupportsTools,
    supportsKilnExecutableTools,
  };
}

function resolveExecutionMode(options: {
  readonly requestedExecutionMode?: DirectProviderExecutionMode;
  readonly supportsKilnExecutableTools: boolean;
}): DirectProviderExecutionMode {
  if (options.requestedExecutionMode === "text-only") {
    return "text-only";
  }
  return options.supportsKilnExecutableTools ? "kiln-executable" : "text-only";
}
