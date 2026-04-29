import { describe, expect, it } from "vitest";
import {
  createDefaultBuiltinToolRegistry,
  createDefaultBuiltinToolSurface,
} from "../../src/tools/default-tool-surface.js";
import {
  createDefaultBuiltinToolSurface as createDefaultBuiltinToolSurfaceFromBarrel,
  fileToolMetadata,
  projectDevToolSchemas,
} from "../../src/tools/index.js";

const BUILTIN_TOOL_NAMES = [
  "bash",
  "read",
  "write",
  "edit",
  "patch",
  "stat",
  "tree",
  "view_image",
  "ocr_image",
  "web_search",
  "web_fetch",
  "grep",
  "glob",
  "git",
];

describe("default builtin tool surface", () => {
  it("projects one canonical builtin tool set into registry, names, definitions, capabilities, and execution bridge", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.toolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.tools.map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.registry.list().map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.toolDefinitions.map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(Array.from(surface.capabilities.keys())).toEqual(BUILTIN_TOOL_NAMES);
    expect(surface.bridge.listTools().map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
  });

  it("exports the canonical surface through the public tools barrel", () => {
    const surface = createDefaultBuiltinToolSurfaceFromBarrel();

    expect(surface.toolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(projectDevToolSchemas(surface.tools).map((tool) => tool.name)).toEqual(BUILTIN_TOOL_NAMES);
    expect(fileToolMetadata("write", {
      operation: "write",
      filePath: "x.txt",
      bytesWritten: 1,
    })).toMatchObject({
      toolName: "write",
      kind: "file",
    });
  });

  it("keeps projections aligned with the existing default registry helper", () => {
    const registry = createDefaultBuiltinToolRegistry();
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.toolNames).toEqual(registry.list().map((tool) => tool.name));
    expect(surface.registry.list().map((tool) => tool.name)).toEqual(
      registry.list().map((tool) => tool.name),
    );
  });

  it("creates fresh mutable containers for each surface", () => {
    const first = createDefaultBuiltinToolSurface();
    const second = createDefaultBuiltinToolSurface();

    expect(first.tools).not.toBe(second.tools);
    expect(first.registry).not.toBe(second.registry);
    expect(first.toolDefinitions).not.toBe(second.toolDefinitions);
    expect(first.capabilities).not.toBe(second.capabilities);
    expect(first.bridge).not.toBe(second.bridge);
  });

  it("exposes a read-only registry view", () => {
    const surface = createDefaultBuiltinToolSurface();

    expect(surface.registry.has("read")).toBe(true);
    expect(surface.registry.size).toBe(BUILTIN_TOOL_NAMES.length);
    expect("register" in surface.registry).toBe(false);
  });

  it("projects schemas and annotations without sharing mutable nested references", () => {
    const first = createDefaultBuiltinToolSurface();
    const second = createDefaultBuiltinToolSurface();

    const firstReadDefinition = first.toolDefinitions.find((tool) => tool.name === "read");
    const secondReadDefinition = second.toolDefinitions.find((tool) => tool.name === "read");
    const firstReadCapability = first.capabilities.get("read");
    const secondReadCapability = second.capabilities.get("read");

    expect(firstReadDefinition?.inputSchema).not.toBe(secondReadDefinition?.inputSchema);
    expect(firstReadDefinition?.outputSchema).not.toBe(secondReadDefinition?.outputSchema);
    expect(firstReadCapability?.schema).not.toBe(secondReadCapability?.schema);
    expect(firstReadCapability?.outputSchema).not.toBe(secondReadCapability?.outputSchema);
    expect(firstReadCapability?.annotations).not.toBe(secondReadCapability?.annotations);

    const firstSchema = firstReadDefinition?.inputSchema as {
      properties: { filePath: { description: string } };
    };
    firstSchema.properties.filePath.description = "mutated";
    (firstReadDefinition?.outputSchema as {
      properties: { result: { properties: { output: { type: string } } } };
    }).properties.result.properties.output.type = "number";

    expect(
      (secondReadDefinition?.inputSchema as {
        properties: { filePath: { description: string } };
      }).properties.filePath.description,
    ).not.toBe("mutated");
    expect(
      (secondReadDefinition?.outputSchema as {
        properties: { result: { properties: { output: { type: string } } } };
      }).properties.result.properties.output.type,
    ).toBe("string");
  });

  it("projects a structured output schema for every builtin tool definition and capability", () => {
    const surface = createDefaultBuiltinToolSurface();

    for (const definition of surface.toolDefinitions) {
      expect(definition.outputSchema).toMatchObject({
        type: "object",
        required: ["result", "attempts", "fallbackUsed"],
        properties: {
          result: expect.objectContaining({
            type: "object",
            required: ["output", "isError"],
          }),
          attempts: expect.objectContaining({ type: "number" }),
          fallbackUsed: expect.objectContaining({ type: "boolean" }),
        },
      });
      expect(surface.capabilities.get(definition.name)?.outputSchema).toEqual(definition.outputSchema);
    }
  });

  it("executes through the canonical bridge", async () => {
    const surface = createDefaultBuiltinToolSurface();

    await expect(surface.bridge.execute({
      name: "read",
      input: { filePath: "__missing__.txt" },
    })).resolves.toMatchObject({
      attempts: 1,
      fallbackUsed: false,
      result: {
        isError: true,
        output: expect.stringContaining("__missing__.txt"),
      },
    });
  });
});
