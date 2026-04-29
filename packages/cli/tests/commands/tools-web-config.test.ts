import { describe, expect, it, vi } from "vitest";
import type { KilnAppConfig } from "../../src/config.js";

const toolsMocks = vi.hoisted(() => ({
  surfaceOptions: null as unknown,
  initialized: false,
  connected: false,
}));

vi.mock("@kilnai/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@kilnai/core")>();
  return {
    ...actual,
    createDefaultBuiltinToolSurface: vi.fn((options: unknown) => {
      toolsMocks.surfaceOptions = options;
      return { bridge: {} };
    }),
    DevToolsMcpServer: class {
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
    const { toolsCommand } = await import("../../src/commands/tools.js");

    await toolsCommand(APP_CONFIG, { mcp: true });

    expect(toolsMocks.surfaceOptions).toMatchObject({
      webFetch: expect.any(Object),
      webSearch: expect.any(Object),
    });
    expect(toolsMocks.initialized).toBe(true);
    expect(toolsMocks.connected).toBe(true);
  });
});
