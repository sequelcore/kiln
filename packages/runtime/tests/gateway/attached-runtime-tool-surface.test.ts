import { describe, expect, it } from "vitest";
import { createDefaultBuiltinToolSurface } from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";

function projectToolDefinitions(
  tools: readonly {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: Record<string, unknown>;
    readonly outputSchema?: Record<string, unknown>;
  }[],
): readonly {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
}[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  }));
}

describe("attached runtime builtin tool surface", () => {
  it("projects default runtime tools from the canonical core builtin surface", () => {
    const coreSurface = createDefaultBuiltinToolSurface();
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(coreSurface.toolNames);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(coreSurface.toolNames);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(Array.from(coreSurface.capabilities.keys()));
    expect(projectToolDefinitions(runtimeSurface.toolDefinitions)).toEqual(projectToolDefinitions(coreSurface.toolDefinitions));
    expect(runtimeSurface.capabilities).toEqual(coreSurface.capabilities);
  });

  it("builds executable per-call config from the same runtime surface projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
    });

    const projectedToolNames = runtimeSurface.toolDefinitions.map((tool) => tool.name);
    expect(Array.from(config.toolAllowlist ?? [])).toEqual(projectedToolNames);
    expect(config.additionalTools?.map((tool) => tool.name)).toEqual(projectedToolNames);
    expect(config.perCallCapabilities).toBe(runtimeSurface.capabilities);
    expect(config.toolAuthority).toBe(runtimeSurface.toolAuthority);
  });

  it("propagates deferred core tool projection to runtime consumers", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(["read", "tool_catalog_search"]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(["read", "tool_catalog_search"]);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(["read", "tool_catalog_search"]);
  });

  it("can explicitly expose code intelligence in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "code_intelligence"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
    ]);
  });

  it("can explicitly expose read_many in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "read_many"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
    ]);
  });

  it("can explicitly expose monitor lifecycle tools in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "monitor_start", "monitor_read", "monitor_stop", "monitor_list"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
    ]);
  });

  it("can explicitly expose task state tools in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "task_list", "task_update"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
    ]);
  });

  it("can explicitly expose operator elicitation in deferred runtime projection", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        toolProjection: {
          mode: "deferred",
          alwaysOnTools: ["read", "operator_elicit"],
        },
      },
    });

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
    ]);
  });
});
