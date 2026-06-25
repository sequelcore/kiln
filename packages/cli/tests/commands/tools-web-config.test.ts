import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    SqliteMemoryRepository: class MockSqliteMemoryRepository {
      constructor(readonly options: { readonly dbPath: string }) {}
    },
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
    const originalCwd = process.cwd();
    const tempDir = mkdtempSync(join(tmpdir(), "kiln-tools-memory-"));
    process.chdir(tempDir);

    try {
      await toolsCommand(APP_CONFIG, { mcp: true });

      expect(toolsMocks.surfaceOptions).toMatchObject({
        workspaceResources: { rootPath: tempDir },
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
      const repository = (toolsMocks.surfaceOptions as {
        readonly memoryResources?: { readonly repository?: { readonly options?: { readonly dbPath?: string } } };
      }).memoryResources?.repository;
      expect(repository?.options?.dbPath).toContain(join("Kiln", "memory", "projects"));
      expect(repository?.options?.dbPath).not.toBe(join(tempDir, ".kiln", "memory.db"));
      expect(existsSync(join(tempDir, ".kiln"))).toBe(false);
      expect(toolsMocks.initialized).toBe(true);
      expect(toolsMocks.connected).toBe(true);
    } finally {
      process.chdir(originalCwd);
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
