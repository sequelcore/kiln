import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../src/config.js";

const coreMocks = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const bridge = { source: "core-default-bridge" };
  const toolNames = [
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
    "web_extract",
    "browser_session_start",
    "browser_navigate",
    "browser_observe",
    "browser_click",
    "browser_type",
    "browser_keypress",
    "browser_scroll",
    "browser_session_stop",
    "computer_observe",
    "computer_click",
    "computer_type",
    "computer_keypress",
    "grep",
    "glob",
    "git",
  ];
  const resources = {
    list: vi.fn(() => [{
      uri: "kiln://tools/catalog",
      name: "tool_catalog",
      title: "Tool Catalog",
      mimeType: "application/json",
    }]),
    read: vi.fn(async () => ({
      contents: [{
        uri: "kiln://tools/catalog",
        mimeType: "application/json",
        text: "{\"totalIndexed\":24}",
      }],
    })),
  };
  return {
    bridge,
    toolNames,
    resources,
    resourceNotifications: { marker: "notifications" },
    tools: [{ name: "read" }],
    createDefaultBuiltinToolSurface: vi.fn(() => ({
      bridge,
      toolNames,
      tools: [{ name: "read" }],
      resources,
      resourceNotifications: { marker: "notifications" },
    })),
    projectToolResourceDescriptor: vi.fn((resource: { uri: string; title?: string; mimeType?: string }) => ({
      uri: resource.uri,
      title: resource.title,
      mimeType: resource.mimeType,
    })),
    initialize: vi.fn().mockResolvedValue(undefined),
    connect,
    createServer: vi.fn(() => ({ connect })),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class MockStdioServerTransport {},
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    createDefaultBuiltinToolSurface: coreMocks.createDefaultBuiltinToolSurface,
    projectToolResourceDescriptor: coreMocks.projectToolResourceDescriptor,
    SqliteMemoryRepository: class MockSqliteMemoryRepository {
      constructor(readonly options: unknown) {}
    },
    DevToolsMcpServer: class MockDevToolsMcpServer {
      constructor(options: unknown) {
        expect(options).toEqual({
          bridge: coreMocks.bridge,
          tools: coreMocks.tools,
          resources: coreMocks.resources,
          resourceNotifications: coreMocks.resourceNotifications,
        });
      }
      initialize = coreMocks.initialize;
      createServer = coreMocks.createServer;
    },
  };
});

import { createCli } from "../src/index.js";
import { toolsCommand } from "../src/commands/tools.js";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in tools command tests");
  },
  kilnYaml: {
    version: "1",
  },
};

describe("tools command", () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it("starts the dev tools MCP entrypoint with --mcp", async () => {
    const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, { mcp: true });

    expect(coreMocks.createDefaultBuiltinToolSurface).toHaveBeenCalledTimes(1);
    expect(coreMocks.createDefaultBuiltinToolSurface).toHaveReturnedWith({
      bridge: coreMocks.bridge,
      toolNames: coreMocks.toolNames,
      tools: coreMocks.tools,
      resources: coreMocks.resources,
      resourceNotifications: coreMocks.resourceNotifications,
    });
    expect(coreMocks.initialize).toHaveBeenCalledTimes(1);
    expect(coreMocks.createServer).toHaveBeenCalledTimes(1);
    expect(coreMocks.connect).toHaveBeenCalledTimes(1);
    expect(stderrSpy).toHaveBeenCalledWith(
      "kiln dev tools MCP server running (stdio)",
    );
  });

  it("lists resource descriptors for debugging and scripts", async () => {
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, { resources: true });

    expect(coreMocks.resources.list).toHaveBeenCalledTimes(1);
    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify([{
      uri: "kiln://tools/catalog",
      title: "Tool Catalog",
      mimeType: "application/json",
    }], null, 2));
  });

  it("reads a resource by URI for debugging and scripts", async () => {
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, { resource: "kiln://tools/catalog" });

    expect(coreMocks.resources.read).toHaveBeenCalledWith("kiln://tools/catalog");
    expect(stdoutSpy).toHaveBeenCalledWith("{\"totalIndexed\":24}");
  });

  it("prints summarized text resources with the shared operator resource contract", async () => {
    coreMocks.resources.read.mockResolvedValueOnce({
      summary: {
        kind: "external-engagement",
        totalCount: 2,
        counts: {
          artifact: 2,
          candidate: 3,
        },
        facets: {
          artifactKinds: ["candidate-report", "evidence-report"],
        },
      },
      contents: [{
        uri: "kiln://external-engagement/artifacts",
        mimeType: "application/json",
        text: "{\"artifactRoot\":\".kiln/external-engagement\"}",
      }],
    });
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, { resource: "kiln://external-engagement/artifacts" });

    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify({
      uri: "kiln://external-engagement/artifacts",
      summary: {
        kind: "external-engagement",
        totalCount: 2,
        counts: {
          artifact: 2,
          candidate: 3,
        },
        facets: {
          artifactKinds: ["candidate-report", "evidence-report"],
        },
      },
      contents: [{
        kind: "text",
        uri: "kiln://external-engagement/artifacts",
        mimeType: "application/json",
        text: "{\"artifactRoot\":\".kiln/external-engagement\"}",
      }],
    }, null, 2));
  });

  it("prints non-text resource reads with the shared operator resource contract", async () => {
    coreMocks.resources.read.mockResolvedValueOnce({
      contents: [{
        uri: "kiln://artifacts/capture",
        mimeType: "image/png",
        blob: "iVBORw0KGgo=",
      }],
      nextCursor: "byte:1024",
    });
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, { resource: "kiln://artifacts/capture" });

    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify({
      uri: "kiln://artifacts/capture",
      contents: [{
        kind: "blob",
        uri: "kiln://artifacts/capture",
        mimeType: "image/png",
        blob: "iVBORw0KGgo=",
      }],
      nextCursor: "byte:1024",
    }, null, 2));
  });

  it("shows the tools command in CLI help output", async () => {
    process.argv = ["bun", "kiln", "--help"];
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);

    await expect(createCli(APP_CONFIG)).rejects.toThrow("process.exit:0");

    const helpOutput = stdoutSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(helpOutput).toContain("import-native");
    expect(helpOutput).toContain("uninstall");
    expect(helpOutput).toContain("route");
    expect(helpOutput).toContain("tools");
    expect(helpOutput).not.toContain("  serve");
    expect(helpOutput).toContain(
      "Launch native dev tools MCP server over stdio and inspect shared resources (--mcp, --resources, --resource <uri>)",
    );
  });
});
