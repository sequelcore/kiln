import { beforeEach, describe, expect, it, vi } from "vitest";
import { mcpConfigCommand } from "../../src/commands/mcp-config.js";
import type { KilnAppConfig } from "../../src/config.js";
import { resolveProjectRoot } from "../../src/application/project-root-resolver.js";

const mocks = vi.hoisted(() => ({
  load: vi.fn(() => ({ servers: {}, diagnostics: [] })),
  sync: vi.fn(async (_resolution: unknown, root: string, options: { harnesses: readonly string[] }) => ({
    targets: options.harnesses.map((harness) => ({ harness, path: root, status: "current" })),
  })),
  uninstall: vi.fn(async (root: string, options: { harnesses: readonly string[] }) => ({
    targets: options.harnesses.map((harness) => ({ harness, path: root, status: "uninstalled" })),
  })),
  globalSync: vi.fn(async (input: { operation: string; harnesses: readonly string[] }) => ({
    operation: input.operation,
    targets: input.harnesses.map((harness) => ({ harness, path: "global", status: input.operation === "uninstall" ? "uninstalled" : "current", changed: true })),
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
vi.mock("../../src/config/global-control-plane-mcp-projection.js", () => ({
  syncGlobalControlPlaneMcpProjections: mocks.globalSync,
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
  createRegistry: () => { throw new Error("not used"); },
};

const PROJECT_PATH = resolveProjectRoot({ cwd: process.cwd() }).rootPath;
const PRIVATE_BINDING = expect.objectContaining({ canonicalRoot: PROJECT_PATH });

describe("mcpConfigCommand", () => {
  beforeEach(() => {
    mocks.load.mockClear();
    mocks.sync.mockClear();
    mocks.uninstall.mockClear();
    mocks.globalSync.mockClear();
    mocks.discover.mockClear();
    mocks.disconnect.mockClear();
  });

  it("syncs every supported harness from canonical effective configuration by default", async () => {
    await mcpConfigCommand(APP_CONFIG, {});

    expect(mocks.load).toHaveBeenCalledWith(
      PROJECT_PATH,
      { projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.sync).toHaveBeenCalledWith(
      { servers: {}, diagnostics: [] },
      PROJECT_PATH,
      { harnesses: ["codex", "claude", "opencode"], projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.globalSync).toHaveBeenCalledWith({
      operation: "install",
      harnesses: ["codex", "claude", "opencode"],
      projectPath: process.cwd(),
    });
  });

  it.each([
    ["codex", "codex"],
    ["claude-code", "claude"],
    ["opencode", "opencode"],
  ] as const)("installs the control plane when %s is selected alone", async (client, harness) => {
    await mcpConfigCommand(APP_CONFIG, { client });
    expect(mocks.sync).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_PATH,
      { harnesses: [harness], projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.globalSync).toHaveBeenCalledWith({ operation: "install", harnesses: [harness], projectPath: process.cwd() });
  });

  it("uninstalls only the selected governed MCP projection", async () => {
    await mcpConfigCommand(APP_CONFIG, { client: "codex", uninstall: true });

    expect(mocks.uninstall).toHaveBeenCalledWith(
      PROJECT_PATH,
      { harnesses: ["codex"], projectStateBinding: PRIVATE_BINDING },
    );
    expect(mocks.globalSync).toHaveBeenCalledWith({ operation: "uninstall", harnesses: ["codex"] });
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
