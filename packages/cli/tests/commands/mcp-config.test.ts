import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConfigCommand } from "../../src/commands/mcp-config.js";
import type { KilnAppConfig } from "../../src/config.js";

const mocks = vi.hoisted(() => ({
  load: vi.fn(() => ({ servers: {}, diagnostics: [] })),
  sync: vi.fn(async (_resolution: unknown, root: string, options: { harnesses: readonly string[] }) => ({
    targets: options.harnesses.map((harness) => ({ harness, path: root, status: "current" })),
  })),
  uninstall: vi.fn(async (root: string, options: { harnesses: readonly string[] }) => ({
    targets: options.harnesses.map((harness) => ({ harness, path: root, status: "uninstalled" })),
  })),
  discover: vi.fn(async () => ({ serverId: "fixture", tools: [], resources: [], prompts: [], discoveredAt: "2026-07-19T00:00:00.000Z" })),
  disconnect: vi.fn(async () => undefined),
  recordDiscovery: vi.fn(() => ({ health: "healthy", discovery: "current" })),
  recordFailure: vi.fn(),
}));

vi.mock("../../src/config/config-merger.js", () => ({
  loadResolvedKilnMcpConfiguration: mocks.load,
}));
vi.mock("../../src/config/native-mcp-projection-sync.js", () => ({
  syncNativeMcpProjections: mocks.sync,
  uninstallNativeMcpProjections: mocks.uninstall,
}));
vi.mock("../../src/config/mcp-credentials.js", () => ({
  createCanonicalMcpClient: () => ({ discover: mocks.discover, disconnect: mocks.disconnect }),
  createMcpCredentialAccess: () => ({ set: vi.fn(), resolve: vi.fn(), exists: vi.fn() }),
}));
vi.mock("../../src/config/mcp-runtime-state.js", () => ({
  recordMcpDiscovery: mocks.recordDiscovery,
  recordMcpFailure: mocks.recordFailure,
}));

const APP_CONFIG: KilnAppConfig = {
  appName: "kiln",
  dirName: ".kiln",
  version: "0.1.0",
  description: "Test app",
  createRegistry: () => { throw new Error("not used"); },
  mcpServerName: "kiln",
};

describe("mcpConfigCommand", () => {
  beforeEach(() => {
    mocks.load.mockClear();
    mocks.sync.mockClear();
    mocks.uninstall.mockClear();
    mocks.discover.mockClear();
    mocks.disconnect.mockClear();
  });

  it("syncs every supported harness from canonical effective configuration by default", async () => {
    await mcpConfigCommand(APP_CONFIG, {});

    expect(mocks.load).toHaveBeenCalledWith(process.cwd());
    expect(mocks.sync).toHaveBeenCalledWith(
      { servers: {}, diagnostics: [] },
      process.cwd(),
      { harnesses: ["codex", "claude", "opencode"] },
    );
  });

  it("can narrow synchronization to one supported harness", async () => {
    await mcpConfigCommand(APP_CONFIG, { client: "claude-code" });
    expect(mocks.sync).toHaveBeenCalledWith(expect.anything(), process.cwd(), { harnesses: ["claude"] });
  });

  it("uninstalls only the selected governed MCP projection", async () => {
    await mcpConfigCommand(APP_CONFIG, { client: "codex", uninstall: true });

    expect(mocks.uninstall).toHaveBeenCalledWith(process.cwd(), { harnesses: ["codex"] });
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("rejects the removed unmanaged server-definition flags", async () => {
    await expect(mcpConfigCommand(APP_CONFIG, { command: "bun", args: "run server" }))
      .rejects.toThrow(/define MCP servers in canonical global or project Kiln configuration/);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("safely discovers an admitted canonical server without executing a capability", async () => {
    mocks.load.mockReturnValueOnce({
      diagnostics: [],
      servers: {
        fixture: {
          id: "fixture", enabled: true, transport: "stdio", command: "node", admission: { state: "admitted" },
          source: "project", provenance: {}, connection: { state: "not-tested" }, projection: { state: "not-synchronized" },
        },
      },
    });

    await mcpConfigCommand(APP_CONFIG, { test: true, server: "fixture" });

    expect(mocks.discover).toHaveBeenCalledTimes(1);
    expect(mocks.recordDiscovery).toHaveBeenCalledTimes(1);
    expect(mocks.disconnect).toHaveBeenCalledTimes(1);
    expect(mocks.sync).not.toHaveBeenCalled();
  });
});
