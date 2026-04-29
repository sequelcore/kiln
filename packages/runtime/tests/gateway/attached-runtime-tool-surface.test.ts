import { describe, expect, it } from "vitest";
import { createDefaultBuiltinToolSurface } from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";

function projectToolDefinitions(
  tools: readonly { readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown> }[],
): readonly { readonly name: string; readonly description: string; readonly inputSchema: Record<string, unknown> }[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
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
});
