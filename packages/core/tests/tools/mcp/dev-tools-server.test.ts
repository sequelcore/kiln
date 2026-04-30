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
  it("lists the 24 native tool schemas", () => {
    const server = createServer();

    const tools = server.listTools();
    const names = tools.map((tool) => tool.name);

    expect(tools).toHaveLength(24);
    expect(names).toEqual([
      "bash",
      "read",
      "read_many",
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
      "code_intelligence",
      "monitor_start",
      "monitor_read",
      "monitor_stop",
      "monitor_list",
      "task_list",
      "task_update",
      "operator_elicit",
      "tool_catalog_search",
    ]);

    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.outputSchema).toMatchObject({
        type: "object",
        required: ["result", "attempts", "fallbackUsed"],
      });
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("projects MCP schemas from the canonical core surface", () => {
    const surface = createDefaultBuiltinToolSurface();
    const server = new DevToolsMcpServer({ bridge: surface.bridge, tools: surface.tools });

    expect(server.listTools()).toEqual(projectDevToolSchemas(surface.tools));
  });

  it("lists MCP resources and templates from the canonical core surface", () => {
    const surface = createDefaultBuiltinToolSurface();
    const server = new DevToolsMcpServer({
      bridge: surface.bridge,
      tools: surface.tools,
      resources: surface.resources,
    });

    expect(server.listResources().resources.map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
      "kiln://session/monitors",
    ]);
    expect(server.listResourceTemplates().resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
      "kiln://session/tasks/{id}",
      "kiln://session/monitors/{id}",
    ]);
  });

  it("paginates MCP resources with cursor results", () => {
    const surface = createDefaultBuiltinToolSurface();
    const server = new DevToolsMcpServer({
      bridge: surface.bridge,
      tools: surface.tools,
      resources: surface.resources,
      resourcePageSize: 2,
    });

    const firstPage = server.listResources();
    const secondPage = server.listResources({ cursor: firstPage.nextCursor });

    expect(firstPage.resources.map((resource) => resource.uri)).toEqual([
      "kiln://tools/catalog",
      "kiln://session/tasks",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.resources.map((resource) => resource.uri)).toEqual([
      "kiln://session/monitors",
    ]);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("paginates MCP resource templates with cursor results", () => {
    const surface = createDefaultBuiltinToolSurface();
    const server = new DevToolsMcpServer({
      bridge: surface.bridge,
      tools: surface.tools,
      resources: surface.resources,
      resourcePageSize: 1,
    });

    const firstPage = server.listResourceTemplates();
    const secondPage = server.listResourceTemplates({ cursor: firstPage.nextCursor });

    expect(firstPage.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "kiln://tools/catalog/{name}",
    ]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(secondPage.resourceTemplates.map((template) => template.uriTemplate)).toEqual([
      "kiln://session/tasks/{id}",
    ]);
    expect(secondPage.nextCursor).toEqual(expect.any(String));
  });

  it("projects configured workspace resources through MCP listing and reads", async () => {
    const tempDir = await makeTempDir();
    try {
      await writeFile(join(tempDir, "README.md"), "# Workspace\n", "utf8");
      const surface = createDefaultBuiltinToolSurface({
        workspaceResources: { rootPath: tempDir },
      });
      const server = new DevToolsMcpServer({
        bridge: surface.bridge,
        tools: surface.tools,
        resources: surface.resources,
      });

      expect(server.listResources().resources.map((resource) => resource.uri)).toContain("kiln://workspace/tree");
      expect(server.listResourceTemplates().resourceTemplates.map((template) => template.uriTemplate)).toContain(
        "kiln://workspace/file/{path}",
      );
      const result = await server.readResource("kiln://workspace/file/README.md");
      expect(result.contents[0]).toMatchObject({
        uri: "kiln://workspace/file/README.md",
        mimeType: "text/markdown",
        text: "# Workspace\n",
      });
    } finally {
      await removeTempDir(tempDir);
    }
  });

  it("forwards MCP resource list cursors from SDK request params", async () => {
    const surface = createDefaultBuiltinToolSurface();
    const server = new DevToolsMcpServer({
      bridge: surface.bridge,
      tools: surface.tools,
      resources: surface.resources,
      resourcePageSize: 2,
    });
    await server.initialize();
    const mcpServer = server.createServer();
    const handlers = (mcpServer as unknown as { _requestHandlers: Map<string, unknown> })._requestHandlers;
    const handler = handlers.get("resources/list") as (
      request: { method: "resources/list"; params: Record<string, unknown> },
    ) => Promise<{ resources: readonly unknown[]; nextCursor?: string }>;

    const firstPage = await handler({ method: "resources/list", params: {} });
    const secondPage = await handler({
      method: "resources/list",
      params: { cursor: firstPage.nextCursor },
    });

    expect(firstPage.resources).toHaveLength(2);
    expect(secondPage.resources).toHaveLength(1);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("reads MCP resources through the canonical resource registry", async () => {
    const surface = createDefaultBuiltinToolSurface();
    surface.taskStateStore.update({
      title: "Expose MCP resources",
      status: "completed",
    });
    const server = new DevToolsMcpServer({
      bridge: surface.bridge,
      tools: surface.tools,
      resources: surface.resources,
    });

    await expect(server.readResource("kiln://session/tasks")).resolves.toEqual({
      contents: [{
        uri: "kiln://session/tasks",
        mimeType: "application/json",
        text: expect.stringContaining("Expose MCP resources"),
      }],
    });
  });

  it("can list a deferred projection while executing against the canonical bridge", async () => {
    const surface = createDefaultBuiltinToolSurface({
      toolProjection: {
        mode: "deferred",
        alwaysOnTools: ["read"],
      },
    });
    const server = new DevToolsMcpServer({ bridge: surface.bridge, tools: surface.tools });

    expect(server.listTools().map((tool) => tool.name)).toEqual(["read", "tool_catalog_search"]);

    const result = await server.callTool("tool_catalog_search", { exact: "glob", verbosity: "structured" });
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      result: {
        isError: false,
        metadata: {
          toolName: "tool_catalog_search",
          kind: "catalog",
          resultCount: 1,
          totalIndexed: 24,
        },
      },
    });
  });

  it("exposes code intelligence as a read-only MCP tool", async () => {
    const server = createServer();

    const schema = server.listTools().find((tool) => tool.name === "code_intelligence");

    expect(schema).toMatchObject({
      name: "code_intelligence",
      inputSchema: {
        type: "object",
        required: ["operation"],
        properties: {
          operation: expect.objectContaining({
            enum: [
              "definition",
              "references",
              "hover",
              "document_symbols",
              "workspace_symbols",
              "diagnostics",
              "implementation",
              "call_hierarchy",
            ],
          }),
          path: expect.objectContaining({ type: "string" }),
          position: expect.objectContaining({ type: "object" }),
          query: expect.objectContaining({ type: "string" }),
          symbol: expect.objectContaining({ type: "string" }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
  });

  it("exposes read_many as a read-only MCP tool", async () => {
    const server = createServer();

    const schema = server.listTools().find((tool) => tool.name === "read_many");

    expect(schema).toMatchObject({
      name: "read_many",
      inputSchema: {
        type: "object",
        required: ["paths"],
        properties: {
          paths: expect.objectContaining({ type: "array" }),
          include: expect.objectContaining({ type: "array" }),
          exclude: expect.objectContaining({ type: "array" }),
          recursive: expect.objectContaining({ type: "boolean" }),
          respectGitIgnore: expect.objectContaining({ type: "boolean" }),
          useDefaultExcludes: expect.objectContaining({ type: "boolean" }),
          maxFiles: expect.objectContaining({ type: "number" }),
          maxBytes: expect.objectContaining({ type: "number" }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
  });

  it("exposes monitor lifecycle tools through MCP", async () => {
    const server = createServer();

    expect(server.listTools().find((tool) => tool.name === "monitor_start")).toMatchObject({
      name: "monitor_start",
      inputSchema: {
        type: "object",
        required: ["command"],
        properties: {
          command: expect.objectContaining({ type: "string" }),
          cwd: expect.objectContaining({ type: "string" }),
          name: expect.objectContaining({ type: "string" }),
          timeout: expect.objectContaining({
            type: "number",
            "x-kiln-timeout-unit": "milliseconds",
          }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
    expect(server.listTools().find((tool) => tool.name === "monitor_read")).toMatchObject({
      name: "monitor_read",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: expect.objectContaining({ type: "string" }),
          sinceSequence: expect.objectContaining({ type: "number" }),
          limit: expect.objectContaining({ type: "number" }),
        },
      },
    });
    expect(server.listTools().find((tool) => tool.name === "monitor_stop")).toMatchObject({
      name: "monitor_stop",
      inputSchema: {
        type: "object",
        required: ["id"],
        properties: {
          id: expect.objectContaining({ type: "string" }),
          reason: expect.objectContaining({ type: "string" }),
        },
      },
    });
    expect(server.listTools().find((tool) => tool.name === "monitor_list")).toMatchObject({
      name: "monitor_list",
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          status: expect.objectContaining({ enum: ["running", "exited", "stopped", "failed"] }),
        },
      },
    });
  });

  it("exposes shared task state tools through MCP", async () => {
    const server = createServer();

    expect(server.listTools().find((tool) => tool.name === "task_list")).toMatchObject({
      name: "task_list",
      inputSchema: {
        type: "object",
        required: [],
        properties: {
          status: expect.objectContaining({
            enum: ["pending", "in_progress", "blocked", "completed", "cancelled"],
          }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
    expect(server.listTools().find((tool) => tool.name === "task_update")).toMatchObject({
      name: "task_update",
      inputSchema: {
        type: "object",
        required: ["title", "status"],
        properties: {
          id: expect.objectContaining({ type: "string" }),
          title: expect.objectContaining({ type: "string" }),
          status: expect.objectContaining({
            enum: ["pending", "in_progress", "blocked", "completed", "cancelled"],
          }),
          details: expect.objectContaining({ type: "string" }),
          dependsOn: expect.objectContaining({ type: "array" }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
  });

  it("exposes operator elicitation through MCP", async () => {
    const server = createServer();

    expect(server.listTools().find((tool) => tool.name === "operator_elicit")).toMatchObject({
      name: "operator_elicit",
      inputSchema: {
        type: "object",
        required: ["mode", "message"],
        properties: {
          mode: expect.objectContaining({ enum: ["form", "url"] }),
          message: expect.objectContaining({ type: "string" }),
          schema: expect.objectContaining({ type: "object" }),
          url: expect.objectContaining({ type: "string" }),
          sensitive: expect.objectContaining({ type: "boolean" }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
  });

  it("maps operator_elicit to an MCP-provided elicitation responder when available", async () => {
    const server = createServer();

    const response = await server.callTool(
      "operator_elicit",
      {
        mode: "form",
        message: "Select environment",
        schema: { type: "object", properties: { environment: { enum: ["dev", "prod"] } } },
        verbosity: "structured",
      },
      {
        elicit: async (request) => ({
          outcome: "submitted",
          values: { environment: "dev" },
          surface: "mcp",
          request,
        }),
      },
    );

    expect(response.isError).toBeUndefined();
    expect(response.structuredContent).toMatchObject({
      result: {
        isError: false,
        metadata: {
          toolName: "operator_elicit",
          kind: "elicitation",
          outcome: "submitted",
          surface: "mcp",
          valueKeys: ["environment"],
        },
      },
    });
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

  it("exposes shared verbosity on high-volume MCP tools without changing grep outputMode", async () => {
    const server = createServer();

    for (const toolName of ["bash", "tree", "web_search", "web_fetch", "grep", "glob"]) {
      const schema = server.listTools().find((tool) => tool.name === toolName);
      expect(schema?.inputSchema).toMatchObject({
        properties: {
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      });
    }

    const grepSchema = server.listTools().find((tool) => tool.name === "grep");
    expect(grepSchema?.inputSchema).toMatchObject({
      properties: {
        outputMode: expect.objectContaining({ enum: ["content", "files_with_matches", "count"] }),
      },
    });
  });

  it("exposes controlled web tools as read-only MCP tools", async () => {
    const server = createServer();

    const webSearchSchema = server.listTools().find((tool) => tool.name === "web_search");
    const webFetchSchema = server.listTools().find((tool) => tool.name === "web_fetch");

    expect(webSearchSchema).toMatchObject({
      name: "web_search",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: expect.objectContaining({ type: "string" }),
          domains: expect.objectContaining({ type: "array" }),
          recencyDays: expect.objectContaining({ type: "number" }),
          maxResults: expect.objectContaining({ type: "number" }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
        },
      },
    });
    expect(webFetchSchema).toMatchObject({
      name: "web_fetch",
      inputSchema: {
        type: "object",
        required: ["url"],
        properties: {
          url: expect.objectContaining({ type: "string" }),
          maxBytes: expect.objectContaining({ type: "number" }),
          timeout: expect.objectContaining({ type: "number" }),
          verbosity: expect.objectContaining({ enum: ["raw", "structured", "summary"] }),
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
    expect(response.structuredContent).toEqual({
      result: {
        output: JSON.stringify({ message: "hello" }),
        isError: false,
      },
      attempts: 1,
      fallbackUsed: false,
    });
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

  it("returns structuredContent for tool-level error results that match the published output schema", async () => {
    const registry = new DevToolRegistry();
    registry.register(
      makeTool("invalid", async () => ({
        output: "invalid input",
        isError: true,
      })),
    );
    const server = createServer(registry);

    const response = await server.callTool("invalid", {});

    expect(response.isError).toBe(true);
    expect(response.structuredContent).toEqual({
      result: {
        output: "invalid input",
        isError: true,
      },
      attempts: 1,
      fallbackUsed: false,
    });
    expect(JSON.parse(response.content[0]!.text)).toEqual(response.structuredContent);
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
