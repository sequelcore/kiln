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
import {
  OPERATOR_THEME_NAMES,
  isOperatorThemeName,
  type OperatorThemeScope,
} from "@kilnai/gateway-contracts";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { authorityFromCapability } from "./tool-authority.js";

export interface AttachedRuntimeBuiltinToolSurface {
  readonly callBuiltinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
}

export interface OperatorThemeToolController {
  readonly setTheme: (input: {
    readonly theme: string;
    readonly scope: OperatorThemeScope;
    readonly reason?: string;
  }) => Promise<{ readonly ok: boolean; readonly appliedTheme?: string; readonly error?: string }>;
}

export interface AttachedRuntimeBuiltinToolSurfaceOptions {
  readonly operatorTheme?: OperatorThemeToolController;
}

const DEFAULT_CORE_BUILTIN_TOOL_SURFACE = createDefaultBuiltinToolSurface();
const DEFAULT_TOOL_CAPABILITIES = DEFAULT_CORE_BUILTIN_TOOL_SURFACE.capabilities;
const DEFAULT_BUILTIN_TOOL_SURFACE: AttachedRuntimeBuiltinToolSurface = {
  callBuiltinTools: buildBuiltinToolExecutors(DEFAULT_CORE_BUILTIN_TOOL_SURFACE),
  toolDefinitions: DEFAULT_CORE_BUILTIN_TOOL_SURFACE.toolDefinitions,
  capabilities: DEFAULT_TOOL_CAPABILITIES,
  toolAuthority: buildBuiltinToolAuthority(DEFAULT_TOOL_CAPABILITIES),
};

const OPERATOR_SET_THEME_TOOL: ToolDefinition = {
  name: "operator_set_theme",
  description: "Change the live operator surface theme when the connected GUI/TUI supports it. Use scope='session' unless the operator explicitly asks to persist the preference.",
  inputSchema: {
    type: "object",
    properties: {
      theme: {
        type: "string",
        enum: OPERATOR_THEME_NAMES,
        description: "Theme name to apply.",
      },
      scope: {
        type: "string",
        enum: ["session", "persisted"],
        description: "session applies only to the live surface; persisted also asks the surface to save the preference.",
        default: "session",
      },
      reason: {
        type: "string",
        description: "Short operator-facing reason for changing the theme.",
      },
    },
    required: ["theme"],
    additionalProperties: false,
  },
  tags: new Set<string>(["operator-ui"]),
};

const OPERATOR_SET_THEME_CAPABILITY: Capability = {
  name: OPERATOR_SET_THEME_TOOL.name,
  description: OPERATOR_SET_THEME_TOOL.description,
  schema: OPERATOR_SET_THEME_TOOL.inputSchema,
  tags: ["operator-ui"],
  annotations: { idempotent: true },
};

export function createAttachedRuntimeBuiltinToolSurface(
  options: AttachedRuntimeBuiltinToolSurfaceOptions = {},
): AttachedRuntimeBuiltinToolSurface {
  if (!options.operatorTheme) {
    return DEFAULT_BUILTIN_TOOL_SURFACE;
  }

  const callBuiltinTools = new Map(DEFAULT_BUILTIN_TOOL_SURFACE.callBuiltinTools);
  callBuiltinTools.set(OPERATOR_SET_THEME_TOOL.name, async (input) => executeOperatorSetTheme(input, options.operatorTheme!));

  const capabilities = new Map(DEFAULT_BUILTIN_TOOL_SURFACE.capabilities);
  capabilities.set(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);

  const toolAuthority = new Map(DEFAULT_BUILTIN_TOOL_SURFACE.toolAuthority);
  const authority = authorityFromCapability(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);
  if (authority) {
    toolAuthority.set(OPERATOR_SET_THEME_TOOL.name, authority);
  }

  return {
    callBuiltinTools,
    toolDefinitions: [...DEFAULT_BUILTIN_TOOL_SURFACE.toolDefinitions, OPERATOR_SET_THEME_TOOL],
    capabilities,
    toolAuthority,
  };
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

async function executeOperatorSetTheme(
  input: Record<string, unknown>,
  controller: OperatorThemeToolController,
): Promise<{ readonly output: string; readonly isError: boolean; readonly metadata: Record<string, unknown> }> {
  const theme = typeof input.theme === "string" ? input.theme.trim() : "";
  if (!isOperatorThemeName(theme)) {
    return {
      output: `Unknown operator theme '${theme || "<empty>"}'.`,
      isError: true,
      metadata: { reason: "invalid_theme" },
    };
  }
  const rawScope = typeof input.scope === "string" ? input.scope.trim() : "session";
  const scope: OperatorThemeScope = rawScope === "persisted" ? "persisted" : "session";
  const reason = typeof input.reason === "string" && input.reason.trim().length > 0
    ? input.reason.trim()
    : undefined;
  const result = await controller.setTheme({ theme, scope, ...(reason ? { reason } : {}) });
  if (!result.ok) {
    return {
      output: result.error ?? `Theme '${theme}' was not applied.`,
      isError: true,
      metadata: { theme, scope, applied: false, error: result.error },
    };
  }
  return {
    output: `Applied operator theme '${result.appliedTheme ?? theme}' (${scope}).`,
    isError: false,
    metadata: { theme, scope, appliedTheme: result.appliedTheme ?? theme },
  };
}
