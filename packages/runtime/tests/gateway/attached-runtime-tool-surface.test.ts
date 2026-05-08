import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultBuiltinToolSurface } from "@kilnai/core";
import {
  buildAttachedRuntimePerCallToolConfig,
  createAttachedRuntimeBuiltinToolSurface,
} from "../../src/gateway/attached-runtime-tool-surface.js";

const ALWAYS_ON_RESOURCE_TOOLS = ["resource_list", "resource_template_list", "resource_read"];

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
    expect(runtimeSurface.listResources()).toEqual(coreSurface.resources.list().map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      mimeType: resource.mimeType,
    })));
    expect(runtimeSurface.listResourceTemplates().map((template) => template.uriTemplate)).toEqual(
      coreSurface.resources.listTemplates().map((template) => template.uriTemplate),
    );
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

  it("builds plan-mode per-call config from explicitly read-only tools and submit_plan", () => {
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();
    const config = buildAttachedRuntimePerCallToolConfig({
      tenantId: "tenant-1",
      activeProvider: "codex-oauth",
      activeModel: "gpt-5.4-mini",
      activeModelCapabilities: { supportsFunctionTools: true },
      builtinToolSurface: runtimeSurface,
      executionMode: "plan",
    });

    expect(config.toolAllowlist?.has("read")).toBe(true);
    expect(config.toolAllowlist?.has("tree")).toBe(true);
    expect(config.toolAllowlist?.has("submit_plan")).toBe(true);
    expect(config.toolAllowlist?.has("write")).toBe(false);
    expect(config.toolAllowlist?.has("edit")).toBe(false);
    expect(config.toolAllowlist?.has("patch")).toBe(false);
    expect(config.additionalTools?.map((tool) => tool.name)).toEqual(Array.from(config.toolAllowlist ?? []));
    expect(config.perCallCapabilities?.get("submit_plan")?.annotations?.readOnly).toBe(true);
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

    expect(Array.from(runtimeSurface.callBuiltinTools.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
    expect(Array.from(runtimeSurface.capabilities.keys())).toEqual(["read", "tool_catalog_search", ...ALWAYS_ON_RESOURCE_TOOLS]);
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
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "code_intelligence",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "read_many",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "task_list",
      "task_update",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
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
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
    expect(runtimeSurface.toolDefinitions.map((tool) => tool.name)).toEqual([
      "read",
      "operator_elicit",
      "tool_catalog_search",
      ...ALWAYS_ON_RESOURCE_TOOLS,
    ]);
  });

  it("routes interactive browser and computer tools through runtime-injected providers", async () => {
    const browserRequests: Record<string, unknown>[] = [];
    const computerRequests: Record<string, unknown>[] = [];
    const runtimeSurface = createAttachedRuntimeBuiltinToolSurface({
      builtinToolOptions: {
        browserUse: {
          provider: {
            async execute(request) {
              browserRequests.push(request);
              return {
                provider: "runtime-browser",
                sessionId: request.sessionId ?? "browser-1",
                output: "browser action routed",
                observation: {
                  url: request.url ?? "https://example.com",
                  title: "Example",
                  screenshotUri: "kiln://artifacts/interactive/browser-1/screenshot",
                },
              };
            },
          },
        },
        computerUse: {
          provider: {
            async execute(request) {
              computerRequests.push(request);
              return {
                provider: "runtime-computer",
                output: "computer action routed",
                observation: {
                  windowTitle: "Calculator",
                  screenshotUri: "kiln://artifacts/interactive/computer/screenshot",
                },
              };
            },
          },
        },
      },
    });

    await expect(runtimeSurface.callBuiltinTools.get("browser_navigate")?.({
      sessionId: "browser-1",
      url: "https://example.com",
    })).resolves.toMatchObject({
      output: "browser action routed",
      isError: false,
      metadata: {
        toolName: "browser_navigate",
        kind: "interactive",
        target: "browser",
        operation: "navigate",
        provider: "runtime-browser",
        sessionId: "browser-1",
      },
    });
    await expect(runtimeSurface.callBuiltinTools.get("computer_observe")?.({
      windowTitle: "Calculator",
    })).resolves.toMatchObject({
      output: "computer action routed",
      isError: false,
      metadata: {
        toolName: "computer_observe",
        kind: "interactive",
        target: "computer",
        operation: "observe",
        provider: "runtime-computer",
      },
    });

    expect(browserRequests).toHaveLength(1);
    expect(browserRequests[0]).toMatchObject({
      target: "browser",
      operation: "navigate",
      url: "https://example.com",
    });
    expect(computerRequests).toHaveLength(1);
    expect(computerRequests[0]).toMatchObject({
      target: "computer",
      operation: "observe",
      windowTitle: "Calculator",
    });
  });

  it("surfaces resource links from direct-provider builtin tool execution without injecting artifact content", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kiln-runtime-resource-links-"));
    try {
      await writeFile(join(tempDir, "large.txt"), "runtime link\n".repeat(1_000), "utf8");
      const runtimeSurface = createAttachedRuntimeBuiltinToolSurface();

      const result = await runtimeSurface.callBuiltinTools.get("read_many")?.({
        paths: [join(tempDir, "large.txt")],
        maxBytes: 20_000,
      }) as {
        output: string;
        resourceLinks?: readonly { uri: string; title?: string }[];
        content?: readonly { type: string; uri?: string }[];
      };

      expect(result.output).toContain("Full tool output is available as resource links");
      expect(result.output).toContain("kiln://artifacts/tool-results/");
      expect(result.resourceLinks).toEqual([expect.objectContaining({
        uri: expect.stringMatching(/^kiln:\/\/artifacts\/tool-results\/artifact_\d+\/content$/),
        title: "read_many full output",
      })]);
      expect(result.content).toEqual([expect.objectContaining({
        type: "resource_link",
        uri: result.resourceLinks?.[0]?.uri,
      })]);
      expect(JSON.stringify(result)).not.toContain("runtime link");
      expect(runtimeSurface.listResources()).toContainEqual(expect.objectContaining({
        uri: "kiln://artifacts/tool-results",
        title: "Artifacts: tool-results",
      }));
      await expect(runtimeSurface.readResource(result.resourceLinks![0]!.uri)).resolves.toMatchObject({
        contents: [{
          uri: result.resourceLinks![0]!.uri,
          mimeType: "text/plain",
          text: expect.stringContaining("runtime link"),
        }],
      });
      await expect(runtimeSurface.callBuiltinTools.get("resource_read")?.({
        uri: result.resourceLinks![0]!.uri,
      })).resolves.toMatchObject({
        output: expect.stringContaining("runtime link"),
        isError: false,
        metadata: expect.objectContaining({
          toolName: "resource_read",
          kind: "resource",
          operation: "read",
          uri: result.resourceLinks![0]!.uri,
        }),
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
