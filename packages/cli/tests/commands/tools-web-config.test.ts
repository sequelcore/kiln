import { describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";

const toolsMocks = vi.hoisted(() => ({
  surfaceOptions: null as unknown,
  serverOptions: null as unknown,
  initialized: false,
  connected: false,
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    createDefaultBuiltinToolSurface: vi.fn((options: unknown) => {
      toolsMocks.surfaceOptions = options;
      return { bridge: {}, tools: [], resources: { marker: "resources" } };
    }),
    DevToolsMcpServer: class {
      constructor(options: unknown) {
        toolsMocks.serverOptions = options;
      }

      async initialize() {
        toolsMocks.initialized = true;
      }

      createServer() {
        return {
          async connect() {
            toolsMocks.connected = true;
          },
        };
      }
    },
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: class {},
}));

import { toolsCommand } from "../../src/commands/tools.js";

const APP_CONFIG: KilnAppConfig = {
  createRegistry: () => {
    throw new Error("createRegistry should not be used in tools command tests");
  },
  kilnYaml: {
    version: "1",
    web: {
      enabled: true,
      netPolicy: "documentation",
      allowedDomains: ["docs.example.com"],
    },
  },
};

describe("tools command web config", () => {
  it("creates the MCP tools surface from configured web options", async () => {
    await toolsCommand(APP_CONFIG, { mcp: true });

    expect(toolsMocks.surfaceOptions).toMatchObject({
      workspaceResources: { rootPath: process.cwd() },
      webFetch: expect.any(Object),
      webSearch: expect.any(Object),
      webExtract: expect.any(Object),
      memoryResources: {
        authority: {
          caller: { kind: "operator_surface", id: "tools-mcp" },
        },
      },
      memoryMutations: {
        callerContext: {
          actorType: "operator_surface",
          actorId: "tools-mcp",
        },
      },
    });
    expect(toolsMocks.serverOptions).toMatchObject({
      resources: { marker: "resources" },
    });
    expect(toolsMocks.initialized).toBe(true);
    expect(toolsMocks.connected).toBe(true);
  });
});
