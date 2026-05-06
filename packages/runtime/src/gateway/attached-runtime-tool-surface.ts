import type {
  AuthorityDescriptor,
  Capability,
  DefaultBuiltinToolSurface,
  DefaultBuiltinToolRegistryOptions,
  DiscoveredDirectProviderModelCapabilities,
  ToolDefinition,
  ToolResourceDisplayDescriptor,
  ToolResourceReadResult,
  ToolResourceTemplateDescriptor,
  ToolResultContentPart,
} from "@kilnai/core";
import {
  createDefaultBuiltinToolSurface,
  isDirectProviderId,
  projectToolResourceDescriptor,
  projectToolResultResourceLinks,
  resolveDirectProviderExecutionProfile,
} from "@kilnai/core";
import {
  OPERATOR_THEME_NAMES,
  isOperatorThemeName,
  type OperatorExecutionMode,
  type OperatorThemeScope,
} from "@kilnai/gateway-contracts";
import type {
  OperatorSurfaceController,
  OperatorSurfaceThemeController,
} from "../operator/operator-surface-controller.js";
import type { PerCallToolConfig, RuntimeBuiltinToolExecutor } from "../session/runtime-session-orchestrator.js";
import {
  createManagedInvocationToolExecutor,
  MANAGED_AGENT_INVOKE_CAPABILITY,
  MANAGED_AGENT_INVOKE_TOOL,
  type ManagedInvocationToolOptions,
} from "../agents/managed-invocation/runtime-tool.js";
import { authorityFromCapability } from "./tool-authority.js";

export interface AttachedRuntimeBuiltinToolSurface {
  readonly callBuiltinTools: ReadonlyMap<string, RuntimeBuiltinToolExecutor>;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly toolAuthority: ReadonlyMap<string, AuthorityDescriptor>;
  listResources(): readonly ToolResourceDisplayDescriptor[];
  listResourceTemplates(): readonly ToolResourceTemplateDescriptor[];
  readResource(uri: string): Promise<ToolResourceReadResult>;
}

export interface AttachedRuntimeBuiltinToolSurfaceOptions {
  readonly operatorSurface?: OperatorSurfaceController;
  readonly builtinToolOptions?: DefaultBuiltinToolRegistryOptions;
  readonly executionMode?: OperatorExecutionMode;
  readonly managedInvocation?: ManagedInvocationToolOptions;
}

const DEFAULT_CORE_BUILTIN_TOOL_SURFACE = createDefaultBuiltinToolSurface();
const DEFAULT_BUILTIN_TOOL_SURFACE: AttachedRuntimeBuiltinToolSurface = buildRuntimeSurface(
  DEFAULT_CORE_BUILTIN_TOOL_SURFACE,
);

