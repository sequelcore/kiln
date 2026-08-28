import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../src/config.js";
import type { ResolvedInvocationEffect } from "@kilnai/core/engine";
import type { DefaultBuiltinToolRegistryOptions, ToolResourceReadResult } from "@kilnai/core/tools";

const coreMocks = vi.hoisted(() => {
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
    read: vi.fn(async (): Promise<ToolResourceReadResult> => ({
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
    surfaceOptions: undefined as DefaultBuiltinToolRegistryOptions | undefined,
    createDefaultBuiltinToolSurface: vi.fn((options: DefaultBuiltinToolRegistryOptions) => {
      coreMocks.surfaceOptions = options;
      return {
        bridge,
        toolNames,
        tools: [{ name: "read" }],
        resources,
        resourceNotifications: { marker: "notifications" },
      };
    }),
    projectToolResourceDescriptor: vi.fn((resource: { uri: string; title?: string; mimeType?: string }) => ({
      uri: resource.uri,
      title: resource.title,
      mimeType: resource.mimeType,
    })),
    initialize: vi.fn().mockResolvedValue(undefined),
    createServer: vi.fn(() => ({})),
  };
});

const runtimeMocks = vi.hoisted(() => ({
  createSqliteMemoryRepository: vi.fn((options: unknown) => ({ options })),
}));

vi.mock("@kilnai/runtime", () => runtimeMocks);

const configMocks = vi.hoisted(() => ({
  loadKilnConfig: vi.fn(),
}));

const mcpMocks = vi.hoisted(() => ({
  serveStdio: vi.fn(() => ({ close: vi.fn().mockResolvedValue(undefined) })),
}));

vi.mock("../src/config/config-merger.js", () => ({
  loadKilnConfig: configMocks.loadKilnConfig,
}));

vi.mock("@modelcontextprotocol/server/stdio", () => ({
  serveStdio: mcpMocks.serveStdio,
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    createDefaultBuiltinToolSurface: coreMocks.createDefaultBuiltinToolSurface,
    projectToolResourceDescriptor: coreMocks.projectToolResourceDescriptor,
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
    coreMocks.surfaceOptions = undefined;
    configMocks.loadKilnConfig.mockResolvedValue(null);
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
    expect(mcpMocks.serveStdio).toHaveBeenCalledTimes(1);
    expect(mcpMocks.serveStdio).toHaveBeenCalledWith(expect.any(Function), { legacy: "reject" });
    expect(stderrSpy).toHaveBeenCalledWith(
      "kiln dev tools MCP server running (stdio)",
    );
  });

  it("loads admitted project authority when the real CLI app config is empty", async () => {
    configMocks.loadKilnConfig.mockResolvedValue({
      version: "1",
      permissions: {
        approval: "never",
        sandbox: "read-only",
        safeDefaults: false,
        tools: [{ tool: "read", action: "deny" }],
      },
    });
    const cliConfig: KilnAppConfig = { createRegistry: APP_CONFIG.createRegistry };
    vi.spyOn(console, "error").mockImplementation(() => {});

    await toolsCommand(cliConfig, { mcp: true });

    expect(configMocks.loadKilnConfig).toHaveBeenCalledWith(process.cwd());
    const effect: ResolvedInvocationEffect = {
      operation: "observe",
      boundaries: ["workspace"],
      reversibility: "reversible",
      dataEgress: "none",
      identityUse: "none",
      consequences: ["local-state"],
      idempotency: "idempotent",
    };
    expect(coreMocks.surfaceOptions?.invocationAdmission?.authorize({
      toolName: "read",
      toolInput: {},
      resolvedEffect: effect,
    })).toMatchObject({ allowed: false, requiresApproval: false });
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

    await toolsCommand(APP_CONFIG, { resource: "kiln://tools/catalog", sessionId: "session-1" });

    expect(coreMocks.resources.read).toHaveBeenCalledWith("kiln://tools/catalog", {
      target: { sessionId: "session-1", resourceUri: "kiln://tools/catalog" },
    });
    expect(stdoutSpy).toHaveBeenCalledWith("{\"totalIndexed\":24}");
  });

  it("passes explicit target identity when reading a resource", async () => {
    const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await toolsCommand(APP_CONFIG, {
      resource: "kiln://session/work-items",
      gatewayTargetId: "app-gateway:support:tenant:acme",
      appId: "support",
      tenantId: "acme",
      sessionId: "session-1",
    });

    expect(coreMocks.resources.read).toHaveBeenCalledWith("kiln://session/work-items", {
      target: {
        gatewayTargetId: "app-gateway:support:tenant:acme",
        appId: "support",
        tenantId: "acme",
        sessionId: "session-1",
        resourceUri: "kiln://session/work-items",
      },
    });
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

    await toolsCommand(APP_CONFIG, { resource: "kiln://external-engagement/artifacts", sessionId: "session-1" });

    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify({
      uri: "kiln://external-engagement/artifacts",
      target: {
        sessionId: "session-1",
        resourceUri: "kiln://external-engagement/artifacts",
      },
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
      presentation: {
        uri: "kiln://external-engagement/artifacts",
        title: "external-engagement",
        total: { label: "total", value: 2 },
        counts: [
          { label: "artifact", value: 2 },
          { label: "candidate", value: 3 },
        ],
        facets: [
          { label: "artifactKinds", values: ["candidate-report", "evidence-report"] },
        ],
        meta: [],
        contentCount: 1,
        hasMore: false,
      },
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

    await toolsCommand(APP_CONFIG, { resource: "kiln://artifacts/capture", sessionId: "session-1" });

    expect(stdoutSpy).toHaveBeenCalledWith(JSON.stringify({
      uri: "kiln://artifacts/capture",
      target: {
        sessionId: "session-1",
        resourceUri: "kiln://artifacts/capture",
      },
      contents: [{
        kind: "blob",
        uri: "kiln://artifacts/capture",
        mimeType: "image/png",
        blob: "iVBORw0KGgo=",
      }],
      nextCursor: "byte:1024",
    }, null, 2));
  });

});
