import type {
  AuthorityDescriptor,
  Capability,
  DefaultBuiltinToolSurface,
  DiscoveredDirectProviderModelCapabilities,
  ToolDefinition,
} from "@kilnai/core";
import {
  createDefaultBuiltinToolSurface,
  isDirectProviderId,
  resolveDirectProviderExecutionProfile,
} from "@kilnai/core";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { authorityFromCapability } from "./tool-authority.js";

export interface AttachedRuntimeBuiltinToolSurface {
  readonly callBuiltinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
}

const DEFAULT_CORE_BUILTIN_TOOL_SURFACE = createDefaultBuiltinToolSurface();
const DEFAULT_TOOL_CAPABILITIES = DEFAULT_CORE_BUILTIN_TOOL_SURFACE.capabilities;
const DEFAULT_BUILTIN_TOOL_SURFACE: AttachedRuntimeBuiltinToolSurface = {
  callBuiltinTools: buildBuiltinToolExecutors(DEFAULT_CORE_BUILTIN_TOOL_SURFACE),
  toolDefinitions: DEFAULT_CORE_BUILTIN_TOOL_SURFACE.toolDefinitions,
  capabilities: DEFAULT_TOOL_CAPABILITIES,
  toolAuthority: buildBuiltinToolAuthority(DEFAULT_TOOL_CAPABILITIES),
};

export function createAttachedRuntimeBuiltinToolSurface(): AttachedRuntimeBuiltinToolSurface {
  return DEFAULT_BUILTIN_TOOL_SURFACE;
}

export function buildAttachedRuntimePerCallToolConfig(input: {
  readonly tenantId: string;
  readonly activeProvider?: string;
  readonly activeModel?: string;
  readonly activeModelCapabilities?: DiscoveredDirectProviderModelCapabilities;
  readonly reasoningEffort?: PerCallToolConfig["reasoningEffort"];
  readonly builtinToolSurface?: AttachedRuntimeBuiltinToolSurface;
}): PerCallToolConfig {
  const provider = isDirectProviderId(input.activeProvider)
    ? input.activeProvider
    : undefined;
  const profile = resolveDirectProviderExecutionProfile({
    provider,
    model: input.activeModel,
    discoveredModelCapabilities: input.activeModelCapabilities,
  });
  const modelOverride = provider && profile
    ? {
        provider,
        model: profile.model,
      }
    : undefined;
  const config: PerCallToolConfig = {
    tenantId: input.tenantId,
    ...(modelOverride ? { modelOverride } : {}),
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
  };

  if (profile?.executionMode !== "kiln-executable") {
    return {
      ...config,
      toolAllowlist: new Set<string>(),
      toolAuthority: new Map(),
    };
  }

  const builtinToolSurface = input.builtinToolSurface ?? DEFAULT_BUILTIN_TOOL_SURFACE;
  return {
    ...config,
    toolAllowlist: new Set<string>(builtinToolSurface.toolDefinitions.map((tool) => tool.name)),
    toolAuthority: builtinToolSurface.toolAuthority,
    additionalTools: builtinToolSurface.toolDefinitions,
    perCallCapabilities: builtinToolSurface.capabilities,
  };
}

function buildBuiltinToolExecutors(
  surface: DefaultBuiltinToolSurface,
): ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>> {
  const executors = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  for (const toolName of surface.toolNames) {
    executors.set(toolName, async (input: Record<string, unknown>) => {
      const execution = await surface.bridge.execute({ name: toolName, input });
      const result = execution.result;
      return { output: result.output, isError: result.isError, metadata: result.metadata };
    });
  }
  return executors;
}

function buildBuiltinToolAuthority(
  capabilities: ReadonlyMap<string, Capability>,
): ReadonlyMap<string, AuthorityDescriptor> {
  const toolAuthority = new Map<string, AuthorityDescriptor>();
  for (const [toolName, capability] of capabilities.entries()) {
    const descriptor = authorityFromCapability(toolName, capability);
    if (descriptor) {
      toolAuthority.set(toolName, descriptor);
    }
  }
  return toolAuthority;
}