const OPERATOR_SET_THEME_TOOL: ToolDefinition = {
  name: "operator_set_theme",
  description: "Change the operator surface theme when the connected CLI/GUI/TUI surface supports it. Use scope='session' for the live surface and scope='persisted' only when the operator explicitly asks to save the preference.",
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

const SUBMIT_PLAN_TOOL: ToolDefinition = {
  name: "submit_plan",
  description: "Submit the proposed plan for operator review. This tool is only available while the turn runs in plan mode and must not perform implementation work.",
  inputSchema: {
    type: "object",
    properties: {
      plan: {
        type: "string",
        description: "The complete operator-facing plan.",
      },
    },
    required: ["plan"],
    additionalProperties: false,
  },
  tags: new Set<string>(["operator-mode", "planning"]),
};

const SUBMIT_PLAN_CAPABILITY: Capability = {
  name: SUBMIT_PLAN_TOOL.name,
  description: SUBMIT_PLAN_TOOL.description,
  schema: SUBMIT_PLAN_TOOL.inputSchema,
  tags: ["operator-mode", "planning"],
  annotations: { readOnly: true, idempotent: true },
};

export function createAttachedRuntimeBuiltinToolSurface(
  options: AttachedRuntimeBuiltinToolSurfaceOptions = {},
): AttachedRuntimeBuiltinToolSurface {
  const themeController = options.operatorSurface?.theme;
  const baseSurface = options.builtinToolOptions
    ? buildRuntimeSurface(createDefaultBuiltinToolSurface(options.builtinToolOptions))
    : DEFAULT_BUILTIN_TOOL_SURFACE;

  if (!themeController && options.executionMode !== "plan" && !options.managedInvocation) {
    return baseSurface;
  }

  const callBuiltinTools = new Map(baseSurface.callBuiltinTools);
  const capabilities = new Map(baseSurface.capabilities);
  const toolAuthority = new Map(baseSurface.toolAuthority);
  const toolDefinitions = [...baseSurface.toolDefinitions];

  if (themeController) {
    callBuiltinTools.set(OPERATOR_SET_THEME_TOOL.name, async (input) => executeOperatorSetTheme(input, themeController));
    capabilities.set(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);
    const authority = authorityFromCapability(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);
    if (authority) {
      toolAuthority.set(OPERATOR_SET_THEME_TOOL.name, authority);
    }
    toolDefinitions.push(OPERATOR_SET_THEME_TOOL);
  }

  if (options.executionMode === "plan") {
    callBuiltinTools.set(SUBMIT_PLAN_TOOL.name, executeSubmitPlan);
    capabilities.set(SUBMIT_PLAN_TOOL.name, SUBMIT_PLAN_CAPABILITY);
    const authority = authorityFromCapability(SUBMIT_PLAN_TOOL.name, SUBMIT_PLAN_CAPABILITY);
    if (authority) {
      toolAuthority.set(SUBMIT_PLAN_TOOL.name, authority);
    }
    toolDefinitions.push(SUBMIT_PLAN_TOOL);
  }

  if (options.managedInvocation) {
    callBuiltinTools.set(MANAGED_AGENT_INVOKE_TOOL.name, createManagedInvocationToolExecutor(options.managedInvocation));
    capabilities.set(MANAGED_AGENT_INVOKE_TOOL.name, MANAGED_AGENT_INVOKE_CAPABILITY);
    const authority = authorityFromCapability(MANAGED_AGENT_INVOKE_TOOL.name, MANAGED_AGENT_INVOKE_CAPABILITY);
    if (authority) {
      toolAuthority.set(MANAGED_AGENT_INVOKE_TOOL.name, authority);
    }
    toolDefinitions.push(MANAGED_AGENT_INVOKE_TOOL);
  }

  return {
    callBuiltinTools,
    toolDefinitions,
    capabilities,
    toolAuthority,
    listResources: baseSurface.listResources,
    listResourceTemplates: baseSurface.listResourceTemplates,
    readResource: baseSurface.readResource,
  };
}

function buildRuntimeSurface(coreSurface: DefaultBuiltinToolSurface): AttachedRuntimeBuiltinToolSurface {
  return {
    callBuiltinTools: buildBuiltinToolExecutors(coreSurface),
    toolDefinitions: coreSurface.toolDefinitions,
    capabilities: coreSurface.capabilities,
    toolAuthority: buildBuiltinToolAuthority(coreSurface.capabilities),
    listResources: () => coreSurface.resources.list().map(projectToolResourceDescriptor),
    listResourceTemplates: () => coreSurface.resources.listTemplates(),
    readResource: (uri: string) => coreSurface.resources.read(uri),
  };
}

export function buildAttachedRuntimePerCallToolConfig(input: {
  readonly tenantId: string;
  readonly activeProvider?: string;
  readonly activeModel?: string;
  readonly activeModelCapabilities?: DiscoveredDirectProviderModelCapabilities;
  readonly reasoningEffort?: PerCallToolConfig["reasoningEffort"];
  readonly builtinToolSurface?: AttachedRuntimeBuiltinToolSurface;
  readonly executionMode?: OperatorExecutionMode;
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
  if (input.executionMode === "plan") {
    return buildPlanModePerCallConfig(config, builtinToolSurface);
  }
  return {
    ...config,
    toolAllowlist: new Set<string>(builtinToolSurface.toolDefinitions.map((tool) => tool.name)),
    toolAuthority: builtinToolSurface.toolAuthority,
    additionalTools: builtinToolSurface.toolDefinitions,
    perCallCapabilities: builtinToolSurface.capabilities,
  };
}

function buildPlanModePerCallConfig(
  config: PerCallToolConfig,
  builtinToolSurface: AttachedRuntimeBuiltinToolSurface,
): PerCallToolConfig {
  const toolDefinitions = [...builtinToolSurface.toolDefinitions];
  if (!toolDefinitions.some((tool) => tool.name === SUBMIT_PLAN_TOOL.name)) {
    toolDefinitions.push(SUBMIT_PLAN_TOOL);
  }
  const capabilities = new Map(builtinToolSurface.capabilities);
  capabilities.set(SUBMIT_PLAN_TOOL.name, SUBMIT_PLAN_CAPABILITY);
  const additionalTools = toolDefinitions.filter((tool) => {
    const capability = capabilities.get(tool.name);
    return capability?.annotations?.readOnly === true || tool.name === SUBMIT_PLAN_TOOL.name;
  });
  const toolAllowlist = new Set<string>(additionalTools.map((tool) => tool.name));
  const toolAuthority = new Map<string, AuthorityDescriptor>();
  for (const toolName of toolAllowlist) {
    const capability = capabilities.get(toolName);
    const authority = capability ? authorityFromCapability(toolName, capability) : undefined;
    if (authority) {
      toolAuthority.set(toolName, authority);
    }
  }
  return {
    ...config,
    toolAllowlist,
    toolAuthority,
    additionalTools,
    perCallCapabilities: capabilities,
  };
}

function buildBuiltinToolExecutors(
  surface: DefaultBuiltinToolSurface,
): ReadonlyMap<string, RuntimeBuiltinToolExecutor> {
  const executors = new Map<string, RuntimeBuiltinToolExecutor>();
  for (const toolName of surface.toolNames) {
    executors.set(toolName, async (input, context) => {
      const execution = await surface.bridge.execute({
        name: toolName,
        input,
        ...(context?.sandbox !== undefined ? { sandbox: context.sandbox } : {}),
      });
      const result = execution.result;
      const resourceLinks = projectToolResultResourceLinks(result);
      const resourceLinkContent = (result.content ?? []).filter(isResourceLinkContent);
      return {
        output: resourceLinks.length > 0 ? formatLinkedOutput(resourceLinks) : result.output,
        isError: result.isError,
        metadata: result.metadata,
        ...(resourceLinks.length > 0 ? { resourceLinks } : {}),
        ...(resourceLinkContent.length > 0 ? { content: resourceLinkContent } : {}),
      };
    });
  }
  return executors;
}

function formatLinkedOutput(
  resourceLinks: readonly { readonly uri: string; readonly title?: string }[],
): string {
  return [
    "Full tool output is available as resource links:",
    ...resourceLinks.map((link) => `- ${link.title ?? "tool output"}: ${link.uri}`),
  ].join("\n");
}

function isResourceLinkContent(
  content: ToolResultContentPart,
): content is Extract<ToolResultContentPart, { readonly type: "resource_link" }> {
  return content.type === "resource_link";
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
  controller: OperatorSurfaceThemeController,
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

async function executeSubmitPlan(
  input: Record<string, unknown>,
): Promise<{ readonly output: string; readonly isError: boolean; readonly metadata: Record<string, unknown> }> {
  const plan = typeof input.plan === "string" ? input.plan.trim() : "";
  if (!plan) {
    return {
      output: "Plan content is required.",
      isError: true,
      metadata: { toolName: SUBMIT_PLAN_TOOL.name, reason: "empty_plan" },
    };
  }
  return {
    output: "Plan submitted.",
    isError: false,
    metadata: {
      toolName: SUBMIT_PLAN_TOOL.name,
      operation: "submit_plan",
    },
  };
}
