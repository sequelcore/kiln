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
  type OperatorThemeScope,
} from "@kilnai/gateway-contracts";
import type {
  OperatorSurfaceController,
  OperatorSurfaceThemeController,
} from "../operator/operator-surface-controller.js";
import type { PerCallToolConfig } from "../session/runtime-session-orchestrator.js";
import { authorityFromCapability } from "./tool-authority.js";

export interface AttachedRuntimeBuiltinToolSurface {
  readonly callBuiltinTools: ReadonlyMap<string, (input: Record<string, unknown>) => Promise<unknown>>;
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

export function createAttachedRuntimeBuiltinToolSurface(
  options: AttachedRuntimeBuiltinToolSurfaceOptions = {},
): AttachedRuntimeBuiltinToolSurface {
  const themeController = options.operatorSurface?.theme;
  const baseSurface = options.builtinToolOptions
    ? buildRuntimeSurface(createDefaultBuiltinToolSurface(options.builtinToolOptions))
    : DEFAULT_BUILTIN_TOOL_SURFACE;

  if (!themeController) {
    return baseSurface;
  }

  const callBuiltinTools = new Map(baseSurface.callBuiltinTools);
  callBuiltinTools.set(OPERATOR_SET_THEME_TOOL.name, async (input) => executeOperatorSetTheme(input, themeController));

  const capabilities = new Map(baseSurface.capabilities);
  capabilities.set(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);

  const toolAuthority = new Map(baseSurface.toolAuthority);
  const authority = authorityFromCapability(OPERATOR_SET_THEME_TOOL.name, OPERATOR_SET_THEME_CAPABILITY);
  if (authority) {
    toolAuthority.set(OPERATOR_SET_THEME_TOOL.name, authority);
  }

  return {
    callBuiltinTools,
    toolDefinitions: [...baseSurface.toolDefinitions, OPERATOR_SET_THEME_TOOL],
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
