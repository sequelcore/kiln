import { describe, expect, it } from "vitest";
import type { DevTool, ToolInput, ToolResult } from "../../../src/tools/domain/tool.js";
import { TOOL_SCHEMAS } from "../../../src/tools/domain/tool.js";
import {
  commandToolMetadata,
  fileToolMetadata,
  isFileToolResultMetadata,
  searchToolMetadata,
  type CommandToolResultMetadata,
  type FileToolResultMetadata,
  type SearchToolResultMetadata,
} from "../../../src/tools/domain/tool-result-metadata.js";

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
      "patch",
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
    expect(TOOL_SCHEMAS.patch.inputSchema.required).toEqual(["patch"]);
    expect(TOOL_SCHEMAS.git.inputSchema.required).toEqual(["subcommand"]);
  });

  it("builds command metadata with a shared core contract", () => {
    const metadata: CommandToolResultMetadata<"bash"> = commandToolMetadata("bash", {
      cwd: "C:/workspace",
      command: "echo ok",
      timeoutMs: 30_000,
      timedOut: false,
      truncated: false,
    });

    expect(metadata).toMatchObject({
      toolName: "bash",
      kind: "command",
      cwd: "C:/workspace",
      command: "echo ok",
      timeoutMs: 30_000,
      timedOut: false,
      truncated: false,
    });
  });

  it("builds file metadata with normalized operation evidence", () => {
    const metadata: FileToolResultMetadata<"write"> = fileToolMetadata("write", {
      operation: "write",
      filePath: "C:/workspace/out.txt",
      bytesWritten: 7,
      linesAdded: 1,
    });

    expect(metadata).toEqual({
      toolName: "write",
      kind: "file",
      operation: "write",
      filePath: "C:/workspace/out.txt",
      bytesWritten: 7,
      linesAdded: 1,
    });
    expect(isFileToolResultMetadata(metadata)).toBe(true);
    expect(isFileToolResultMetadata({ kind: "file", operation: "read", filePath: "C:/workspace/out.txt" })).toBe(false);
    expect(isFileToolResultMetadata({ kind: "file", operation: "read" })).toBe(false);
    expect(isFileToolResultMetadata({
      toolName: "patch",
      kind: "file",
      operation: "patch",
      files: [{
        operation: "write",
        filePath: "C:/workspace/out.txt",
        changeType: "created",
      }],
    })).toBe(true);
  });

  it("builds search metadata with a shared strategy field", () => {
    const metadata: SearchToolResultMetadata<"grep"> = searchToolMetadata("grep", {
      path: "C:/workspace",
      strategy: "rg",
      outputMode: "content",
      noMatches: true,
    });

    expect(metadata).toEqual({
      toolName: "grep",
      kind: "search",
      path: "C:/workspace",
      strategy: "rg",
      outputMode: "content",
      noMatches: true,
    });
  });
});
