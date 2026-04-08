import { describe, expect, it } from "vitest";
import { DevToolRegistry } from "../../../src/tools/domain/tool-registry.js";
import type { DevTool, ToolInput, ToolResult } from "../../../src/tools/domain/tool.js";

function makeTool(name: string, description = `${name} tool`): DevTool {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    async execute(_input: ToolInput): Promise<ToolResult> {
      return {
        output: name,
        isError: false,
      };
    },
  };
}

describe("DevToolRegistry", () => {
  it("registers and looks up a tool by name", () => {
    const registry = new DevToolRegistry();
    const tool = makeTool("grep");

    registry.register(tool);

    expect(registry.lookup("grep")).toBe(tool);
  });

  it("returns undefined for missing tools", () => {
    const registry = new DevToolRegistry();

    expect(registry.lookup("missing")).toBeUndefined();
  });

  it("lists tools in registration order", () => {
    const registry = new DevToolRegistry();
    const grep = makeTool("grep");
    const glob = makeTool("glob");

    registry.register(grep);
    registry.register(glob);

    expect(registry.list()).toEqual([grep, glob]);
  });

  it("returns a defensive list copy", () => {
    const registry = new DevToolRegistry();
    registry.register(makeTool("read"));

    const listed = registry.list() as DevTool[];
    listed.push(makeTool("write"));

    expect(registry.list()).toHaveLength(1);
    expect(registry.lookup("write")).toBeUndefined();
  });

  it("throws when registering a duplicate name", () => {
    const registry = new DevToolRegistry();
    const original = makeTool("git", "old");
    const replacement = makeTool("git", "new");

    registry.register(original);
    expect(() => registry.register(replacement)).toThrow("DevTool already registered: git");

    expect(registry.list()).toHaveLength(1);
    expect(registry.lookup("git")?.description).toBe("old");
  });
});
