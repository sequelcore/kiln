import type { ToolDefinition } from "../agents/index.js";
import type { Capability } from "../engine/domain/capability.js";
import { DevToolRegistry } from "./domain/tool-registry.js";
import type { DevTool } from "./domain/tool.js";
import { BashTool, type BashToolOptions } from "./infrastructure/bash-tool.js";
import { EditTool } from "./infrastructure/edit-tool.js";
import { GitTool, type GitToolOptions } from "./infrastructure/git-tool.js";
import { GlobTool, type GlobToolOptions } from "./infrastructure/glob-tool.js";
import { GrepTool, type GrepToolOptions } from "./infrastructure/grep-tool.js";
import { ReadTool } from "./infrastructure/read-tool.js";
import { WriteTool } from "./infrastructure/write-tool.js";

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

export function createDefaultBuiltinTools(
  options: DefaultBuiltinToolRegistryOptions = {},
): readonly DevTool[] {
  return [
    new BashTool(options.bash),
    new ReadTool(),
    new WriteTool(),
    new EditTool(),
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

export function projectDevToolSchemas(
  tools: readonly DevTool[],
): readonly DevToolSchemaProjection[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
}

export function projectDevToolDefinitions(
  tools: readonly DevTool[],
): readonly ToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
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
      schema: tool.inputSchema,
      tags: [],
      annotations: tool.annotations,
    });
  }
  return capabilityMap;
}
