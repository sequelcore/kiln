import type {
  AuthorityDescriptor,
  Capability,
  DevTool,
  ToolDefinition,
} from "@kilnai/core";
import {
  createDefaultBuiltinTools,
  isDirectProviderId,
  projectDevToolCapabilities,
  projectDevToolDefinitions,
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

const DEFAULT_BUILTIN_TOOLS = createDefaultBuiltinTools();
const DEFAULT_TOOL_CAPABILITIES = projectDevToolCapabilities(DEFAULT_BUILTIN_TOOLS);
const DEFAULT_BUILTIN_TOOL_SURFACE: AttachedRuntimeBuiltinToolSurface = {
  callBuiltinTools: buildBuiltinToolExecutors(DEFAULT_BUILTIN_TOOLS),
  toolDefinitions: projectDevToolDefinitions(DEFAULT_BUILTIN_TOOLS),
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
  readonly builtinToolSurface?: AttachedRuntimeBuiltinToolSurface;
}): PerCallToolConfig {
  const config: PerCallToolConfig = input.activeProvider && input.activeModel
    ? {
        tenantId: input.tenantId,
        modelOverride: {
          provider: input.activeProvider,
          model: input.activeModel,
        },
      }
    : {
        tenantId: input.tenantId,
      };

  const provider = isDirectProviderId(input.activeProvider)
    ? input.activeProvider
    : undefined;
  const profile = resolveDirectProviderExecutionProfile({
    provider,
    model: input.activeModel,
  });

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
  tools: readonly DevTool[],
): ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>> {
  const executors = new Map<string, (input: Record<string, unknown>) => Promise<unknown>>();
  for (const tool of tools) {
    executors.set(tool.name, async (input: Record<string, unknown>) => {
      const result = await tool.execute({ name: tool.name, input });
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
