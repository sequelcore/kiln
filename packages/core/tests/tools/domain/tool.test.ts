import { describe, expect, it } from "vitest";
import type { DevTool, ToolInput, ToolResult } from "../../../src/tools/domain/tool.js";
import { TOOL_SCHEMAS } from "../../../src/tools/domain/tool.js";

describe("tool domain types", () => {
  it("accepts a minimal developer tool", async () => {
    const tool: DevTool = {
      name: "read",
      description: "Read a file from disk",
      inputSchema: TOOL_SCHEMAS.read.inputSchema,
      annotations: { readOnly: true, idempotent: true },
      async execute(input: ToolInput): Promise<ToolResult> {
        return {
          output: JSON.stringify(input.input),
          isError: false,
        };
      },
    };

    const result = await tool.execute({
      name: "read",
      input: { filePath: "/tmp/demo.txt" },
    });

    expect(tool.name).toBe("read");
    expect(tool.annotations?.readOnly).toBe(true);
    expect(result).toEqual({
      output: JSON.stringify({ filePath: "/tmp/demo.txt" }),
      isError: false,
    });
  });

  it("defines schemas for all built-in native tools", () => {
    expect(Object.keys(TOOL_SCHEMAS)).toEqual([
      "bash",
      "read",
      "write",
      "edit",
      "grep",
      "glob",
      "git",
    ]);
  });

  it("marks read-only tools with safety annotations", () => {
    expect(TOOL_SCHEMAS.read.annotations).toEqual({
      readOnly: true,
      idempotent: true,
    });
    expect(TOOL_SCHEMAS.grep.annotations).toEqual({
      readOnly: true,
      idempotent: true,
    });
    expect(TOOL_SCHEMAS.glob.annotations).toEqual({
      readOnly: true,
      idempotent: true,
    });
  });

  it("uses JSON Schema object definitions for each tool", () => {
    for (const schema of Object.values(TOOL_SCHEMAS)) {
      expect(schema.inputSchema).toMatchObject({
        type: "object",
      });
      expect(schema.inputSchema.properties).toBeDefined();
      expect(Array.isArray(schema.inputSchema.required)).toBe(true);
    }
  });

  it("captures required fields for mutating tools", () => {
    expect(TOOL_SCHEMAS.write.inputSchema.required).toEqual(["filePath", "content"]);
    expect(TOOL_SCHEMAS.edit.inputSchema.required).toEqual([
      "filePath",
      "oldString",
      "newString",
    ]);
    expect(TOOL_SCHEMAS.git.inputSchema.required).toEqual(["subcommand"]);
  });
});
