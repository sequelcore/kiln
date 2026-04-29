import type { ToolDefinition } from "../agents/index.js";
import type { Capability } from "../engine/domain/capability.js";
import { DevToolRegistry } from "./domain/tool-registry.js";
import type { DevTool, DevToolAnnotations } from "./domain/tool.js";
import { BashTool, type BashToolOptions } from "./infrastructure/bash-tool.js";
import { EditTool } from "./infrastructure/edit-tool.js";
import { GitTool, type GitToolOptions } from "./infrastructure/git-tool.js";
import { GlobTool, type GlobToolOptions } from "./infrastructure/glob-tool.js";
import { GrepTool, type GrepToolOptions } from "./infrastructure/grep-tool.js";
import { PatchTool } from "./infrastructure/patch-tool.js";
import { ReadTool } from "./infrastructure/read-tool.js";
import { StatTool } from "./infrastructure/stat-tool.js";
import { TreeTool } from "./infrastructure/tree-tool.js";
import { WriteTool } from "./infrastructure/write-tool.js";
import { DevToolExecutionBridge } from "./tool-executor.js";

export interface DevToolSchemaProjection {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

export interface DefaultBuiltinToolRegistryOptions {
  readonly bash?: BashToolOptions;
  readonly grep?: GrepToolOptions;
  readonly glob?: GlobToolOptions;
  readonly git?: GitToolOptions;
}

export interface DefaultBuiltinToolRegistryView {
  lookup(name: string): DevTool | undefined;
  list(): readonly DevTool[];
  has(name: string): boolean;
  readonly size: number;
}

export interface DefaultBuiltinToolSurface {
  readonly tools: readonly DevTool[];
  readonly toolNames: readonly string[];
  readonly registry: DefaultBuiltinToolRegistryView;
  readonly toolDefinitions: readonly ToolDefinition[];
  readonly capabilities: ReadonlyMap<string, Capability>;
  readonly bridge: DevToolExecutionBridge;
}

export function createDefaultBuiltinTools(
  options: DefaultBuiltinToolRegistryOptions = {},
): readonly DevTool[] {
  return [
    new BashTool(options.bash),
    new ReadTool(),
    new WriteTool(),
    new EditTool(),
    new PatchTool(),
    new StatTool(),
    new TreeTool(),
    new GrepTool(options.grep),
    new GlobTool(options.glob),
    new GitTool(options.git),
  ];
}

export function createDefaultBuiltinToolRegistry(
  options: DefaultBuiltinToolRegistryOptions = {},
): DevToolRegistry {
  const registry = new DevToolRegistry();
  for (const tool of createDefaultBuiltinTools(options)) {
    registry.register(tool);
  }
  return registry;
}

export function createDefaultBuiltinToolSurface(
  options: DefaultBuiltinToolRegistryOptions = {},
): DefaultBuiltinToolSurface {
  const registry = createDefaultBuiltinToolRegistry(options);
  const tools = registry.list();

  return {
    tools,
    toolNames: tools.map((tool) => tool.name),
    registry: createRegistryView(registry),
    toolDefinitions: projectDevToolDefinitions(tools),
    capabilities: projectDevToolCapabilities(tools),
    bridge: new DevToolExecutionBridge({ registry }),
  };
}

export function projectDevToolSchemas(
  tools: readonly DevTool[],
): readonly DevToolSchemaProjection[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: cloneRecord(tool.inputSchema),
  }));
}

export function projectDevToolDefinitions(
  tools: readonly DevTool[],
): readonly ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: cloneRecord(tool.inputSchema),
    tags: new Set<string>(),
  }));
}

export function projectDevToolCapabilities(
  tools: readonly DevTool[],
): ReadonlyMap<string, Capability> {
  const capabilityMap = new Map<string, Capability>();
  for (const tool of tools) {
    capabilityMap.set(tool.name, {
      name: tool.name,
      description: tool.description,
      schema: cloneRecord(tool.inputSchema),
      tags: [],
      annotations: cloneAnnotations(tool.annotations),
    });
  }
  return capabilityMap;
}

function createRegistryView(registry: DevToolRegistry): DefaultBuiltinToolRegistryView {
  return {
    lookup: (name: string) => registry.lookup(name),
    list: () => registry.list(),
    has: (name: string) => registry.has(name),
    get size() {
      return registry.size;
    },
  };
}

function cloneAnnotations(
  annotations: DevToolAnnotations | undefined,
): DevToolAnnotations | undefined {
  return annotations ? { ...annotations } : undefined;
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return cloneJsonValue(value) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item));
  }

  if (value && typeof value === "object") {
    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      clone[key] = cloneJsonValue(nestedValue);
    }
    return clone;
  }

  return value;
}
