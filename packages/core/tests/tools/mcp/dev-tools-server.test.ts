import { describe, expect, it } from "vitest";
import { DevToolRegistry } from "../../../src/tools/domain/tool-registry.js";
import type { DevTool, ToolInput, ToolResult } from "../../../src/tools/domain/tool.js";
import { DevToolExecutionBridge } from "../../../src/tools/tool-executor.js";
import { DevToolsMcpServer } from "../../../src/tools/mcp/dev-tools-server.js";

function makeTool(
  name: string,
  executeFn: (input: ToolInput) => Promise<ToolResult>,
  annotations?: DevTool["annotations"],
): DevTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
    annotations,
    execute: executeFn,
  };
}

function createServer(registry?: DevToolRegistry): DevToolsMcpServer {
  const localRegistry = registry ?? new DevToolRegistry();
  const bridge = new DevToolExecutionBridge({ registry: localRegistry });
  return new DevToolsMcpServer({ bridge });
}

describe("DevToolsMcpServer", () => {
  it("lists the 7 native tool schemas", () => {
    const server = createServer();

    const tools = server.listTools();
    const names = tools.map((tool) => tool.name);

    expect(tools).toHaveLength(7);
    expect(names).toEqual([
      "bash",
      "read",
      "write",
      "edit",
      "grep",
      "glob",
      "git",
    ]);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("calls a registered tool through the bridge and returns JSON payload", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("echo", async (input) => ({
        output: JSON.stringify(input.input),
        isError: false,
      })),
    );
    const server = createServer(registry);

    const response = await server.callTool("echo", { message: "hello" });

    expect(response.isError).toBeUndefined();
    const payload = JSON.parse(response.content[0]!.text) as {
      result: ToolResult;
      attempts: number;
      fallbackUsed: boolean;
    };
    expect(payload.result).toEqual({
      output: JSON.stringify({ message: "hello" }),
      isError: false,
    });
    expect(payload.attempts).toBe(1);
    expect(payload.fallbackUsed).toBe(false);
  });

  it("returns an MCP error result for unknown tools", async () => {
    const server = createServer();

    const response = await server.callTool("missing", {});

    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain("INTERNAL_ERROR");
    expect(response.content[0]!.text).toContain("not registered");
  });

  it("surfaces tool execution failures as MCP error results", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("explode", async () => {
        throw new Error("boom from tool");
      }),
    );
    const server = createServer(registry);

    const response = await server.callTool("explode", {});

    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain("TOOL_RETRY_EXHAUSTED");
    expect(response.content[0]!.text).toContain("explode");
  });
});
