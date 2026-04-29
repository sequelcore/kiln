import { describe, expect, it, vi } from "vitest";
import {
  createDefaultBuiltinToolRegistry,
  createDefaultBuiltinToolSurface,
  projectDevToolSchemas,
} from "../../../src/tools/default-tool-surface.js";
import { DevToolRegistry } from "../../../src/tools/domain/tool-registry.js";
import type { DevTool, ToolInput, ToolResult } from "../../../src/tools/domain/tool.js";
import { DevToolExecutionBridge } from "../../../src/tools/tool-executor.js";
import { DevToolsMcpServer } from "../../../src/tools/mcp/dev-tools-server.js";
import { makeTempDir, removeTempDir } from "../infrastructure/test-utils.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

function makeTool(
  name: string,
  executeFn: (input: ToolInput) => Promise<ToolResult>,
  annotations?: DevTool["annotations"],
  inputSchema: DevTool["inputSchema"] = {
    type: "object",
    properties: {},
    required: [],
  },
): DevTool {
  return {
    name,
    description: `${name} tool`,
    inputSchema,
    annotations,
    execute: executeFn,
  };
}

function createServer(registry?: DevToolRegistry): DevToolsMcpServer {
  const localRegistry = registry ?? createDefaultBuiltinToolRegistry();
  const bridge = new DevToolExecutionBridge({ registry: localRegistry });
  return new DevToolsMcpServer({ bridge });
}

describe("DevToolsMcpServer", () => {
  it("lists the 12 native tool schemas", () => {
    const server = createServer();

    const tools = server.listTools();
    const names = tools.map((tool) => tool.name);

    expect(tools).toHaveLength(12);
    expect(names).toEqual([
      "bash",
      "read",
      "write",
      "edit",
      "patch",
      "stat",
      "tree",
      "view_image",
      "ocr_image",
      "grep",
      "glob",
      "git",
    ]);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("projects MCP schemas from the canonical core surface", () => {
    const surface = createDefaultBuiltinToolSurface();
    const server = new DevToolsMcpServer({ bridge: surface.bridge });

    expect(server.listTools()).toEqual(projectDevToolSchemas(surface.tools));
  });

  it("exposes patch as a destructive MCP tool with dry-run support", async () => {
    const server = createServer();

    const patchSchema = server.listTools().find((tool) => tool.name === "patch");

    expect(patchSchema).toMatchObject({
      name: "patch",
      inputSchema: {
        type: "object",
        required: ["patch"],
        properties: {
          patch: expect.objectContaining({ type: "string" }),
          dryRun: expect.objectContaining({ type: "boolean" }),
        },
      },
    });
  });

  it("exposes stat and tree as read-only MCP tools", async () => {
    const server = createServer();

    const statSchema = server.listTools().find((tool) => tool.name === "stat");
    const treeSchema = server.listTools().find((tool) => tool.name === "tree");

    expect(statSchema).toMatchObject({
      name: "stat",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: expect.objectContaining({ type: "string" }),
          hash: expect.objectContaining({ enum: ["none", "sha256"] }),
        },
      },
    });
    expect(treeSchema).toMatchObject({
      name: "tree",
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          path: expect.objectContaining({ type: "string" }),
          depth: expect.objectContaining({ type: "number" }),
          includeFiles: expect.objectContaining({ type: "boolean" }),
        },
      },
    });
  });

  it("exposes image tools as read-only MCP tools", async () => {
    const server = createServer();

    const viewImageSchema = server.listTools().find((tool) => tool.name === "view_image");
    const ocrImageSchema = server.listTools().find((tool) => tool.name === "ocr_image");

    expect(viewImageSchema).toMatchObject({
      name: "view_image",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: expect.objectContaining({ type: "string" }),
          detail: expect.objectContaining({ enum: ["default", "original"] }),
        },
      },
    });
    expect(ocrImageSchema).toMatchObject({
      name: "ocr_image",
      inputSchema: {
        type: "object",
        required: ["path"],
        properties: {
          path: expect.objectContaining({ type: "string" }),
          language: expect.objectContaining({ type: "string" }),
        },
      },
    });
  });

  it("returns MCP image content for view_image", async () => {
    const tempDir = await makeTempDir();
    try {
      const imagePath = join(tempDir, "evidence.png");
      await writeFile(imagePath, PNG_BYTES);
      const server = createServer();

      const response = await server.callTool("view_image", { path: imagePath });

      expect(response.isError).toBeUndefined();
      expect(response.content).toContainEqual({
        type: "image",
        data: PNG_BASE64,
        mimeType: "image/png",
      });
      const payload = JSON.parse(response.content[0]!.text) as {
        result: ToolResult;
      };
      expect(payload.result).toMatchObject({
        isError: false,
        metadata: {
          toolName: "view_image",
          kind: "media",
          mimeType: "image/png",
        },
      });
      expect("content" in payload.result).toBe(false);
    } finally {
      await removeTempDir(tempDir);
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

  it("does not impose the default 30s bridge timeout when MCP bash input requests longer", async () => {
    vi.useFakeTimers();
    try {
      const registry = createDefaultBuiltinToolRegistry({
        bash: {
          commandRunner: async () => {
            await new Promise((resolve) => setTimeout(resolve, 31_000));
            return {
              stdout: "late success",
              stderr: "",
            };
          },
        },
      });
      const server = createServer(registry);

      const responsePromise = server.callTool("bash", { command: "sleep 31", timeout: 60_000 });
      await vi.advanceTimersByTimeAsync(31_000);

      const response = await responsePromise;
      expect(response.isError).toBeUndefined();
      const payload = JSON.parse(response.content[0]!.text) as {
        result: ToolResult;
        attempts: number;
        fallbackUsed: boolean;
      };
      expect(payload.result.output).toBe("late success");
      expect(payload.result.isError).toBe(false);
      expect(payload.result.metadata?.["timeoutMs"]).toBe(60_000);
      expect(payload.attempts).toBe(1);
      expect(payload.fallbackUsed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits MCP progress notifications while a tool call is still running", async () => {
    vi.useFakeTimers();
    try {
      let resolveTool: ((result: ToolResult) => void) | undefined;
      const registry = new DevToolRegistry();
      registry.register(
        makeTool(
          "slow",
          async () =>
            await new Promise<ToolResult>((resolve) => {
              resolveTool = resolve;
            }),
          undefined,
          {
            type: "object",
            properties: {
              timeout: {
                type: "number",
                "x-kiln-timeout-unit": "milliseconds",
              },
            },
          },
        ),
      );
      const server = createServer(registry);
      const sendNotification = vi.fn(async () => undefined);

      const responsePromise = server.callTool(
        "slow",
        { timeout: 60_000 },
        {
          _meta: { progressToken: "progress-1" },
          sendNotification,
        },
      );
      await vi.advanceTimersByTimeAsync(30_000);

      expect(sendNotification).toHaveBeenCalledWith({
        method: "notifications/progress",
        params: {
          progressToken: "progress-1",
          progress: 1,
          message: 'Tool "slow" is still running',
        },
      });

      resolveTool?.({ output: "done", isError: false });
      const response = await responsePromise;

      expect(response.isError).toBeUndefined();
      expect(sendNotification).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
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
